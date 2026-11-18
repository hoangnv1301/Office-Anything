// PER-CASE CHILD SESSIONS: one Claude session per case, under its parent desk.
//
//   node lib/cases.mjs [root] open <desk> <key>       open (or resume) one case session
//   node lib/cases.mjs [root] sweep                   heartbeat, release the gone, close the idle, open new cases
//   node lib/cases.mjs [root] list                    every desk's live case sessions and the cap
//   node lib/cases.mjs [root] close <desk> <key> [--why "…"]
//   node lib/cases.mjs [root] release <desk> <key> --by <name> --said "<the human's words>"
//   node lib/cases.mjs [root] route "<message text>"  which session a message about a case goes to
//   node lib/cases.mjs [root] tidy [--apply]          the leftovers: case tabs with no claude in them, idle case sessions (never one mid-turn)
//
// ⛔ A CLOSED CASE LEAVES NO TAB, AND A MISSED ONE IS CLOSED LATER (0.30.0). Owner,
// 2026-11-18, with the Orca list: dozens of desk-design--SO-… and
// desk-design-quotation--SO-… entries 8-18 h old, "are these sessions failed to
// auto close". None of them was a session: idle-close had stopped every claude
// (.office/cases.json: "idle 10 min") and its tab stayed at a shell prompt, one
// more per reopen (SO-261015-156: 8 tabs, one conversation). The close listed
// tabs once, right after the SIGTERM, swallowed every failure, and nothing ever
// looked again: heal's stray-tab pass knows desk names, not case names. Now the
// close takes the whole tab (`--tab`) and says what became of it, and every
// sweep closes a case tab with no claude in it, no live session of its name and
// quiet for 2 minutes. A tab with an agent in it, or a live session, is never touched.
// ⛔ THE NEXT WAKE RESUMES THE CASE'S OWN CONVERSATION, AND A LONG ONE IS NOT
// RELOADED (0.30.0). The case's conversation id is kept in .office/cases.json;
// a reopen resumes it (planStart by name, else the kept id). A conversation over
// office.json cases.freshOverKB (4096) is not resumed: the case starts fresh
// with a digest of the old one in its brief (its last asks and answers), so a
// wake costs a brief, not a 10 MB reload.
// office.json "cases": { "freshOverKB": 4096, "digestChars": 4000, "maxLive": <all live case sessions on this machine, every desk> }
//
// Contract: docs/specs/2026-10-10-per-case-sessions.md. The parent desk stays;
// a case session is named desk-<parent>--<key>, starts in the parent's folder
// under the parent's role (same token, same wall, same CLAUDE.md), and works
// only on its case. Case-less work stays with the parent.
//
// ⛔ ONE DESK CARRYING FIVE JOBS MIXED THEM UP. The design desk mirrored one
// kitchen from another job's line and had to revert. One session per case is
// the fix, and the claim in the project's book is what keeps two sessions off
// one case: core asks the office's adapter (desk.json perCase.adapter) and
// never grants anything the adapter did not.
//
// Native primitives: the session registry (~/.claude/sessions) for liveness,
// status and idle time; `claude --name` and `--resume <id>`; SendMessage
// between sessions; the SessionStart hook for the case's boot line.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { readOfficeConfig, findOffice, childOf } from './office.mjs'
import { readSwitch, deskOn, openWork, alertOff } from './desks.mjs'
import { rosterSafe, officeRoster, deskDir, namesOf } from './desk.mjs'
import { liveSessions, processTable, STRAY_QUIET_MS } from './procs.mjs'
import { planStart, claudeDir, projectDirOf } from './conversation.mjs'
import { idleSince } from './idle.mjs'
import { launchConfig, launchAndWait, orcaTerminal, closeStaleTabs } from './start.mjs'
import { isMain } from './is-main.mjs'

