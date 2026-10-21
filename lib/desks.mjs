// WHICH DESKS RUN ON THIS MACHINE.
//
//   node lib/desks.mjs [root] list
//   node lib/desks.mjs [root] on|off <desk>
//   node lib/desks.mjs [root] default on|off
//
// One office, several people: the owner runs every desk, someone else runs
// only design and inventory and never customer service. The switch is per
// machine, in .office/local.json, which the office's own .gitignore (`*`)
// keeps out of every commit:
//
//   { "desks": { "default": true, "enabled": { "customer": false } } }
//
// No file, or no "desks" key: every desk is on, exactly as before.
//
// ⛔ ONE ANSWER, ASKED EVERYWHERE. "Should this desk run here" is read by the
// starter, the boot hook, health (whose "dead" is what the watchdog restarts),
// desk-watch and the case sweep. Each asks deskOn(); none reads the file.
// ⛔ ONLY THE "desks" KEY IS READ. The file is never merged into office.json:
// an unreviewed, uncommitted file must not be able to change the wall, the
// sandbox, the role variable or the launch flags.
// ⛔ OFF STOPS NEW WORK, IT NEVER DROPS OLD WORK. Turning a desk off kills
// nothing and releases nothing: a running desk keeps running until someone
// closes it, case claims it holds keep their heartbeat, and the book keeps
// every queued case. What stops is starting it, restarting it, waking it and
// claiming new cases for it.
// ⛔ A BROKEN FILE IS NOT "ALL ON". The person who wrote it wanted fewer desks;
// reading it as empty starts the ones they meant to keep off. A start refuses
// and names the file.
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, readdirSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { readTasks } from './tasks.mjs'
import { projectDirOf, transcriptNames } from './conversation.mjs'
import { spawnSync } from 'node:child_process'
import { rosterSafe, sessionOf } from './desk.mjs'
import { findOffice } from './office.mjs'
import { readCases, perCaseOf, adapterCall } from './cases.mjs'
import { writeAlert } from './alerts.mjs'
import { readOfficeConfig } from './office.mjs'
import { isMain } from './is-main.mjs'
import { departmentsOf, machineOf } from './departments.mjs'

export const localFile = (root) => join(root, '.office', 'local.json')

// -> { default, enabled: {name: bool}, error, exists }
export function readSwitch(root) {
  let text
  try { text = readFileSync(localFile(root), 'utf8') } catch (e) {
    return { default: true, enabled: {}, exists: false, error: e.code === 'ENOENT' ? null : `${localFile(root)} cannot be read (${e.code ?? e.message})` }
  }
  const bad = (why) => ({ default: true, enabled: {}, exists: true, error: `${localFile(root)} ${why}` })
  let c
  try { c = JSON.parse(text) } catch (e) { return bad(`is not valid JSON (${e.message})`) }
  if (!c || typeof c !== 'object' || Array.isArray(c)) return bad('is not a JSON object')
  const D = c.desks ?? {}
  if (!D || typeof D !== 'object' || Array.isArray(D)) return bad('"desks" is not an object')
  if (D.default != null && typeof D.default !== 'boolean') return bad('"desks.default" is not true or false')
  const E = D.enabled ?? {}
  if (!E || typeof E !== 'object' || Array.isArray(E)) return bad('"desks.enabled" is not an object')
  for (const [k, v] of Object.entries(E)) if (typeof v !== 'boolean') return bad(`"desks.enabled.${k}" is not true or false`)
  return { default: D.default ?? true, enabled: { ...E }, exists: true, error: null, ...scopeOf(root) }
}

// departments (lib/departments.mjs): with an office.json block AND a machine
// setting, a desk of a department this machine does not run is OUTSIDE here.
// -> { outside: Map(desk -> department) | null, error? }
function scopeOf(root) {
  let cfg
  try { cfg = readOfficeConfig(root) } catch { return { outside: null } }
  const D = departmentsOf(cfg)
  if (!D.on) return { outside: null }
  const m = machineOf(root, cfg)
  if (m.error) return { outside: null, error: m.error }
  if (!m.set) return { outside: null }
  return { outside: new Map([...D.byDesk].filter(([, dep]) => !m.set.includes(dep))) }
}

