// THE LEAD'S PERSISTENT TASK LIST (owner request, 2026-10-18).
//
// What the owner asks for lived in chat and in memory, and a context summary lost
// it once: two buyers were found unanswered by the owner himself. So the list is a
// FILE the lead puts things down in, and hooks put the open ones back in its
// context (hooks/tasks-boot.mjs), so a context reset cannot lose them.
//
//   .office/tasks.jsonl   append-only EVENTS, one JSON per line:
//     add     { id, said, title, source, assigned, due? }
//     update  { id, state?, assigned?, due?, note? }
//     verify  { id, evidence, proof }
//     drop    { id, reason }
//   every event also carries { at, by, ev }. The task is a FOLD of its events,
//   computed on read and never stored, so the file cannot disagree with itself.
//
// ⛔ THE LEAD WRITES NO FILE ITSELF. This script writes it; the lead's wall allows
// one anchored command shape (wall.lead.bash with {plugin}, see lib/wall.mjs).
// ⛔ WHO YOU ARE COMES FROM THE SESSION, NOT A FLAG. A desk may add a task (for the
// lead unless it names someone) and work its own; verify and drop are the lead's:
// "done" is somebody saying so, "verified" is somebody checking.
// ⛔ verified AND dropped ARE FINAL. A reopened task is a task nobody can trust.
//
//   node lib/tasks.mjs [root] add --said "<owner's words>" --title "…" [--source chat|discord|desk|alert|other]
//                              [--assigned <session|desk-x>] [--due YYYY-MM-DD]
//   node lib/tasks.mjs [root] update T-… [--state open|working|waiting|done] [--note "…"] [--assigned …] [--due …]
//   node lib/tasks.mjs [root] verify T-… --evidence "<path|url|text>" --proof "<one line>"
//   node lib/tasks.mjs [root] drop T-… --reason "<why, 10+ characters>"
//   node lib/tasks.mjs [root] list [--all] [--json] [--assigned <name>] [--overdue] [--owner]
//   node lib/tasks.mjs [root] digest        (writes .office/digest.md once a day, from 08:00)
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync, unlinkSync, copyFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readOfficeConfig, findOffice, whoIs, sessionName } from './office.mjs'
import { isMain } from './is-main.mjs'

const HOUR = 3600_000
export const SOURCES = ['chat', 'discord', 'desk', 'alert', 'other']
const OPEN = new Set(['open', 'working', 'waiting'])
const SETTABLE = new Set(['open', 'working', 'waiting', 'done'])
export const OPEN_STALE = 24 * HOUR
export const DONE_STALE = 6 * HOUR
const KEEP_SNAPSHOTS = 14

