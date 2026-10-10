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
//   text     {intro, wake, wakeNote, cwd, more, outro}   the desk's lines
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs'
import { join, resolve, dirname, basename } from 'node:path'
import { readOfficeConfig, findOffice, whoIs, childOf, sessionName } from '../lib/office.mjs'
import { versionVerdict } from '../lib/version.mjs'
import { writeAlert } from '../lib/alerts.mjs'
import { isMain } from '../lib/is-main.mjs'

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
    outro: 'Then carry on. If you are unsure where you left off, ask the lead.',
  },
}

const DEFAULT_CASE = '- You are the case session for {key}. Your brief: {brief} (read it first). Work only on this case; anything else, and any other case, goes to desk-{desk} by SendMessage.'
const fill = (s, v) => String(s ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m))

export function bootLines(root, who, cfg, cwd) {
  const b = cfg.boot ?? {}
  if (who.kind === 'lead') return Array.isArray(b.lead) ? b.lead.map(String) : []
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
  const v = { desk: who.desk, deskRel: rel(deskDir), cwd, where: basename(dirname(deskDir)) + '/' + basename(deskDir), n: Math.max(0, files.length - max) }
  const out = [fill(T.intro, v)]
  // a case session (desk-<desk>--<key>): its case and its brief come first
  if (who.caseKey) out.push(fill(T.caseLine ?? DEFAULT_CASE, { ...v, key: who.caseKey, brief: rel(join(root, '.office', 'cases', `${who.desk}--${who.caseKey}.md`)) }))
  let wake = ''
  try { wake = String(JSON.parse(readFileSync(join(deskDir, 'desk.json'), 'utf8')).wake ?? '').trim() } catch {}
  if (wake) { out.push(fill(T.wake, { ...v, wake })); if (T.wakeNote) out.push(fill(T.wakeNote, v)) }
  if (cwd !== deskDir) out.push(fill(T.cwd, v))
  for (const f of files.slice(0, max)) out.push('- ' + rel(f))
  if (files.length > max) out.push(fill(T.more, v))
  if (T.outro) out.push(fill(T.outro, v))
  return out
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
      const cfg = readOfficeConfig(root)
      // an unapproved plugin version: the session is told, the lead alerted once
      const v = versionVerdict(cfg)
      if (v && !v.ok) {
        console.log(`⚠ This session loaded office-anything ${v.loaded ?? '(unknown)'}, which this office has not approved (approved: ${v.approved.join(', ') || 'none'}). ${v.enforce ? 'Desk sessions are refused until it is.' : 'The lead has been told.'}`)
        try { writeAlert(root, cfg, { type: 'VERSION', subject: 'office-anything', text: `loaded ${v.loaded}, approved ${v.approved.join(',')}${v.enforce ? ' (enforce: desks refused)' : ''}`, quietKey: 'version:' + v.loaded }) } catch {}
      }
      if (!cfg.boot || typeof cfg.boot !== 'object') process.exit(0)
      const who = whoIs(root, cfg, { cwd })
      // a case session runs under its parent's role, so its own name says which case it is
      const child = childOf(root, sessionName())
      if (child && who?.kind === 'desk' && who.desk === child.parent) who.caseKey = child.key
      if (!who || (who.kind === 'desk' && !existsSync(join(who.dir, 'desk.json')))) process.exit(0)
      const lines = bootLines(root, who, cfg, cwd)
      if (lines.length) console.log(lines.join('\n'))
    } catch {}
    process.exit(0)
  })
}