// -> { on, source } for one desk (its id, or the desk). The lead is always on:
// it is the one that hears about desks that are off. Keyed by id (the folder),
// so renaming a desk leaves every machine's switch where it was.
export function deskOn(sw, desk) {
  const name = typeof desk === 'string' ? desk : desk?.name
  if (name === 'lead') return { on: true, source: 'the lead is always on' }
  // ⛔ OUTSIDE IS NOT OFF. An off desk here may still be running and holding
  // work; a desk outside this machine's departments is somebody else's. The
  // wall, the board and the alerts tell the two apart by "outside".
  if (sw.outside?.has(name)) return { on: false, outside: true, source: `department ${sw.outside.get(name)}, which this machine does not run` }
  if (name in sw.enabled) return { on: sw.enabled[name], source: '.office/local.json' }
  return { on: sw.default, source: sw.exists && sw.default === false ? '.office/local.json default' : 'default' }
}

// throws when the switch cannot be read: the callers that START things use this
export function switchOrThrow(root) {
  const sw = readSwitch(root)
  if (sw.error) throw new Error(`${sw.error}: fix or remove it (node lib/desks.mjs list); nothing is started while it is unreadable`)
  return sw
}

// office.json "openWork": the office's own list of what desks owe (promises,
// waiting work), as a command run at the office root. Every output line that
// names desk-<name> (or one of its case sessions) is one open item for it.
//   "openWork": "node scripts/desk/promise-watchdog.mjs --dry"   or
//   "openWork": { "command": "…", "timeoutSec": 60 }
// It must only READ: it runs on every sweep. Exit non-zero = UNKNOWN, never "nothing owed".
const runs = new Map()
export function officeOpenWork(root, cfg, { run = spawnSync, now = Date.now() } = {}) {
  const W = typeof cfg?.openWork === 'string' ? { command: cfg.openWork } : cfg?.openWork
  if (!W || typeof W.command !== 'string' || !W.command) return null
  const k = root + '\0' + W.command
  const hit = runs.get(k)
  if (hit && now - hit.at < 30_000) return hit.r
  const t = Number.isFinite(W.timeoutSec) ? W.timeoutSec : 60
  const s = run('/bin/sh', ['-c', W.command], { cwd: root, encoding: 'utf8', timeout: t * 1000 })
  const r = s.error || s.status !== 0
    ? { lines: [], error: `office.json openWork ${s.error?.code === 'ETIMEDOUT' ? `timed out after ${t} s` : s.error ? s.error.message : `exited ${s.status}`}` }
    : { lines: String(s.stdout ?? '').split('\n').map((l) => l.trim()).filter(Boolean), error: null }
  runs.set(k, { at: now, r })
  return r
}
// a line names a desk under its name now or its id (what an office wrote before a rename)
const namesEither = (line, id, title) => namesDesk(line, id) || (!!title && title !== id && namesDesk(line, title))
const titleOf = (root, id) => sessionOf(join(root, 'desks'), id).slice(5)
export const namesDesk = (line, name) => new RegExp(`(^|[^\\w-])desk-${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w]|-[\\w])`).test(line)

// The work a desk that is off still owes: case claims this machine holds for
// it, cases its book has waiting, and the office's own openWork lines naming
// it. -> { items: [line], unknown: [why] }
export function openWork(root, desk, { cfg = readOfficeConfig(root), adapter = (d, pc, req) => adapterCall(root, d, pc, req), run } = {}) {
  const items = [], unknown = []
  const ow = officeOpenWork(root, cfg, run ? { run } : {})
  if (ow?.error) unknown.push(ow.error)
  else if (ow) for (const l of ow.lines) if (namesEither(l, desk.name, desk.title ?? titleOf(root, desk.name))) items.push(l.slice(0, 200))
  for (const [k, v] of Object.entries(readCases(root))) {
    if (!k.startsWith(desk.name + '--') || v.closedAt) continue
    items.push(`case ${k.slice(desk.name.length + 2)} is claimed by this machine`)
  }
  let pc = null
  try { pc = perCaseOf(desk) } catch (e) { unknown.push(e.message) }
  if (pc?.adapter) {
    try { for (const c of adapter(desk, pc, { op: 'open' })?.cases ?? []) items.push(`case ${c.key} is waiting in the book`) }
    catch (e) { unknown.push(e.message) }
  }
  return { items, unknown }
}

