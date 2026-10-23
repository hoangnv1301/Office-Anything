#!/usr/bin/env node
// SESSIONSTART: a desk that (re)starts is told who it is and what to read
// first. Its stdout lands in the model's context.
//
// ⛔ A RESTARTED DESK REMEMBERS NOTHING, and the conversation is not where its
// memory lives. Fresh start, --resume, --continue, a terminal app restoring the
// tab at the repo root, /clear: each one came back without the brief it was
// working from, and a desk restored at the root had not even loaded its own
// CLAUDE.md. Files survive what chats do not: the desk's facts, its briefs and
// reports are its memory, so it is pointed at them, newest first.
//
// A desk.json may name a "wake" command (a doorbell the desk keeps running);
// the desk is told to start it first thing, because a monitor does not survive
// a restart and a desk that forgets it polls on its own and answers late.
//
// ⛔ A REMINDER, NOT A GATE: any failure exits 0 and prints nothing. And it is
// INERT unless office.json has "boot", because a plugin hook runs in every
// project it is installed in.
//
// office.json "boot" (all optional; {placeholders} are filled in):
//   memory   [regex]   files at the desk's root that are its memory
//   work     {dirs, files, flags}  regexes: work folders, and memory files inside them (case-blind unless flags say)
//   max      number    how many to list (newest first)
//   lead     [line]    what the lead is told instead
//   text     {intro, roster, wake, wakeNote, cwd, more, outro}   the desk's lines
//            ({desk} is the desk's name now, {id} its folder; roster "" says none)
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs'
import { join, resolve, dirname, basename, relative } from 'node:path'
import { readOfficeConfig, findOffice, whoIs, childOf, sessionName } from '../lib/office.mjs'
import { versionVerdict } from '../lib/version.mjs'
import { writeAlert } from '../lib/alerts.mjs'
import { isMain } from '../lib/is-main.mjs'
import { wakeCommand } from '../lib/wall.mjs'
import { readSwitch, deskOn } from '../lib/desks.mjs'
import { rosterSafe, officeRoster } from '../lib/desk.mjs'
import { allLeads, deskScope, leadsOfDesk } from '../lib/departments.mjs'
import { afterLines } from '../lib/compact.mjs'
import { profilesOf, rolesHere } from '../lib/role.mjs'
import { readJobs, runHint, pluginGate, fileGate } from '../lib/schedule.mjs'
import { refreshShim } from '../lib/watchdog.mjs'
import { spawnSync } from 'node:child_process'

const DEFAULT = {
  memory: ['^facts\\.md$', '^(REPORT|RULE|BRIEF|REPLY)-.*\\.md$'],
  work: { dirs: '^work-', files: '^(BRIEF|REPLY|REPORT)[-_].*\\.md$' },
  max: 12,
  text: {
    intro: 'You are desk-{desk} ({deskRel}). The chat may be empty or partial; your memory is in files. Read these before you act (newest first):',
    // ⛔ the Monitor tool kills every monitor at timeout_ms (default 5 minutes,
    // at most 30) and hands the session an expiry notice. "Persistent" is not
    // a setting it has: a desk told only that went deaf five minutes later.
    wake: '- First thing, on every start or resume: start your doorbell with Monitor, timeout_ms 1800000 (the maximum): `{wake}` (run in {where}).',
    wakeNote: '  Each line it prints is one wake-up. When its expiry notice arrives, start it again at once. If one is already running, do not start another, and do not poll on your own.',
    cwd: '- ⚠ Your directory is {cwd}, not {deskRel}: your own {deskRel}/CLAUDE.md is not loaded. Read it first. The wall still treats you as desk-{desk}.',
    more: '- …and {n} older ones under {deskRel}/',
    roster: '- The other desks, by the names to message them under now: {roster}.',
    outro: 'Then carry on. If you are unsure where you left off, ask the lead.',
  },
}