// desk.json perCase, checked. -> { kind, key: RegExp, keySrc, max, idleCloseMinutes, adapter } | throws
export function perCaseOf(desk) {
  const pc = desk?.perCase
  if (!pc || typeof pc !== 'object') return null
  const where = `desks/${desk.name}/desk.json perCase`
  if (typeof pc.kind !== 'string' || !pc.kind) throw new Error(`${where}: "kind" is required`)
  if (typeof pc.key !== 'string' || !pc.key) throw new Error(`${where}: "key" (a regex) is required`)
  // no adapter = naming only: the office runs these sessions itself (its own
  // launcher), and core uses the key for the session's name and its wall
  if (pc.adapter != null && (typeof pc.adapter !== 'string' || !pc.adapter)) throw new Error(`${where}: "adapter" must be a command`)
  let key
  try { key = new RegExp('^(?:' + pc.key + ')$') } catch (e) { throw new Error(`${where}: "key" does not compile (${e.message})`) }
  for (const bad of ['a--b', 'a/b', 'a b', '', '..']) if (key.test(bad)) throw new Error(`${where}: "key" must not match "${bad}" (no --, slash, whitespace, empty or ..)`)
  const max = Number.isInteger(pc.max) && pc.max > 0 ? pc.max : 3
  const idleCloseMinutes = Number.isFinite(pc.idleCloseMinutes) && pc.idleCloseMinutes > 0 ? pc.idleCloseMinutes : 60
  return { kind: pc.kind, key, keySrc: pc.key, max, idleCloseMinutes, adapter: pc.adapter ?? null }
}

// a case session is named after the desk's NAME (desk.json "name"); keys and
// the brief stay under its id. A string is taken as the name.
export const childName = (desk, key) => `${typeof desk === 'string' ? namesOf({ title: desk, name: desk })[0] : desk.session}--${key}`
// the same case under one of the desk's old names: a case session opened before a rename
const oldChild = (desk, key) => (n) => (desk.names ?? [desk.session]).some((x) => x !== desk.session && n === `${x}--${key}`)
const isChild = (s, desk, key) => s.name === childName(desk, key) || oldChild(desk, key)(s.name)