// ── CLOSE WHEN IDLE, WAKE ON WORK (0.10.4) ──────────────────────────────────
// office.json "closeWhenIdle": { "<desk>": <minutes> | true (30) }. A desk not
// listed is never closed. Health judges (lib/health.mjs), heal acts
// (lib/heal.mjs); "is this desk closed on purpose" is asked here, by health,
// desk-watch and start, and nowhere else.
// ⛔ A CLOSED DESK HEARS ONLY WHAT openWork PRINTS: its socket is gone, a
// message to it reaches nobody. So no openWork = never closed, and openWork
// failing (UNKNOWN) = never closed, and a closed desk is woken.
export const IDLE_DEFAULT_MIN = 30
export const LAST_CALL_MIN = 5           // the lead: never within 5 min of its last tool call
export function closeWhenIdleOf(cfg, names) {
  const raw = cfg?.closeWhenIdle && typeof cfg.closeWhenIdle === 'object' && !Array.isArray(cfg.closeWhenIdle) ? cfg.closeWhenIdle : {}
  const known = new Set(names)
  const minutes = new Map(), unknown = []
  for (const [k, v] of Object.entries(raw)) {
    if (!known.has(k)) { unknown.push(k); continue }
    const m = v === true ? IDLE_DEFAULT_MIN : Number.isFinite(v) && v > 0 ? Math.max(v, LAST_CALL_MIN) : null
    if (m) minutes.set(k, m)
  }
  return { minutes, unknown }
}

// what waits for one standing desk: openWork lines naming it, and the owner's
// open tasks assigned to it. -> { items, unknown: why | null }
export function deskWork(root, cfg, name, { run, now } = {}) {
  const items = []
  const W = typeof cfg?.openWork === 'string' ? cfg.openWork : cfg?.openWork?.command
  if (!W) return { items, unknown: 'office.json declares no openWork, so nothing could wake it' }
  const ow = officeOpenWork(root, cfg, { ...(run ? { run } : {}), ...(now ? { now } : {}) })
  if (ow?.error) return { items, unknown: `${ow.error}: work waiting is UNKNOWN` }
  const title = titleOf(root, name)
  for (const l of ow?.lines ?? []) if (namesEither(l, name, title)) items.push(l.slice(0, 200))
  let tasks = []
  try { tasks = readTasks(root) } catch {}
  for (const t of tasks) if (['open', 'working', 'waiting'].includes(t.state) && [name, title].includes(String(t.assigned ?? '').replace(/^desk-/, ''))) items.push(`task ${t.id} "${String(t.title ?? '').slice(0, 80)}" (${t.state})`)
  return { items, unknown: null }
}

// .office/idled.json { "<desk>": { at, pid, sessionId, why } }: what heal closed on purpose
const idledFile = (root) => join(root, '.office', 'idled.json')
export function readIdled(root) { try { const j = JSON.parse(readFileSync(idledFile(root), 'utf8')); return j && typeof j === 'object' ? j : {} } catch { return {} } }
export function writeIdled(root, all) { mkdirSync(join(root, '.office'), { recursive: true }); writeFileSync(idledFile(root), JSON.stringify(all, null, 2)) }

// Is this desk closed on purpose, right now?
//   null                           no: not marked, or the mark is void (live, or it ran since)
//   { state: 'idled', marker }     closed on purpose, nothing waiting: not dead
//   { state: 'woken', why }        closed on purpose and work is waiting (or
//                                  UNKNOWN): dead, and heal's restart is the wake
// ⛔ THE MARK NEVER HIDES A CRASH. Once a transcript of this desk's own
// (not a case session's in the same folder) moved past the mark, it ran
// again, and a dead desk after that is a crash. 2 min of grace for the
// closing session's own last writes.
const SINCE_GRACE = 120_000
export function idledState(root, cfg, name, { configDir, sessions = [], work, now } = {}) {
  const m = readIdled(root)[name]
  if (!m || !Number.isFinite(m.at)) return null
  const own = [sessionOf(join(root, 'desks'), name), 'desk-' + name]
  if (sessions.some((s) => own.includes(s.name))) return null
  try {
    const dir = projectDirOf(join(root, 'desks', name), configDir)
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue
      if (statSync(join(dir, f)).mtimeMs <= m.at + SINCE_GRACE) continue
      const info = transcriptNames(join(dir, f), { tailToo: false })
      if (!info || info.birth == null || own.includes(info.birth)) return null
    }
  } catch {}
  // taken out of closeWhenIdle while closed: nothing keeps it closed any more
  if (!closeWhenIdleOf(cfg, [name]).minutes.has(name)) return { state: 'woken', why: 'no longer in closeWhenIdle', marker: m }
  const w = work ?? deskWork(root, cfg, name, now ? { now } : {})
  if (w.unknown) return { state: 'woken', why: w.unknown, marker: m }
  if (w.items.length) return { state: 'woken', why: w.items.slice(0, 3).join('; '), marker: m }
  return { state: 'idled', marker: m }
}