const DEFAULT_SANDBOX = '- Your Bash runs in a sandbox: it writes only in your own folder and temp, reads no other desk\'s runtime/, and reaches only the hosts this office lists. "Operation not permitted" or EPERM means the office forbids it: do not retry, and do not try another way; tell the lead if the work needs it.'
const DEFAULT_OFF = '- ⚠ desk-{desk} is OFF on this machine (.office/local.json). Do not start your doorbell and take no new cases. Finish or hand over what you already hold, tell the lead, and stop.'
const DEFAULT_CASE = '- You are the case session for {key}. Your brief: {brief} (read it first). Work only on this case; anything else, and any other case, goes to desk-{desk} by SendMessage.'
// the relative path from a folder up to the office root, ending in / ('' at the root)
const upTo = (root, from) => { const r = relative(resolve(from), resolve(root)); return r ? r + '/' : '' }
const fill = (s, v) => String(s ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m))

export function bootLines(root, who, cfg, cwd) {
  const b = cfg.boot ?? {}
  if (who.kind === 'lead') {
    // a department's lead (lib/departments.mjs): its own instructions and its
    // own desks, under their names now; its own doorbell, else lead.wake
    const L = allLeads(cfg).find((l) => l.names.includes(who.role)) ?? null
    // boot.lead lines may say {lead} (this lead's own name) and {up} (the path
    // from where it stands to the office root): a department lead is not at the root
    const out = Array.isArray(b.lead) ? b.lead.map((x) => fill(String(x), { lead: L?.session ?? who.role, up: upTo(root, cwd) })) : []
    if (L?.department) {
      const ds = officeRoster(root).desks.filter((d) => (L.desks ?? []).includes(d.name)).map((d) => d.session)
      out.push(`You are ${L.session}, the lead of department ${L.department}.${ds.length ? ` Your desks: ${ds.join(', ')}.` : ''} Other departments' work reaches you through the book, not by message.`)
      if (L.instructions) out.push(`Read ${L.instructions} before anything else.`)
    }
    // office.json lead.wake: the lead's own doorbell, armed like a desk's
    const wake = wakeCommand(L?.wake ?? cfg.lead?.wake)
    if (wake) { const T = { ...DEFAULT.text, ...(b.text ?? {}) }; out.push(fill(T.wake, { wake, where: 'the office root' })); if (T.wakeNote) out.push(fill(T.wakeNote, {})) }
    return out
  }
  if (who.kind !== 'desk') return []
  const T = { ...DEFAULT.text, ...(b.text ?? {}) }
  const memory = (Array.isArray(b.memory) ? b.memory : DEFAULT.memory).map((p) => new RegExp(p))
  const work = { ...DEFAULT.work, ...(b.work ?? {}) }
  const workDirs = new RegExp(work.dirs), workFiles = new RegExp(work.files, typeof work.flags === 'string' ? work.flags : 'i')
  const max = Number.isInteger(b.max) && b.max > 0 ? b.max : DEFAULT.max
  const deskDir = who.dir
  const rel = (f) => f.slice(root.length + 1)
  const files = []
  for (const f of readdirSync(deskDir)) {
    const full = join(deskDir, f)
    if (memory.some((re) => re.test(f))) files.push(full)
    if (workDirs.test(f) && statSync(full).isDirectory()) for (const g of readdirSync(full)) if (workFiles.test(g)) files.push(join(full, g))
  }
  files.sort((a, c) => statSync(c).mtimeMs - statSync(a).mtimeMs)
  // ⛔ THE ROSTER IS PRINTED, NEVER COPIED (0.11.0). A desk learns who it can
  // message from here, under each desk's name NOW, so a rename reaches every
  // desk at its next start without anybody editing their instructions.
  const all = officeRoster(root).desks
  const scope = deskScope(root, cfg, all)
  const roster = scope ? all.filter((d) => scope.has(d.name)) : all
  const me = all.find((d) => d.name === who.desk)
  const others = roster.filter((d) => d.name !== who.desk && d.kind !== 'lead').map((d) => `${d.session} (${d.kind}${d.description ? ': ' + String(d.description).split(/[.;:]/)[0].slice(0, 80) : ''})`)
  // {up}: the path from the desk to the office root (../../ in desks/, ../../../ in a
  // department's folder); {lead}: the lead this desk reports to
  const v = { up: upTo(root, deskDir), lead: leadsOfDesk(cfg, who.desk)[0]?.session ?? cfg.lead?.session ?? 'lead', desk: me?.title ?? who.desk, id: who.desk, roster: others.join('; '), deskRel: rel(deskDir), cwd, where: basename(dirname(deskDir)) + '/' + basename(deskDir), n: Math.max(0, files.length - max) }
  const out = [fill(T.intro, v)]
  // a case session (desk-<desk>--<key>): its case and its brief come first
  if (who.caseKey) out.push(fill(T.caseLine ?? DEFAULT_CASE, { ...v, key: who.caseKey, brief: rel(join(root, '.office', 'cases', `${who.desk}--${who.caseKey}.md`)) }))
  let wake = ''
  try { wake = String(JSON.parse(readFileSync(join(deskDir, 'desk.json'), 'utf8')).wake ?? '').trim() } catch {}
  // off on this machine (lib/desks.mjs): no doorbell, no new cases. The
  // session is told instead of refused: it may hold work it has to hand over
  const sw = readSwitch(root)
  if (sw.error || !deskOn(sw, who.desk).on) out.push(fill(T.off ?? DEFAULT_OFF, v))
  else if (wake) { out.push(fill(T.wake, { ...v, wake })); if (T.wakeNote) out.push(fill(T.wakeNote, v)) }
  let sandboxed = false
  try { sandboxed = JSON.parse(readFileSync(join(deskDir, 'desk.json'), 'utf8')).sandbox === true } catch {}
  if (sandboxed) out.push(fill(T.sandbox ?? DEFAULT_SANDBOX, v))
  if (cwd !== deskDir) out.push(fill(T.cwd, v))
  for (const f of files.slice(0, max)) out.push('- ' + rel(f))
  if (files.length > max) out.push(fill(T.more, v))
  if (T.roster && others.length) out.push(fill(T.roster, v))
  if (T.outro) out.push(fill(T.outro, v))
  return out
}