export const tasksFile = (root) => join(root, '.office', 'tasks.jsonl')
// a desk is desk-<name>; a dev session (ops-construction, alibaba-98…) is its registry name
const selfName = (by) => (by?.kind === 'desk' ? `desk-${by.desk}` : by?.kind === 'session' ? by.name : null)
const label = (by) => (by?.kind === 'lead' ? 'lead' : selfName(by) ?? 'owner')
const two = (n) => String(n).padStart(2, '0')
const ymd = (ms) => { const d = new Date(ms); return `${String(d.getFullYear()).slice(2)}${two(d.getMonth() + 1)}${two(d.getDate())}` }
const isoDay = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}` }

// ---- reading: the fold ----------------------------------------------------
export function readEvents(root) {
  let text = ''
  try { text = readFileSync(tasksFile(root), 'utf8') } catch { return [] }
  const out = []
  for (const l of text.split('\n')) { if (!l.trim()) continue; try { const e = JSON.parse(l); if (e && typeof e === 'object' && e.id) out.push(e) } catch {} }
  return out
}

export function readTasks(root) {
  const tasks = new Map()
  for (const e of readEvents(root)) {
    if (e.ev === 'add') {
      if (tasks.has(e.id)) continue
      tasks.set(e.id, { id: e.id, said: e.said, source: e.source, title: e.title, assigned: e.assigned, state: 'open', due: e.due ?? null, evidence: [], notes: [], created: e.at, updated: e.at, by: e.by, doneAt: null, closedAt: null })
      continue
    }
    const t = tasks.get(e.id)
    if (!t || t.state === 'verified' || t.state === 'dropped') continue
    t.updated = e.at
    if (e.ev === 'update') {
      if (e.state) { t.state = e.state; t.doneAt = e.state === 'done' ? e.at : null }
      if (e.assigned) t.assigned = e.assigned
      if (e.due !== undefined) t.due = e.due
      if (e.note) t.notes.push({ at: e.at, by: e.by, text: e.note })
    } else if (e.ev === 'verify') { t.state = 'verified'; t.closedAt = e.at; t.evidence.push({ at: e.at, by: e.by, evidence: e.evidence, proof: e.proof }) }
    else if (e.ev === 'drop') { t.state = 'dropped'; t.closedAt = e.at; t.reason = e.reason }
  }
  return [...tasks.values()]
}

// ---- writing: one lock, one append ------------------------------------------
const sleepMs = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } catch {} }
function withLock(root, fn) {
  const dir = join(root, '.office')
  mkdirSync(dir, { recursive: true })
  if (!existsSync(join(dir, '.gitignore'))) writeFileSync(join(dir, '.gitignore'), '# office-anything state and logs; never committed\n*\n')
  const lock = join(dir, 'tasks.lock')
  const t0 = Date.now()
  for (;;) {
    try { writeFileSync(lock, String(process.pid), { flag: 'wx' }); break } catch {}
    try { if (Date.now() - statSync(lock).mtimeMs > 10_000) { unlinkSync(lock); continue } } catch {}
    if (Date.now() - t0 > 8000) throw new Error('tasks: the task file is locked by another writer; try again')
    sleepMs(15 + Math.random() * 25)
  }
  try { return fn() } finally { try { unlinkSync(lock) } catch {} }
}

// a copy of the day's first state, so a deleted or damaged file loses at most a day
export function snapshot(root, now = Date.now()) {
  try {
    const f = tasksFile(root)
    if (!existsSync(f)) return null
    const dir = join(root, '.office', 'tasks-snapshots')
    mkdirSync(dir, { recursive: true })
    const day = isoDay(now).replace(/-/g, '')
    const to = join(dir, `tasks-${day}.jsonl`)
    if (!existsSync(to)) copyFileSync(f, to)
    const all = readdirSync(dir).filter((n) => /^tasks-\d{8}\.jsonl$/.test(n)).sort()
    for (const n of all.slice(0, Math.max(0, all.length - KEEP_SNAPSHOTS))) { try { unlinkSync(join(dir, n)) } catch {} }
    return to
  } catch { return null }
}

const append = (root, ev, now, by) => appendFileSync(tasksFile(root), JSON.stringify({ at: now, by: label(by), ...ev }) + '\n')
const find = (root, id) => { const t = readTasks(root).find((x) => x.id === id); if (!t) throw new Error(`no task ${id}`); return t }
const oneLine = (s) => !/[\r\n]/.test(String(s))

export function addTask(root, { said, title, source, assigned, due } = {}, { by = { kind: 'owner' }, now = Date.now() } = {}) {
  if (typeof said !== 'string' || !said.trim()) throw new Error('add needs --said: the owner\'s words, verbatim')
  if (typeof title !== 'string' || !title.trim()) throw new Error('add needs --title')
  if (!oneLine(title)) throw new Error('the title is one line')
  const src = source ?? (selfName(by) ? 'desk' : 'chat')
  if (!SOURCES.includes(src)) throw new Error(`source is one of ${SOURCES.join(', ')}`)
  if (due != null && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error('due is YYYY-MM-DD')
  return withLock(root, () => {
    snapshot(root, now)
    const prefix = `T-${ymd(now)}-`
    const n = readEvents(root).filter((e) => e.ev === 'add' && e.id.startsWith(prefix)).map((e) => +e.id.slice(prefix.length)).reduce((a, b) => Math.max(a, b), 0) + 1
    const id = prefix + n
    append(root, { ev: 'add', id, said, source: src, title: title.trim(), assigned: (assigned && String(assigned).trim()) || 'lead', due: due ?? null }, now, by)
    return readTasks(root).find((t) => t.id === id)
  })
}

export function updateTask(root, id, patch = {}, { by = { kind: 'owner' }, now = Date.now() } = {}) {
  return withLock(root, () => {
    const t = find(root, id)
    if (t.state === 'verified' || t.state === 'dropped') throw new Error(`${id} is ${t.state}, which is final: add a new task`)
    if (patch.state === 'verified') throw new Error('use verify, with evidence and a proof')
    if (patch.state === 'dropped') throw new Error('use drop, with a reason')
    if (patch.state != null && !SETTABLE.has(patch.state)) throw new Error(`state is one of ${[...SETTABLE].join(', ')}`)
    if (patch.due != null && patch.due !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(patch.due)) throw new Error('due is YYYY-MM-DD')
    if (selfName(by)) {
      if (t.assigned !== selfName(by)) throw new Error(`${id} is not assigned to ${selfName(by)} (it is ${t.assigned}); a session works only its own tasks`)
      if (patch.assigned != null && patch.assigned !== t.assigned) throw new Error('a desk cannot reassign a task; tell the lead')
    }
    if (patch.state == null && patch.assigned == null && patch.due == null && !patch.note) throw new Error('update needs --state, --note, --assigned or --due')
    if (patch.note != null && !oneLine(patch.note)) throw new Error('a note is one line')
    snapshot(root, now)
    append(root, { ev: 'update', id, ...(patch.state ? { state: patch.state } : {}), ...(patch.assigned ? { assigned: patch.assigned } : {}), ...(patch.due != null ? { due: patch.due === '' ? null : patch.due } : {}), ...(patch.note ? { note: patch.note } : {}) }, now, by)
    return find(root, id)
  })
}

export function verifyTask(root, id, { evidence, proof } = {}, { by = { kind: 'owner' }, now = Date.now() } = {}) {
  if (selfName(by)) throw new Error('only the lead verifies a task: a desk or session can say done, not checked')
  if (typeof evidence !== 'string' || !evidence.trim()) throw new Error('verify needs --evidence: a path, a link or what you saw')
  if (typeof proof !== 'string' || !proof.trim()) throw new Error('verify needs --proof: one line saying what the evidence proves')
  if (!oneLine(proof)) throw new Error('the proof is one line')
  return withLock(root, () => {
    const t = find(root, id)
    if (t.state === 'verified' || t.state === 'dropped') throw new Error(`${id} is ${t.state}, which is final`)
    snapshot(root, now)
    append(root, { ev: 'verify', id, evidence: evidence.trim(), proof: proof.trim() }, now, by)
    return find(root, id)
  })
}

export function dropTask(root, id, { reason } = {}, { by = { kind: 'owner' }, now = Date.now() } = {}) {
  if (selfName(by)) throw new Error('only the lead drops a task')
  if (typeof reason !== 'string' || reason.trim().length < 10) throw new Error('drop needs a --reason of at least 10 characters: why this is no longer wanted')
  return withLock(root, () => {
    const t = find(root, id)
    if (t.state === 'verified' || t.state === 'dropped') throw new Error(`${id} is ${t.state}, which is final`)
    snapshot(root, now)
    append(root, { ev: 'drop', id, reason: reason.trim() }, now, by)
    return find(root, id)
  })
}

// ---- views ---------------------------------------------------------------
export const age = (ms) => (ms < HOUR ? `${Math.max(0, Math.floor(ms / 60_000))}m` : ms < 24 * HOUR ? `${Math.floor(ms / HOUR)}h` : `${Math.floor(ms / (24 * HOUR))}d`)
const overdue = (t, now) => !!t.due && OPEN.has(t.state) && t.due < isoDay(now)

export function usageLines() {
  const cli = fileURLToPath(import.meta.url)
  return [
    `put down:  node ${cli} add --said "<the owner's words>" --title "<short>" [--assigned <session>] [--due YYYY-MM-DD] [--source chat|discord|desk|alert]`,
    `  node ${cli} update T-… --state working|waiting|done [--note "…"]  |  verify T-… --evidence "…" --proof "<one line>"  |  drop T-… --reason "…"  |  list [--all] [--json]`,
  ]
}

// the compact table a context reset can not lose. '' when nothing is open.
export function openTable(root, { now = Date.now() } = {}) {
  const open = readTasks(root).filter((t) => t.state !== 'verified' && t.state !== 'dropped').sort((a, b) => a.created - b.created)
  if (!open.length) return ''
  const rows = open.map((t) => `${t.id}  ${age(now - t.created)}  ${t.state}  ${t.assigned}  ${t.title.slice(0, 60)}${t.title.length > 60 ? '…' : ''}${overdue(t, now) ? `  OVERDUE (due ${t.due})` : ''}`)
  return [`OPEN TASKS (${open.length}): what the owner asked and has not seen finished. Close each with evidence (verify) or a reason (drop).`, ...rows, ...usageLines()].join('\n')
}

// the same name, with or without the desk- prefix
const sameName = (a, b) => { const n = (x) => String(x ?? '').replace(/^desk-/, ''); return n(a) === n(b) }
export function filterTasks(tasks, { assigned, overdue, owner } = {}, now = Date.now()) {
  return tasks.filter((t) => (!assigned || sameName(t.assigned, assigned)) && (!owner || t.assigned === 'owner') && (!overdue || overdue_(t, now)))
}
const overdue_ = (t, now) => !!t.due && OPEN.has(t.state) && t.due < isoDay(now)

// what ONE session holds: only the tasks assigned to its name, and only what it may do about them.
// '' when it has none.
export function sessionTable(root, name, { now = Date.now() } = {}) {
  const mine = filterTasks(readTasks(root), { assigned: name }, now).filter((t) => t.state !== 'verified' && t.state !== 'dropped').sort((a, b) => a.created - b.created)
  if (!mine.length) return ''
  const cli = fileURLToPath(import.meta.url)
  return [
    `YOUR TASKS (${mine.length}), assigned to ${name} by the lead for the owner. Work them, and keep them true:`,
    ...mine.map((t) => `${t.id}  ${t.state}  ${t.title.slice(0, 60)}${t.title.length > 60 ? '…' : ''}${t.due ? `  due ${t.due}` : ''}${overdue_(t, now) ? '  OVERDUE' : ''}`),
    `update:  node ${cli} update T-... --state working|waiting|done --note "<what changed>"   (the lead verifies; you never verify or drop)`,
  ].join('\n')
}

// the day's summary. The first section is plain text and fits one Discord post.
export function digestText(root, { now = Date.now() } = {}) {
  const all = readTasks(root)
  const open = all.filter((t) => OPEN.has(t.state) || t.state === 'done').sort((a, b) => a.created - b.created)
  const by = new Map()
  for (const t of open) { const k = t.assigned; const r = by.get(k) ?? { open: 0, over: 0 }; r.open++; if (overdue_(t, now)) r.over++; by.set(k, r) }
  const over = open.filter((t) => overdue_(t, now))
  const fin = all.filter((t) => (t.state === 'done' || t.state === 'verified') && now - Math.max(t.closedAt ?? 0, t.doneAt ?? 0) < 24 * HOUR)
  const row = (t) => `${t.id} ${t.title.slice(0, 60)} (${t.assigned}${t.due ? `, due ${t.due}` : ''})`
  // each list shows its first eight and says how many more: a long one must not push the other off the post
  const cap = (l) => [...l.slice(0, 8).map(row), ...(l.length > 8 ? [`+${l.length - 8} more (see digest.md)`] : [])]
  const head = [`# Task queue ${isoDay(now)}: ${open.length} open`, ...[...by].sort((a, b) => b[1].open - a[1].open).map(([k, r]) => `${k}: ${r.open} open (${r.over} overdue)`), `OVERDUE: ${over.length}`, `done in the last 24 h: ${fin.length}`]
  // the lists come after the counts, so a long one is the part that gets cut
  let first = [...head, ...(over.length ? ['OVERDUE:', ...cap(over)] : []), ...(fin.length ? ['DONE:', ...cap(fin)] : [])].join('\n')
  if (first.length > 1800) first = first.slice(0, 1790).replace(/\n[^\n]*$/, '') + '\n…'
  const detail = open.map((t) => `${t.id}  ${age(now - t.created)}  ${t.state}  ${t.assigned}  ${t.title}${t.due ? `  due ${t.due}` : ''}`)
  return open.length || fin.length ? `${first}\n\n## All open work\n${detail.join('\n')}\n` : ''
}