// the lead hears about an off desk that still owes work (once per quiet window)
export function alertOff(root, cfg, desk, w, now = Date.now()) {
  if (!w.items.length && !w.unknown.length) return false
  const text = w.items.length
    ? `${desk.session ?? 'desk-' + desk.name} is off on this machine and has ${w.items.length} open item(s): ${w.items.slice(0, 5).join('; ')}${w.items.length > 5 ? '; …' : ''}. Turn it on (node lib/desks.mjs on ${desk.name}) or hand them to someone who runs it.`
    : `${desk.session ?? 'desk-' + desk.name} is off on this machine and its open work could not be read (${w.unknown[0]})`
  return writeAlert(root, cfg, { type: 'DESK-OFF', subject: desk.session ?? `desk-${desk.name}`, text, quietKey: 'desk-off:' + desk.name, now })
}

function save(root, sw, patch = null) {
  mkdirSync(join(root, '.office'), { recursive: true })
  if (!existsSync(join(root, '.office', '.gitignore'))) writeFileSync(join(root, '.office', '.gitignore'), '# office-anything state and logs; never committed\n*\n')
  let c = {}
  try { c = JSON.parse(readFileSync(localFile(root), 'utf8')) } catch {}
  if (patch) Object.assign(c, patch)
  else c.desks = { default: sw.default, enabled: sw.enabled }
  const tmp = localFile(root) + '.tmp'
  writeFileSync(tmp, JSON.stringify(c, null, 2) + '\n')
  renameSync(tmp, localFile(root))
}

// -> { ok, lines }
export function setDesk(root, name, on, { cfg = readOfficeConfig(root), live = [], adapter } = {}) {
  const sw = readSwitch(root)
  if (sw.error) return { ok: false, lines: [`${sw.error}: fix or remove it first`] }
  const { desks } = rosterSafe(join(root, 'desks'))
  // by id or by name; stored under the id, so a rename leaves it in place
  const d = desks.find((x) => x.name === name) ?? desks.find((x) => x.title === name)
  if (!d) return { ok: false, lines: [`no desk called ${name} (have: ${desks.map((x) => x.name).join(' ')})`] }
  if (d.kind === 'lead') return { ok: false, lines: [`${name} is the lead: it is always on`] }
  if (sw.outside?.has(d.name)) return { ok: false, lines: [`${d.session} is in department ${sw.outside.get(d.name)}, which this machine does not run: switching it here changes nothing. Add the department (node lib/desks.mjs departments set …) if this machine should run it`] }
  sw.enabled[d.name] = on
  save(root, sw)
  const lines = [`${d.session}: ${on ? 'ON' : 'OFF'} on this machine (.office/local.json${d.title !== d.name ? `, under its id ${d.name}` : ''})`]
  if (!on) {
    // by name AND by folder: another office on this machine can have a desk of the same name
    const s = live.find((x) => (x.name === d.session || x.name === `desk-${d.name}`) && (!x.cwd || x.cwd === root || x.cwd.startsWith(root + sep)))
    if (s) lines.push(`  still running (pid ${s.pid}): nothing was closed. It stops being restarted or woken; close it yourself when its work is handed over.`)
    const w = openWork(root, d, { cfg, ...(adapter ? { adapter } : {}) })
    for (const i of w.items) lines.push(`  ⚠ open: ${i}`)
    for (const u of w.unknown) lines.push(`  ⚠ open work unknown: ${u}`)
    if (alertOff(root, cfg, d, w)) lines.push('  the lead has been alerted')
  } else {
    // a per-case desk's sessions are opened by the case sweep, not by starting the desk
    let pc = null
    try { pc = perCaseOf(d) } catch {}
    lines.push(pc?.adapter ? `  its cases open on the next case sweep (node lib/cases.mjs sweep)` : `  start it with /desk-start ${d.name}`)
  }
  return { ok: true, lines }
}