// PREPARED WORK (0.20.1, lib/schedule.mjs): a parked job is named to every
// session that may run it, so a coworker opening a session is told what waits
// and the one command that starts it. A role sees its own; the lead and a
// session at the root see every one this machine may run. A desk sees none:
// a desk does not run a role's job.
export function jobLines(root, cfg, env, who) {
  if (who?.kind === 'desk') return []
  let parked = readJobs(root).filter((j) => j.state === 'parked')
  const mine = env.OFFICE_PROFILE
  if (mine) parked = parked.filter((j) => j.role === mine)
  else if (who?.kind !== 'lead') { const R = cfg?.profiles ? rolesHere(root, cfg) : { list: [] }; parked = parked.filter((j) => R.list.some((p) => p.name === j.role)) }
  if (!parked.length) return []
  return [`${parked.length} prepared job${parked.length > 1 ? 's' : ''} waiting${mine ? ` for this role` : ''}:`, ...parked.map((j) => {
    const held = pluginGate(j) ?? fileGate(root, j)
    return `- ${j.id} (role ${j.role}): ${runHint(j.id)}${held ? ` (held: ${held})` : ''}`
  })]
}

// ROLES (0.17.0, lib/role.mjs): only with office.json "profiles". A session
// opened as a role is told which, and its note; one at the root with no role is
// told how to become one (a role is a new session, never a switch in place).
export function roleLines(root, cfg, cwd, env, who) {
  if (!cfg?.profiles || typeof cfg.profiles !== 'object') return []
  const name = env.OFFICE_PROFILE
  if (name) {
    const p = profilesOf(root, cfg).list.find((x) => x.name === name)
    if (!p) return [`⚠ This session was opened as role "${name}", which office.json "profiles" does not declare now.`]
    return [`You are ${p.session}, opened as the ${p.name} role.`, ...(p.note ? [p.note] : [])]
  }
  if (who || resolve(cwd) !== resolve(root)) return []
  const R = rolesHere(root, cfg)
  return [`dev/construction session; /role to switch${R.list.length ? ` (${R.list.map((p) => p.name).join(', ')})` : ''}.`]
}