// the office's adapter: JSON request in argv[2], JSON answer on stdout.
// Exit 0 is an answer (refusals included); anything else is the adapter
// failing, which is UNKNOWN and never a grant.
export function adapterCall(root, desk, pc, req, { run = execFileSync, timeoutMs = 30_000 } = {}) {
  let out
  try {
    out = run('/bin/sh', ['-c', `${pc.adapter} "$1"`, 'adapter', JSON.stringify({ ...req, desk: desk.name })], { cwd: deskDir(root, desk.name), encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    const why = String(e.stderr ?? e.message ?? e).trim().split('\n').pop()
    throw new Error(`the ${pc.kind} adapter failed on ${req.op} (${why.slice(0, 200)}); that is UNKNOWN, not a grant`)
  }
  try { return JSON.parse(String(out).trim().split('\n').pop()) } catch { throw new Error(`the ${pc.kind} adapter answered ${req.op} with something that is not JSON`) }
}

// what this machine holds: .office/cases.json { "<desk>--<key>": { claimedAt, openedAt, closedAt?, why? } }
const stateFile = (root) => join(root, '.office', 'cases.json')
export function readCases(root) { try { return JSON.parse(readFileSync(stateFile(root), 'utf8')) } catch { return {} } }
function writeCases(root, s) {
  mkdirSync(join(root, '.office'), { recursive: true })
  if (!existsSync(join(root, '.office', '.gitignore'))) writeFileSync(join(root, '.office', '.gitignore'), '# office-anything state and logs; never committed\n*\n')
  writeFileSync(stateFile(root), JSON.stringify(s, null, 2))
}
export const briefPath = (root, desk, key) => join(root, '.office', 'cases', `${desk}--${key}.md`)

// office.json "cases": the machine-wide knobs (0.30.0)
export function casesConfig(cfg) {
  const C = cfg?.cases && typeof cfg.cases === 'object' ? cfg.cases : {}
  const num = (v, d, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)
  return { freshOverKB: num(C.freshOverKB, 4096, 64, 1 << 20), digestChars: num(C.digestChars, 4000, 500, 20000), maxLive: Number.isInteger(C.maxLive) && C.maxLive > 0 ? C.maxLive : null }
}

// ── the digest of a long conversation ───────────────────────────────────────
// Its last asks and answers, newest kept, from the transcript's tail: what the
// next session needs to carry on, without loading the conversation. Pure over the file.
const TAIL_BYTES = 4 << 20
function tailLines(file, bytes = TAIL_BYTES) {
  const size = statSync(file).size
  const n = Math.min(size, bytes)
  const fd = openSync(file, 'r')
  try { const b = Buffer.alloc(n); readSync(fd, b, 0, n, size - n); const t = b.toString('utf8'); return (size > n ? t.slice(t.indexOf('\n') + 1) : t).split('\n').filter(Boolean) } finally { closeSync(fd) }
}
const oneLine = (s, n) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t }
export function digestOf(file, { maxChars = 4000 } = {}) {
  const items = []
  for (const l of tailLines(file)) {
    let o
    try { o = JSON.parse(l) } catch { continue }
    if (o.isSidechain) continue
    const c = o.message?.content
    if (o.type === 'user') {
      const t = typeof c === 'string' ? c : Array.isArray(c) && !c.some((x) => x?.type === 'tool_result') ? c.map((x) => x?.text ?? '').join(' ') : ''
      if (t.trim() && !/^<(task-notification|command-|local-command|system-reminder)/.test(t.trim())) items.push(`- asked: ${oneLine(t, 400)}`)
    } else if (o.type === 'assistant' && Array.isArray(c)) {
      const t = c.filter((x) => x?.type === 'text').map((x) => x.text).join(' ')
      if (t.trim()) items.push(`- answered: ${oneLine(t, 600)}`)
    }
  }
  const out = []
  let n = 0
  for (const it of items.reverse()) { if (n + it.length + 1 > maxChars) break; out.unshift(it); n += it.length + 1 }
  return out.join('\n')
}

// ── the case's tabs ─────────────────────────────────────────────────────────
const termOf = (root, o) => { try { return o.terminal ?? (launchConfig(o.cfg).terminal === 'orca' ? orcaTerminal(root) : null) } catch { return null } }
const caseKeyOf = (desk, pc, title) => {
  for (const n of desk.names ?? [desk.session]) if (String(title).startsWith(n + '--')) { const k = String(title).slice(n.length + 2); if (pc.key.test(k)) return k }
  return null
}
/**
 * The case tabs nobody is in: titled as one of this desk's cases, no claude in the tab (agent false), no live session of that name, quiet for
 * STRAY_QUIET_MS. -> [{ handle, title, key, quietMin }]. A tab whose terminal cannot say (agent unknown, quiet unknown) is not one.
 */
export function strayCaseTabs(desk, pc, tabs, live) {
  const liveNames = new Set(live.map((s) => s.name))
  return tabs.filter((x) => x.agent === false && Number.isFinite(x.quietMs) && x.quietMs >= STRAY_QUIET_MS && !liveNames.has(x.title) && caseKeyOf(desk, pc, x.title))
    .map((x) => ({ handle: x.handle, title: x.title, key: caseKeyOf(desk, pc, x.title), quietMin: Math.round(x.quietMs / 60_000) }))
}

const desksWithCases = (root) => officeRoster(root).desks.map((d) => { try { return { desk: d, pc: perCaseOf(d) } } catch (e) { return { desk: d, error: e.message } } }).filter((x) => x.pc || x.error)
const childrenOf = (live, desk) => live.filter((s) => typeof s.name === 'string' && (desk.names ?? [desk.session]).some((x) => s.name.startsWith(x + '--')))
const findDesk = (root, word) => { const ds = officeRoster(root).desks; return ds.find((d) => d.name === word) ?? ds.find((d) => d.title === word) ?? null }

const defaults = (root, o = {}) => ({
  cfg: o.cfg ?? readOfficeConfig(root),
  live: o.live ?? (() => liveSessions(homedir(), processTable())),
  terminal: o.terminal ?? null,
  sleep: o.sleep, now: o.now ?? Date.now, procs: o.procs,
  adapter: o.adapter ?? ((desk, pc, req) => adapterCall(root, desk, pc, req)),
  kill: o.kill ?? ((pid) => process.kill(pid, 'SIGTERM')),
  dir: o.dir ?? claudeDir(),
})

// Open (or resume) the case session desk-<desk>--<key>.
// -> { tag, state, why } state: up | already | clash | cap | refused | failed | unknown
export async function openCase(root, word, key, opts = {}) {
  const o = defaults(root, opts)
  const desk = findDesk(root, word)
  if (!desk) return { tag: null, state: 'refused', why: `no desk called ${word}` }
  const deskName = desk.name
  const pc = perCaseOf(desk)
  if (!pc) return { tag: null, state: 'refused', why: `desk ${deskName} declares no perCase in its desk.json` }
  if (!pc.key.test(key)) return { tag: null, state: 'refused', why: `"${key}" is not a ${pc.kind} key (${pc.keySrc})` }
  if (!pc.adapter) return { tag: null, state: 'refused', why: `desk ${deskName} declares no adapter: the office runs these sessions itself` }
  // a desk that is off on this machine takes no case here (lib/desks.mjs)
  const sw = readSwitch(root)
  if (sw.error || !deskOn(sw, desk).on) return { tag: null, state: 'refused', why: sw.error ?? `desk ${deskName} is off on this machine: no claim taken; the case stays in the book` }
  const tag = childName(desk, key)
  if (!childOf(root, tag)) return { tag, state: 'refused', why: `${tag} is not a case session this office recognises` }
  const live = o.live()
  const mine = live.filter((s) => isChild(s, desk, key))
  // ⛔ THE DUPLICATE GUARD, per (parent, case key): one case, one session
  if (mine.length > 1) return { tag, state: 'clash', why: `${mine.length} live sessions are named ${tag} (pids ${mine.map((s) => s.pid).join(', ')}): close the extra one` }
  if (mine.length === 1) return { tag, state: 'already', why: `pid ${mine[0].pid}, ${mine[0].status ?? 'status unknown'}` }
  const kids = childrenOf(live, desk)
  if (kids.length >= pc.max) return { tag, state: 'cap', why: `desk ${deskName} already has ${kids.length} case session(s) of ${pc.max} (${kids.map((s) => s.name.split('--')[1]).join(', ')}); the case stays with ${desk.session} until one closes` }
  // the machine's own limit, every desk's case sessions together (office.json cases.maxLive)
  const CC = casesConfig(o.cfg)
  if (CC.maxLive) { const all = desksWithCases(root).filter((x) => x.pc).flatMap((x) => childrenOf(live, x.desk)).length; if (all >= CC.maxLive) return { tag, state: 'cap', why: `this machine already runs ${all} case session(s) of office.json cases.maxLive ${CC.maxLive}; the case waits` } }
  // the claim first: the office's book decides who holds the case
  let c
  try { c = o.adapter(desk, pc, { op: 'claim', key, session: tag }) } catch (e) { return { tag, state: 'unknown', why: e.message } }
  if (!c?.ok) return { tag, state: 'refused', why: c?.status === 409 ? `the case is held by ${c.holder}` : `the adapter refused the claim (${c?.error ?? JSON.stringify(c)})` }
  const st = readCases(root)
  st[`${deskName}--${key}`] = { ...(st[`${deskName}--${key}`] ?? {}), claimedAt: new Date(o.now()).toISOString() }
  writeCases(root, st)
  // the brief: from the adapter's open list when it has one for this key
  let brief = opts.brief ?? null
  if (brief == null) {
    try { brief = (o.adapter(desk, pc, { op: 'open' })?.cases ?? []).find((x) => x.key === key)?.brief ?? null } catch {}
  }
  const bp = briefPath(root, deskName, key)
  mkdirSync(join(root, '.office', 'cases'), { recursive: true })
  const L = launchConfig(o.cfg)
  const term = o.terminal ?? (L.terminal === 'orca' ? orcaTerminal(root) : null)
  if (!term) { release(root, desk, pc, key, tag, 'no terminal adapter', o); return { tag, state: 'failed', why: `office.json launch.terminal "${L.terminal}" has no adapter` } }
  const t = { name: deskName, tag, roleTag: desk.session, isLead: false, dir: deskDir(root, deskName), model: desk.model ?? null, sandbox: desk.sandbox === true, root, teammate: true }
  let plan = planStart({ tag, cwd: t.dir, also: oldChild(desk, key), live, dir: o.dir })
  // the case's own conversation by its kept id, when the name did not find it (a transcript whose name record was lost)
  const kept = readCases(root)[`${deskName}--${key}`]?.sessionId
  const convOf = (id) => join(projectDirOf(t.dir, o.dir), `${id}.jsonl`)
  if (!plan.resume && kept && /^[0-9a-f-]{36}$/.test(kept) && existsSync(convOf(kept)) && !live.some((s) => s.sessionId === kept)) plan = { ...plan, resume: kept, why: `the case's kept conversation ${kept}` }
  // a conversation too long to reload: a fresh one, with a digest of the old one in the brief
  let digest = null
  if (plan.resume) {
    let size = 0
    try { size = statSync(convOf(plan.resume)).size } catch {}
    if (size > CC.freshOverKB * 1024) {
      try { digest = { from: plan.resume, kb: Math.round(size / 1024), text: digestOf(convOf(plan.resume), { maxChars: CC.digestChars }) } } catch { digest = { from: plan.resume, kb: Math.round(size / 1024), text: '' } }
      plan = { resume: null, why: `its conversation ${plan.resume} is ${digest.kb} KB, over office.json cases.freshOverKB ${CC.freshOverKB}: a fresh one, with a digest in the brief`, skipped: plan.skipped ?? [] }
    }
  }
  writeFileSync(bp, `# ${tag}\n\nYou are the case session for ${pc.kind} ${key} of desk ${deskName}. Work only on this case; anything else goes to ${desk.session} by SendMessage.\n\n${brief ?? '(no brief from the adapter: ask ' + desk.session + ' what is asked)'}\n`
    + (digest ? `\n## Where the last session on this case left off\n\nA digest of its conversation ${digest.from} (${digest.kb} KB, not reloaded): its last asks and answers, oldest first. The book and the case's files are the truth; check them before you act on anything here.\n\n${digest.text || '(nothing could be read from it)'}\n` : ''))
  const prompt = plan.resume ? `Your case brief may have changed: reread ${bp} and carry on with case ${key}.` : `Read your case brief at ${bp} and start on case ${key}.`
  let r = await launchAndWait({ cfg: o.cfg, L, term, t, plan, live: o.live, sleep: o.sleep, now: o.now, procs: o.procs, prompt })
  // ⛔ A CASE SESSION THAT REGISTERED AND IS BUSY IS UP: it was launched with
  // its brief as the prompt, so busy means it is working the case. Releasing
  // the claim here left it drafting on a case the book no longer gave it, and
  // the next heartbeat would have closed it mid-draft (rfq test, 2026-10-19)
  if (r.state === 'busy') r = { ...r, state: 'up', why: `${r.why}: working its brief` }
  if (r.state !== 'up') release(root, desk, pc, key, tag, `the session did not come up (${r.state})`, o)
  else {
    // the conversation it runs is kept per case: the next wake resumes it
    const sid = o.live().find((s) => s.name === tag)?.sessionId ?? plan.resume ?? null
    const s2 = readCases(root)
    s2[`${deskName}--${key}`] = { ...s2[`${deskName}--${key}`], openedAt: new Date(o.now()).toISOString(), closedAt: undefined, why: undefined, ...(sid ? { sessionId: sid } : {}), ...(digest ? { freshFrom: digest.from } : {}) }
    writeCases(root, s2)
  }
  return { tag, state: r.state, why: r.why + (plan.resume ? ` (resumed ${plan.resume})` : digest ? ` (fresh: ${digest.from} was ${digest.kb} KB; digest in the brief)` : '') }
}

function release(root, desk, pc, key, tag, why, o) {
  try { o.adapter(desk, pc, { op: 'release', key, session: tag, why }) } catch {}
  const st = readCases(root)
  if (st[`${desk.name}--${key}`]) { st[`${desk.name}--${key}`].closedAt = new Date(o.now()).toISOString(); st[`${desk.name}--${key}`].why = why; writeCases(root, st) }
}

// Close one case session: stop its process, release its claim.
export function closeCase(root, deskName, key, why = 'closed', opts = {}) {
  const o = defaults(root, opts)
  const desk = findDesk(root, deskName)
  const pc = desk ? perCaseOf(desk) : null
  if (!pc) return { state: 'refused', why: `desk ${deskName} declares no perCase` }
  const tag = childName(desk, key)
  const mine = o.live().filter((s) => isChild(s, desk, key))
  for (const s of mine) { try { o.kill(s.pid) } catch {} }
  // and its tab, the whole tab: one left behind at a shell prompt reads as "already open"
  // to start, and a reopened case would get a second tab of the same title. What became of it is said;
  // a tab this misses is closed by a later sweep (strayCaseTabs)
  let tabs = 'no terminal adapter'
  try {
    const term = termOf(root, o)
    // orphaned tabs too (0.28.2): Orca's "orphaned" tab still shows, at a shell prompt
    if (term?.close) { const c = closeStaleTabs(term, (t) => t === tag || oldChild(desk, key)(t), { evenWithAgent: true, tab: true }); tabs = c.why ?? (c.failed.length ? `could not close ${c.failed.map((f) => f.why).join('; ')}` : c.closed.length ? `closed ${c.closed.length} tab(s)` : 'no tab') }
  } catch (e) { tabs = `the terminal failed (${e.message ?? e})` }
  release(root, desk, pc, key, tag, why, o)
  return { state: 'closed', tabs, why: mine.length ? `stopped pid ${mine.map((s) => s.pid).join(', ')} and released the claim (${why}); tab: ${tabs}` : `no live session; claim released (${why}); tab: ${tabs}` }
}

// The human's override: release a case whoever holds it. `said` is required
// and recorded (an override must cost something).
export function forceRelease(root, deskName, key, { by, said } = {}, opts = {}) {
  const o = defaults(root, opts)
  if (typeof said !== 'string' || said.trim().length < 3) return { state: 'refused', why: 'a force-release needs the human\'s words (--said "…")' }
  const desk = findDesk(root, deskName)
  const pc = desk ? perCaseOf(desk) : null
  if (!pc) return { state: 'refused', why: `desk ${deskName} declares no perCase` }
  const r = o.adapter(desk, pc, { op: 'forceRelease', key, by: by ?? 'office', said })
  return r?.ok ? { state: 'released', why: `was held by ${r.was ?? 'nobody'}` } : { state: 'refused', why: JSON.stringify(r) }
}

// Every minute (the lead's schedule, or the watchdog): keep claims alive,
// close what lost its claim, went idle or died, then open what is waiting.
export async function sweep(root, opts = {}) {
  const o = defaults(root, opts)
  const acts = []
  for (const { desk, pc, error } of desksWithCases(root)) {
    if (error) { acts.push({ desk: desk.name, act: 'config', ok: false, why: error }); continue }
    if (!pc.adapter) continue                       // the office runs these itself
    // 0. two live sessions on one case: keep the most recently active, stop
    // the rest by their own pid (never by name), keep the claim
    const byName = new Map()
    for (const s of childrenOf(o.live(), desk)) byName.set(s.name, [...(byName.get(s.name) ?? []), s])
    for (const [tag, ss] of byName) {
      if (ss.length < 2) continue
      const [keep, ...extra] = [...ss].sort((a, b) => (b.updatedAt ?? b.statusUpdatedAt ?? 0) - (a.updatedAt ?? a.statusUpdatedAt ?? 0))
      for (const s of extra) { try { o.kill(s.pid) } catch {} }
      acts.push({ desk: desk.name, key: tag.split('--')[1], act: 'duplicate-close', state: 'closed', why: `${ss.length} live sessions named ${tag}: stopped pid ${extra.map((s) => s.pid).join(', ')}, kept pid ${keep.pid} (the most recently active) and its claim` })
    }
    const kids = childrenOf(o.live(), desk)
    // 1. heartbeat every live child's claim
    const book = new Map()   // key -> ms quiet since | null (something is owed), from the heartbeat answer's optional idle[]
    if (kids.length) {
      let lost = []
      try {
        const hb = o.adapter(desk, pc, { op: 'heartbeat', claims: kids.map((s) => ({ key: s.name.split('--')[1], session: s.name })) })
        lost = hb?.lost ?? []
        for (const x of Array.isArray(hb?.idle) ? hb.idle : []) {
          if (typeof x?.key !== 'string') continue
          const t = x.since == null ? null : typeof x.since === 'number' ? x.since : Date.parse(x.since)
          if (t === null || t > 0) book.set(x.key, t)
        }
      } catch (e) { acts.push({ desk: desk.name, act: 'heartbeat', ok: false, why: e.message }) }
      for (const l of lost) { acts.push({ desk: desk.name, key: l.key, act: 'lost', ...closeCase(root, desk.name, l.key, `claim lost to ${l.holder ?? 'nobody'}`, o) }) }
    }
    // 2. claims this machine holds whose session is gone: release them
    const st = readCases(root)
    const liveNames = new Set(childrenOf(o.live(), desk).map((s) => s.name))
    for (const [k, v] of Object.entries(st)) {
      if (!k.startsWith(desk.name + '--') || v.closedAt || !v.openedAt) continue
      const key = k.slice(desk.name.length + 2)
      if (!liveNames.has(childName(desk, key))) { release(root, desk, pc, key, childName(desk, key), 'the session is gone', o); acts.push({ desk: desk.name, key, act: 'released', why: 'the session is gone' }) }
    }
    // 3. idle longer than idleCloseMinutes: close
    const procs = (o.procs ?? processTable)()
    for (const s of childrenOf(o.live(), desk)) {
      const since = idleSince(desk, s, procs, { ...o, root }, book.has(s.name.split('--')[1]) ? { since: book.get(s.name.split('--')[1]) } : null)
      const idleMin = since != null ? (o.now() - since) / 60_000 : 0
      if (idleMin >= pc.idleCloseMinutes) acts.push({ desk: desk.name, key: s.name.split('--')[1], act: 'idle-close', ...closeCase(root, desk.name, s.name.split('--')[1], `idle ${Math.round(idleMin)} min`, o) })
    }
    // 3b. the case tabs nobody is in: every sweep, so a tab a close missed is closed on the next one
    const term = termOf(root, o)
    if (term?.close && typeof term.titles === 'function') {
      let tabs = []
      try { tabs = term.titles({ orphaned: true }) ?? [] } catch {}
      for (const x of strayCaseTabs(desk, pc, tabs, o.live())) {
        try { term.close(x.handle, { tab: true }); acts.push({ desk: desk.name, key: x.key, act: 'stray-tab', state: 'closed', why: `${x.title}: no claude in it, no live session, quiet ${x.quietMin} min` }) }
        catch (e) { acts.push({ desk: desk.name, key: x.key, act: 'stray-tab', ok: false, why: `${x.title}: ${e.message ?? e}` }) }
      }
    }
    // 4. open what is waiting, oldest first, up to the cap. Not for a desk
    // that is off here: it claims nothing new, and the lead hears what it owes
    const sw = readSwitch(root)
    if (!sw.error && deskOn(sw, desk).outside) continue   // another department's: not this machine's to sweep or report
    if (sw.error || !deskOn(sw, desk).on) {
      const w = openWork(root, desk, { cfg: o.cfg, adapter: o.adapter })
      if (!sw.error) alertOff(root, o.cfg, desk, w, o.now())
      acts.push({ desk: desk.name, act: 'off', why: sw.error ?? `off on this machine; ${w.items.length} open item(s) left in the book` })
      continue
    }
    let waiting = []
    try { waiting = o.adapter(desk, pc, { op: 'open' })?.cases ?? [] } catch (e) { acts.push({ desk: desk.name, act: 'open', ok: false, why: e.message }); continue }
    for (const c of waiting) {
      if (!pc.key.test(c.key)) continue
      if (o.live().some((s) => isChild(s, desk, c.key))) continue
      if (childrenOf(o.live(), desk).length >= pc.max) { acts.push({ desk: desk.name, key: c.key, act: 'queued', why: `cap ${pc.max} reached; stays with ${desk.session}` }); continue }
      const CC = casesConfig(o.cfg)
      if (CC.maxLive) { const all = desksWithCases(root).filter((x) => x.pc).flatMap((x) => childrenOf(o.live(), x.desk)).length; if (all >= CC.maxLive) { acts.push({ desk: desk.name, key: c.key, act: 'queued', why: `this machine's cap (office.json cases.maxLive ${CC.maxLive}) reached` }); continue } }
      acts.push({ desk: desk.name, key: c.key, act: 'open', ...(await openCase(root, desk.name, c.key, { ...opts, brief: c.brief })) })
    }
  }
  return acts
}

// A message about a case goes to that case's session: -> { to, why }
export function route(root, text, opts = {}) {
  const o = defaults(root, opts)
  const live = o.live()
  for (const { desk, pc } of desksWithCases(root)) {
    if (!pc) continue
    const unanchored = new RegExp(pc.keySrc.replace(/^\^/, '').replace(/\$$/, ''), 'g')
    for (const m of String(text).matchAll(unanchored)) {
      if (!pc.key.test(m[0])) continue
      const hit = live.find((s) => isChild(s, desk, m[0]))
      if (hit) return { to: hit.name, why: `case ${m[0]} has its own session` }
      const sw = readSwitch(root)
      if (sw.error || !deskOn(sw, desk).on) return { to: null, why: `case ${m[0]} belongs to ${desk.session}, which is off on this machine: it stays in the book` }
      return { to: desk.session, why: `case ${m[0]} has no live session: ${desk.session} holds it (open one: node lib/cases.mjs open ${desk.name} ${m[0]})` }
    }
  }
  return { to: null, why: 'no case key in the text: it stays with whoever it was for' }
}

/**
 * The leftovers, every desk with cases: tabs nobody is in, and live case sessions idle past their desk's idleCloseMinutes. --apply closes them;
 * a session mid-turn (busy, or status unknown) is never closed. -> [{ desk, key, what: 'tab'|'session', name, why, done? }]
 */
export function tidy(root, { apply = false, ...opts } = {}) {
  const o = defaults(root, opts)
  const out = []
  const term = termOf(root, o)
  let tabs = []
  try { tabs = term?.titles?.({ orphaned: true }) ?? [] } catch {}
  const procs = (o.procs ?? processTable)()
  for (const { desk, pc } of desksWithCases(root)) {
    if (!pc) continue
    for (const x of strayCaseTabs(desk, pc, tabs, o.live())) {
      const row = { desk: desk.name, key: x.key, what: 'tab', name: x.title, why: `no claude in it, no live session, quiet ${x.quietMin} min` }
      if (apply && term?.close) { try { term.close(x.handle, { tab: true }); row.done = 'closed' } catch (e) { row.done = `failed: ${e.message ?? e}` } }
      out.push(row)
    }
    for (const s of childrenOf(o.live(), desk)) {
      const key = s.name.split('--')[1]
      const since = idleSince(desk, s, procs, { ...o, root })
      const idleMin = since != null ? Math.round((o.now() - since) / 60_000) : null
      if (s.status !== 'idle' || idleMin == null || idleMin < pc.idleCloseMinutes) continue
      const row = { desk: desk.name, key, what: 'session', name: s.name, why: `idle ${idleMin} min (over ${pc.idleCloseMinutes})` }
      if (apply) row.done = closeCase(root, desk.name, key, `tidy: idle ${idleMin} min`, o).why
      out.push(row)
    }
  }
  return out
}

export function list(root, opts = {}) {
  const o = defaults(root, opts)
  const live = o.live()
  return desksWithCases(root).map(({ desk, pc, error }) => error ? { desk: desk.name, error } : {
    desk: desk.name, kind: pc.kind, max: pc.max, managed: pc.adapter ? 'core' : 'office',
    children: childrenOf(live, desk).map((s) => ({ name: s.name, pid: s.pid, status: s.status ?? null })),
  })
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2)
  const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
  const words = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')))
  const VERBS = ['open', 'sweep', 'list', 'close', 'release', 'route', 'tidy']
  let root = null
  if (words.length && !VERBS.includes(words[0])) root = findOffice(words.shift())
  root ??= findOffice(process.cwd())
  const verb = words.shift()
  if (!root || !VERBS.includes(verb)) { console.error('usage: node lib/cases.mjs [root] open <desk> <key> | sweep | list | tidy [--apply] | close <desk> <key> [--why …] | release <desk> <key> --by <name> --said "…" | route "<text>"'); process.exit(1) }
  try {
    let out
    if (verb === 'open') out = await openCase(root, words[0], words[1])
    else if (verb === 'sweep') out = await sweep(root)
    else if (verb === 'list') out = list(root)
    else if (verb === 'tidy') out = tidy(root, { apply: args.includes('--apply') })
    else if (verb === 'close') out = closeCase(root, words[0], words[1], flag('--why') ?? 'closed by hand')
    else if (verb === 'release') out = forceRelease(root, words[0], words[1], { by: flag('--by'), said: flag('--said') })
    else out = route(root, words.join(' '))
    console.log(JSON.stringify(out, null, 2))
    const bad = (x) => ['refused', 'failed', 'clash', 'unknown'].includes(x?.state) || x?.ok === false
    process.exit((Array.isArray(out) ? out.some(bad) : bad(out)) ? 4 : 0)
  } catch (e) { console.error(`cases: ${e.message}`); process.exit(1) }
}