// ── departments on this machine (lib/departments.mjs) ───────────────────────
//   departments                  what this machine runs, and what that means
//   departments set <id> [<id>…] write it (the setup step before a block goes live)
//   department <id>              exit 0 only when this machine names <id> itself
export function listDepartments(root, cfg = readOfficeConfig(root)) {
  const D = departmentsOf(cfg)
  if (!D.on) {
    let pre = null
    try { pre = JSON.parse(readFileSync(localFile(root), 'utf8')).departments ?? null } catch {}
    return { ok: true, lines: ['office.json declares no departments: every desk and the lead run as before', ...(Array.isArray(pre) ? [`this machine is set for: ${pre.join(', ')} (applies when office.json adds them)`] : [])] }
  }
  const m = machineOf(root, cfg)
  const lines = []
  if (m.error) lines.push(`⚠ ${m.error}`)
  else if (!m.set) lines.push('⚠ this machine names no department: no department lead is started or restarted here. Run: node lib/desks.mjs departments set <id> …')
  else lines.push(`this machine runs department(s): ${m.set.join(', ')}${m.sweeps ? '; it runs the office-wide sweeps' : ''}`)
  const desks = rosterSafe(join(root, 'desks')).desks
  for (const d of D.list) {
    const here = m.set?.includes(d.id)
    const names = d.desks.map((k) => desks.find((x) => x.name === k)?.session ?? `${k} (no such desk)`)
    lines.push(`${here ? 'here' : '--  '}  ${d.id}: lead ${d.names.join(' / ')}; desks ${names.join(', ') || 'none'}`)
  }
  const loose = desks.filter((d) => d.kind !== 'lead' && !D.byDesk.has(d.name)).map((d) => d.session)
  if (loose.length) lines.push(`in no department (every machine's): ${loose.join(', ')}`)
  for (const p of D.problems) lines.push(`⚠ ${p}`)
  return { ok: !m.error && !D.problems.length, lines }
}

export function setDepartments(root, ids, { cfg = readOfficeConfig(root) } = {}) {
  const D = departmentsOf(cfg)
  // ⛔ THE SETTING COMES BEFORE THE BLOCK (0.12.1). The cutover is: set every
  // machine, then add the block, so a machine is never caught with a block and
  // no setting. 0.12.0 refused to set before the block existed, which made the
  // documented order impossible (the lead, at the cutover). Without a block the
  // ids are written as asked and checked when the block arrives: an id it does
  // not declare is then an error, and starts are refused until it is fixed.
  if (!D.on) {
    const bad = ids.filter((x) => !/^[a-z][a-z0-9-]{0,39}$/.test(x))
    if (!ids.length || bad.length) return { ok: false, lines: [bad.length ? `not a department id: ${bad.join(', ')}` : 'name at least one department'] }
    save(root, null, { departments: [...new Set(ids)] })
    return { ok: true, lines: [`.office/local.json: departments → ${[...new Set(ids)].join(', ')}`, 'office.json declares no departments yet: this applies when office.json adds them (an id it does not declare is then refused), and until then nothing changes on this machine.'] }
  }
  const unknown = ids.filter((x) => !D.list.some((d) => d.id === x))
  if (!ids.length || unknown.length) return { ok: false, lines: [unknown.length ? `office.json declares no department ${unknown.join(', ')} (it has: ${D.list.map((d) => d.id).join(', ')})` : 'name at least one department'] }
  const before = machineOf(root, cfg).set
  save(root, null, { departments: [...new Set(ids)] })
  const r = listDepartments(root, cfg)
  return { ok: r.ok, lines: [`.office/local.json: departments ${before ? before.join(', ') : '(none)'} → ${[...new Set(ids)].join(', ')}`, ...r.lines, 'Restart this machine\'s sessions (or let heal) for the leads and desks to follow.'] }
}

// "sweeps": true: this machine runs the office-wide sweeps (one machine does)
export function setSweeps(root, on) {
  save(root, null, { sweeps: on })
  return { ok: true, lines: [`.office/local.json: sweeps ${on ? 'ON: this machine runs the office-wide sweeps; health asks each department\'s sweepsLease that it holds them' : 'off'}`] }
}