if (isMain(import.meta.url)) {
  const chunks = []
  process.stdin.on('data', (c) => chunks.push(c))
  process.stdin.on('end', () => {
    try {
      let p = {}
      try { p = JSON.parse(Buffer.concat(chunks).toString() || '{}') } catch {}
      const cwd = p?.cwd ? resolve(p.cwd) : process.cwd()
      const root = findOffice(cwd)
      if (!root) process.exit(0)
      // ⛔ a watchdog shim an older version wrote is rewritten at every session start
      // (lib/watchdog.mjs refreshShim): a stale one skipped this office for hours
      try { refreshShim(root) } catch {}
      const cfg = readOfficeConfig(root)
      // an unapproved plugin version: the session is told, the lead alerted once
      const v = versionVerdict(cfg)
      if (v && !v.ok) {
        console.log(`⚠ This session loaded office-anything ${v.loaded ?? '(unknown)'}, which this office has not approved (approved: ${v.approved.join(', ') || 'none'}). ${v.enforce ? 'Desk sessions are refused until it is.' : 'The lead has been told.'}`)
        try { writeAlert(root, cfg, { type: 'VERSION', subject: 'office-anything', text: `loaded ${v.loaded}, approved ${v.approved.join(',')}${v.enforce ? ' (enforce: desks refused)' : ''}`, quietKey: 'version:' + v.loaded }) } catch {}
      }
      const afterCompact = p?.source === 'compact' && !!cfg.compact?.after
      const roles = [...roleLines(root, cfg, cwd, process.env, whoIs(root, cfg, { cwd })), ...jobLines(root, cfg, process.env, whoIs(root, cfg, { cwd }))]
      if ((!cfg.boot || typeof cfg.boot !== 'object') && !(typeof cfg.lead?.wake === 'string' && cfg.lead.wake.trim()) && !afterCompact) { if (roles.length) console.log(roles.join('\n')); process.exit(0) }
      const who = whoIs(root, cfg, { cwd })
      // a case session runs under its parent's role, so its own name says which case it is
      const child = childOf(root, sessionName())
      if (child && who?.kind === 'desk' && who.desk === child.parent) who.caseKey = child.key
      if (!who || (who.kind === 'desk' && !existsSync(join(who.dir, 'desk.json')))) { if (roles.length) console.log(roles.join('\n')); process.exit(0) }
      // exactly the old boot when it would have run; only the after-compact lines when that alone let it in
      const booted = (cfg.boot && typeof cfg.boot === 'object') || (typeof cfg.lead?.wake === 'string' && cfg.lead.wake.trim())
      const lines = booted ? bootLines(root, who, cfg, cwd) : []
      // ⛔ AFTER A COMPACTION (SessionStart source "compact", documented to add
      // its output to the compacted context): what is open right now, from the
      // office's own read-only command (office.json compact.after). A case
      // session is its parent desk's: it gets the desk's lines.
      if (p?.source === 'compact' && (who.kind === 'lead' || who.kind === 'desk')) lines.push(...afterLines(root, cfg, { isLead: who.kind === 'lead', desk: who.desk, run: spawnSync }))
      lines.unshift(...roles)
      if (lines.length) console.log(lines.join('\n'))
    } catch {}
    process.exit(0)
  })
}