// .office/digest.md, once a day, from 08:00 local; nothing to say writes nothing
export function writeDigest(root, { now = Date.now() } = {}) {
  if (new Date(now).getHours() < 8) return { written: false, why: 'before 08:00' }
  const f = join(root, '.office', 'digest.md')
  const day = isoDay(now)
  try { if (readFileSync(f, 'utf8').startsWith(`# Task queue ${day}`)) return { written: false, why: 'already written today' } } catch {}
  const text = digestText(root, { now })
  if (!text) return { written: false, why: 'nothing to say' }
  mkdirSync(join(root, '.office'), { recursive: true })
  writeFileSync(f, text)
  return { written: true, file: f }
}

// open with no update for a day, or done and not checked for six hours
export function staleTasks(root, { now = Date.now() } = {}) {
  const out = []
  for (const t of readTasks(root)) {
    if (OPEN.has(t.state) && now - t.updated > OPEN_STALE) out.push({ id: t.id, title: t.title, assigned: t.assigned, quiet: true, hours: Math.floor((now - t.updated) / HOUR), why: `open ${Math.floor((now - t.updated) / HOUR)}h with no update` })
    else if (t.state === 'done' && now - (t.doneAt ?? t.updated) > DONE_STALE) out.push({ id: t.id, title: t.title, assigned: t.assigned, why: `done ${Math.floor((now - (t.doneAt ?? t.updated)) / HOUR)}h ago and not verified` })
  }
  return out
}