export function inDepartment(root, id, cfg = readOfficeConfig(root)) {
  // an explicit setting is explicit before the block exists too: the buyer
  // machinery on the owner's Mac must keep starting through the cutover
  const m = departmentsOf(cfg).on ? machineOf(root, cfg) : (() => { try { const d = JSON.parse(readFileSync(localFile(root), 'utf8')).departments; return { set: Array.isArray(d) ? d.filter((x) => typeof x === 'string') : null, error: null } } catch { return { set: null, error: null } } })()
  if (m.error) return { ok: false, lines: [m.error] }
  return m.set?.includes(id)
    ? { ok: true, lines: [`this machine names department ${id}`] }
    : { ok: false, lines: [`this machine does not name department ${id} in .office/local.json${m.set ? ` (it names ${m.set.join(', ')})` : ' (it names none)'}`] }
}

export function setDefault(root, on) {
  const sw = readSwitch(root)
  if (sw.error) return { ok: false, lines: [`${sw.error}: fix or remove it first`] }
  sw.default = on
  save(root, sw)
  return { ok: true, lines: [`desks not named in .office/local.json are now ${on ? 'ON' : 'OFF'} on this machine`] }
}

// -> { ok, lines }: every desk, on or off, and why; names in the file that are no desk
export function listDesks(root) {
  const sw = readSwitch(root)
  const { desks } = rosterSafe(join(root, 'desks'))
  const lines = []
  if (sw.error) lines.push(`⚠ ${sw.error}: starts are refused until it is fixed`)
  for (const d of desks) {
    if (d.kind === 'lead') continue
    const r = deskOn(sw, d)
    if (r.outside) { lines.push(`--   ${d.session}  · ${r.source}`); continue }
    lines.push(`${(r.on ? 'on ' : 'OFF') + '  ' + d.session}${d.title !== d.name ? ` (id ${d.name})` : ''}${d.autostart === false ? '  (autostart off)' : ''}  · ${r.source}`)
  }
  const names = new Set(desks.map((d) => d.name))
  const unknown = Object.keys(sw.enabled).filter((k) => !names.has(k))
  for (const k of unknown) lines.push(`⚠ "${k}" in .office/local.json is not a desk here: it switches nothing`)
  const here = desks.filter((d) => d.kind !== 'lead' && !deskOn(sw, d).outside)
  const off = here.filter((d) => !deskOn(sw, d).on).length
  const away = desks.filter((d) => d.kind !== 'lead').length - here.length
  lines.unshift(`this machine runs ${here.length - off} of ${here.length} desks${off ? ` (${off} off)` : ''}${away ? `; ${away} belong to departments it does not run` : ''}`)
  return { ok: !sw.error && !unknown.length, lines }
}

if (isMain(import.meta.url)) {
  const a = process.argv.slice(2)
  const VERBS = ['list', 'on', 'off', 'default', 'departments', 'department']
  const root = a.length && !VERBS.includes(a[0]) ? findOffice(a.shift()) : findOffice(process.cwd())
  const verb = a.shift()
  const usage = 'usage: node lib/desks.mjs [root] list | on <desk> | off <desk> | default on|off | departments [set <id> … | sweeps on|off] | department <id>'
  if (!root || !VERBS.includes(verb)) { console.error(usage); process.exit(1) }
  let r
  if (verb === 'list') r = listDesks(root)
  else if (verb === 'departments') r = a[0] === 'set' ? setDepartments(root, a.slice(1)) : a[0] === 'sweeps' && ['on', 'off'].includes(a[1]) && a.length === 2 ? setSweeps(root, a[1] === 'on') : a.length ? null : listDepartments(root)
  else if (verb === 'department') r = a.length === 1 ? inDepartment(root, a[0]) : null
  else if (verb === 'default' && ['on', 'off'].includes(a[0])) r = setDefault(root, a[0] === 'on')
  else if (verb !== 'default' && a[0]) {
    let live = []
    try { const { liveSessions, processTable } = await import('./procs.mjs'); live = liveSessions((await import('node:os')).homedir(), processTable()) } catch {}
    r = setDesk(root, a[0], verb === 'on', { live })
  } else { console.error(usage); process.exit(1) }
  if (!r) { console.error(usage); process.exit(1) }
  console.log(r.lines.join('\n'))
  process.exit(r.ok ? 0 : 4)
}