// ---- the command line ------------------------------------------------------
const COMMANDS = new Set(['add', 'update', 'verify', 'drop', 'list', 'digest'])
function parse(argv) {
  const words = [], flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) flags[k] = true; else { flags[k] = v; i++ } } else words.push(a)
  }
  return { words, flags }
}

export function run(argv, { cwd = process.cwd(), env = process.env, out = (s) => console.log(s) } = {}) {
  let { words, flags } = parse(argv)
  let root = null
  if (words.length && !COMMANDS.has(words[0])) root = findOffice(resolve(words.shift()))
  root = root ?? findOffice(cwd)
  const cmd = words.shift()
  if (!root || !COMMANDS.has(cmd)) throw new Error('usage: node lib/tasks.mjs [root] add|update|verify|drop|list …  (run inside an office)')
  const cfg = readOfficeConfig(root)
  const w = whoIs(root, cfg, { cwd, env })
  if (w?.kind === 'unknown') throw new Error(`this session calls itself ${w.role}, and this office has no such desk`)
  const sess = w?.kind ? null : (env[cfg.roleEnv] || sessionName({ configDir: env.CLAUDE_CONFIG_DIR || undefined }))
  const by = w?.kind === 'lead' ? { kind: 'lead' } : w?.kind === 'desk' ? { kind: 'desk', desk: w.desk } : sess ? { kind: 'session', name: sess } : { kind: 'owner' }
  const str = (v) => (typeof v === 'string' ? v : undefined)
  if (cmd === 'add') { const t = addTask(root, { said: str(flags.said), title: str(flags.title), source: str(flags.source), assigned: str(flags.assigned), due: str(flags.due) }, { by }); out(`${t.id} added (${t.assigned})`) }
  else if (cmd === 'update') { const t = updateTask(root, words[0], { state: str(flags.state), note: str(flags.note), assigned: str(flags.assigned), due: flags.due === true ? '' : str(flags.due) }, { by }); out(`${t.id} ${t.state} (${t.assigned})`) }
  else if (cmd === 'verify') { const t = verifyTask(root, words[0], { evidence: str(flags.evidence), proof: str(flags.proof) }, { by }); out(`${t.id} verified`) }
  else if (cmd === 'digest') { const r = writeDigest(root); out(r.written ? `digest written: ${r.file}` : `no digest: ${r.why}`) }
  else if (cmd === 'drop') { const t = dropTask(root, words[0], { reason: str(flags.reason) }, { by }); out(`${t.id} dropped`) }
  else {
    const all = readTasks(root).sort((a, b) => a.created - b.created)
    const live = flags.all ? all : all.filter((t) => t.state !== 'verified' && t.state !== 'dropped')
    const filtered = flags.assigned || flags.overdue || flags.owner
    const shown = filterTasks(live, { assigned: str(flags.assigned), overdue: !!flags.overdue, owner: !!flags.owner })
    if (flags.json) out(JSON.stringify(shown, null, 2))
    else out(flags.all || filtered ? (shown.map((t) => `${t.id}  ${t.state}  ${t.assigned}  ${t.title}`).join('\n') || 'no tasks') : (openTable(root) || 'no open tasks'))
  }
}

if (isMain(import.meta.url)) {
  try { run(process.argv.slice(2)) } catch (e) { console.error(`tasks: ${e.message}`); process.exit(1) }
}
