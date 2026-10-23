// DURABLE OFFICE SCHEDULES (0.19.0). The owner, 2026-10-23: "if a scheduled
// run's session isn't there, it must init itself." The AICS desk move was a
// session-only cron in one builder's memory: had that session closed before
// 05:07Z, nothing would have run and nobody would have been told.
//
// A job is the office's, not a session's: one record in .office/schedule.json
// and its brief in .office/schedule/<id>.md, on disk, read by the watchdog
// (health --heal, every 120 s). When a job is due, its ROLE (office.json
// "profiles", lib/role.mjs) does it:
//   the role is running here, idle at an empty prompt -> one line typed into its tab
//   it is running but busy or asking                  -> the next pass tries again
//   it is not running                                 -> the office opens the role with
//                                                        that line as its first message
//   the window (until) passed                         -> missed, and the lead is told
// The line points at the brief; the session says `done` when it has finished.
//
//   node lib/schedule.mjs [root] add --id <id> --at <ISO> [--until <ISO>] --role <role> --file <brief.md>
//   node lib/schedule.mjs [root] add --id <id> --parked --role <role> --file <brief.md>
//                                    [--needs-plugin ">=0.20.0"] [--needs-command "<exits 0 when ready>"]
//   node lib/schedule.mjs [root] run <id>       a parked job: due now (the watchdog hands it)
//   node lib/schedule.mjs [root] list [--json]
//   node lib/schedule.mjs [root] cancel <id> --why "<reason, 20+ characters>"
//   node lib/schedule.mjs [root] done <id> [--note "..."]
//
// ⭐ PARKED JOBS (0.20.1). The owner: prepared work starts with one easy
// command, by whoever opens a session, coworkers included. A parked job has no
// time: it waits until somebody runs it (/office-job run <id>), and every
// session that may run it is told at its start (hooks/desk-boot.mjs). "needs"
// holds it back until it can work: a plugin version, or a command that exits 0.
// ⛔ run NEVER HANDS IT ITSELF. It makes the job due now and the watchdog's next
// pass hands it the one way runDue always does: two writers would hand it twice.
// ⛔ A needs COMMAND RUNS ONLY IN THE CALLER'S run, where it is printed first,
// never in the watchdog, which would run whatever schedule.json says every pass.
//
// ⛔ ONE JOB, ONE RUN. A job is handed once; a session-only cron for the same
// work must be removed when the job is added, or two sessions do it.
// ⛔ NOT FROM A DESK. A desk that could schedule a role would open a session
// outside its own wall, the same reason a desk does not open a role.
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { isMain } from './is-main.mjs'
import { findOffice, readOfficeConfig, whoIs } from './office.mjs'
import { rolesHere, running, openRole } from './role.mjs'
import { liveSessions, processTable } from './procs.mjs'
import { transcriptTail } from './compact.mjs'
import { menuOf, atPrompt, tabFor } from './limits.mjs'
import { writeAlert } from './alerts.mjs'
import { pathsFor } from './watchdog.mjs'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ID = /^[a-z0-9][a-z0-9-]{2,40}$/
const HOUR = 3600_000
export const DEFAULT_WINDOW = 4 * HOUR
const MAX_BRIEF = 40_000
const SEMVER = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return true }
// the version of the plugin this code is
export const pluginVersion = (pluginRoot = PLUGIN_ROOT) => { try { return JSON.parse(readFileSync(join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8')).version ?? null } catch { return null } }

// a job's "needs" -> null (fine) | why it is not valid
function needsProblem(n) {
  if (n == null) return null
  if (typeof n !== 'object' || Array.isArray(n)) return 'needs must be { plugin?, command? }'
  for (const k of Object.keys(n)) if (!['plugin', 'command'].includes(k)) return `needs.${k} is not a gate (plugin, command)`
  if (n.plugin != null && !(typeof n.plugin === 'string' && /^>=\s*\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(n.plugin))) return `needs.plugin ${JSON.stringify(n.plugin)}: write ">=0.20.0"`
  if (n.command != null && !(typeof n.command === 'string' && n.command.trim() && n.command.length <= 500 && !/[\r\n]/.test(n.command))) return 'needs.command is one line, at most 500 characters'
  return null
}
// is the job's plugin gate met by this code -> null | why not
export function pluginGate(job, version = pluginVersion()) {
  const want = job?.needs?.plugin ? job.needs.plugin.replace(/^>=\s*/, '') : null
  if (!want) return null
  if (!version || !SEMVER.test(version)) return `it needs office-anything ${job.needs.plugin}, and this plugin's version cannot be read`
  return newer(version, want) ? null : `it needs office-anything ${job.needs.plugin}; this is ${version}. Install the newer plugin, then run it again`
}

export const scheduleFile = (root) => join(root, '.office', 'schedule.json')
export const briefRel = (id) => `.office/schedule/${id}.md`

export function readJobs(root) {
  try { const j = JSON.parse(readFileSync(scheduleFile(root), 'utf8')); return Array.isArray(j?.jobs) ? j.jobs : [] } catch { return [] }
}
// written whole and renamed into place: a watchdog pass never reads half a file
function writeJobs(root, jobs) {
  mkdirSync(join(root, '.office'), { recursive: true })
  if (!existsSync(join(root, '.office', '.gitignore'))) writeFileSync(join(root, '.office', '.gitignore'), '# office-anything state and logs; never committed\n*\n')
  const f = scheduleFile(root), tmp = `${f}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify({ jobs }, null, 1) + '\n')
  renameSync(tmp, f)
}
const update = (root, id, fn) => { const jobs = readJobs(root); const j = jobs.find((x) => x.id === id); if (!j) return null; fn(j); writeJobs(root, jobs); return j }

// the one line the role is given: where the brief is, and how to close it
export const jobLine = (job, pluginRoot = PLUGIN_ROOT) =>
  `Scheduled office job ${job.id} is due (${job.at}). Read ${job.brief} and do it now. When it is finished, run: node ${pluginRoot}/lib/schedule.mjs . done ${job.id}`

// -> { job } | { why }
export function addJob(root, { id, at, until = null, role, text, by = null, parked = false, needs = null }, { cfg = readOfficeConfig(root), now = Date.now(), caller = null } = {}) {
  if (caller?.kind === 'desk') return { why: `a desk does not schedule a role (it is desk ${caller.desk}): that is the lead's or a developer's` }
  if (!ID.test(String(id ?? ''))) return { why: `job id ${JSON.stringify(id)}: lower-case letters, digits and -, 3 to 41 characters` }
  const np = needsProblem(needs)
  if (np) return { why: np }
  let a = null, u = null
  if (parked) {
    if (at != null || until != null) return { why: 'a parked job has no time: it runs when somebody runs it (/office-job run <id>)' }
  } else {
    a = Date.parse(at ?? ''); u = until == null ? a + DEFAULT_WINDOW : Date.parse(until)
    if (!Number.isFinite(a)) return { why: `--at ${JSON.stringify(at)} is not a time (ISO, e.g. 2026-10-23T05:07:00Z), or --parked for a job that waits to be run` }
    if (!Number.isFinite(u) || u <= a) return { why: '--until must be a time after --at' }
    if (u <= now) return { why: `its window already closed (${new Date(u).toISOString()})` }
  }
  const R = rolesHere(root, cfg)
  if (!R.list.some((p) => p.name === role)) return { why: R.hidden.includes(role) ? `${role} belongs to a department this machine does not run: it would never run here` : `no role called ${role}; this machine may open: ${R.list.map((p) => p.name).join(', ') || 'none'}` }
  const t = String(text ?? '')
  if (!t.trim()) return { why: 'the brief is empty: say what the job is' }
  if (t.length > MAX_BRIEF) return { why: `the brief is ${t.length} characters, at most ${MAX_BRIEF}` }
  const jobs = readJobs(root)
  if (jobs.some((j) => j.id === id)) return { why: `a job ${id} exists already (${jobs.find((j) => j.id === id).state}): one id, one job` }
  mkdirSync(join(root, '.office', 'schedule'), { recursive: true })
  writeFileSync(join(root, briefRel(id)), t.endsWith('\n') ? t : t + '\n')
  const job = parked
    ? { id, at: null, until: null, role, brief: briefRel(id), by, created: new Date(now).toISOString(), state: 'parked', ...(needs ? { needs } : {}) }
    : { id, at: new Date(a).toISOString(), until: new Date(u).toISOString(), role, brief: briefRel(id), by, created: new Date(now).toISOString(), state: 'pending', ...(needs ? { needs } : {}) }
  writeJobs(root, [...jobs, job])
  return { job }
}

// a desk neither calls off nor closes a job: either would stop a run outside its own wall
const deskNo = (caller, what) => (caller?.kind === 'desk' ? { why: `a desk does not ${what} a scheduled job (it is desk ${caller.desk})` } : null)
export function cancelJob(root, id, why, { caller = null } = {}) {
  const d = deskNo(caller, 'cancel'); if (d) return d
  if (String(why ?? '').trim().length < 20) return { why: 'a cancel needs a reason of 20+ characters, recorded on the job' }
  const j = update(root, id, (x) => { if (['pending', 'handed', 'parked'].includes(x.state)) Object.assign(x, { state: 'cancelled', cancelled: new Date().toISOString(), why: String(why).trim() }) })
  if (!j) return { why: `no job ${id}` }
  return j.state === 'cancelled' ? { job: j } : { why: `job ${id} is ${j.state}: nothing to cancel` }
}
export function doneJob(root, id, note = null, { caller = null } = {}) {
  const d = deskNo(caller, 'close'); if (d) return d
  const j = update(root, id, (x) => { if (x.state !== 'cancelled') Object.assign(x, { state: 'done', done: new Date().toISOString(), ...(note ? { note: String(note).slice(0, 500) } : {}) }) })
  return j ? (j.state === 'done' ? { job: j } : { why: `job ${id} was cancelled` }) : { why: `no job ${id}` }
}

// a parked job, run now: due now, its window the default, handed by the
// watchdog's next pass. -> { job } | { why }
export function runJob(root, id, { cfg = readOfficeConfig(root), now = Date.now(), caller = null, by = null, version = pluginVersion(), run = spawnSync, say = () => {} } = {}) {
  const d = deskNo(caller, 'run'); if (d) return d
  const j0 = readJobs(root).find((x) => x.id === id)
  if (!j0) return { why: `no job ${id}` }
  if (j0.state !== 'parked') return { why: `job ${id} is ${j0.state}, not parked: ${j0.state === 'pending' ? 'it is due already, the watchdog hands it' : 'nothing to run'}` }
  const R = rolesHere(root, cfg)
  if (!R.list.some((p) => p.name === j0.role)) return { why: R.hidden.includes(j0.role) ? `its role ${j0.role} belongs to a department this machine does not run: run it on that machine` : `no role called ${j0.role} on this machine` }
  const g = pluginGate(j0, version)
  if (g) return { why: g }
  if (j0.needs?.command) {
    say(`checking: ${j0.needs.command}`)
    const r = run('/bin/sh', ['-c', j0.needs.command], { cwd: root, encoding: 'utf8', timeout: 30_000 })
    if (r.error || r.status !== 0) return { why: `it needs \`${j0.needs.command}\` to exit 0, and it ${r.error ? `failed (${r.error.message})` : `exited ${r.status}`}${String(r.stdout ?? '').trim() || String(r.stderr ?? '').trim() ? `: ${(String(r.stdout ?? '').trim() || String(r.stderr ?? '').trim()).split('\n').pop().slice(0, 200)}` : ''}` }
  }
  const j = update(root, id, (x) => { if (x.state === 'parked') Object.assign(x, { state: 'pending', at: new Date(now).toISOString(), until: new Date(now + DEFAULT_WINDOW).toISOString(), runBy: by ?? caller?.role ?? null }) })
  return j?.state === 'pending' ? { job: j } : { why: `job ${id} changed while it was being run (${j?.state ?? 'gone'})` }
}

/**
 * One watchdog pass over the due jobs. Never throws; every outcome is an act.
 * deps: sessions (liveSessions now), term (the Orca adapter: all/screen/send/create), open (openRole, injectable), home
 */
export function runDue(root, { cfg = readOfficeConfig(root), now = Date.now(), sessions = [], term = null, open = openRole, home = homedir(), act = () => {} } = {}) {
  const jobs = readJobs(root)
  let changed = false
  const tell = (job, text) => { try { writeAlert(root, cfg, { type: 'SCHEDULE', subject: job.role, text, quietKey: `schedule:${job.id}:${job.state}`, quietMs: 6 * HOUR, now }) } catch {} }
  for (const job of jobs) {
    if (job.state !== 'pending' || now < Date.parse(job.at)) continue
    const no = (why) => { act({ act: 'schedule', desk: job.role, job: job.id, ok: false, why }); job.lastTry = new Date(now).toISOString(); job.lastWhy = why; changed = true }
    if (now > Date.parse(job.until)) {
      Object.assign(job, { state: 'missed', missed: new Date(now).toISOString() }); changed = true
      act({ act: 'schedule', desk: job.role, job: job.id, ok: false, why: `missed: its window closed at ${job.until}${job.lastWhy ? ` (last: ${job.lastWhy})` : ''}` })
      tell(job, `scheduled job ${job.id} for role ${job.role} was MISSED: its window ${job.at} to ${job.until} closed${job.lastWhy ? `; last try: ${job.lastWhy}` : ''}. Brief: ${job.brief}`)
      continue
    }
    const p = rolesHere(root, cfg).list.find((x) => x.name === job.role)
    if (!p) { no(`no role ${job.role} on this machine any more`); continue }
    // the plugin gate holds at hand-over too: this watchdog may be older than the run
    { const g = pluginGate(job); if (g) { no(g); continue } }
    const line = jobLine(job)
    const r = running(p, sessions)
    if (r?.elsewhere) { no(`a session named ${p.session} runs at ${r.elsewhere.cwd}, not ${p.cwd}: one name, one session`); continue }
    if (r?.session) {
      // handed to the role that is up, by the limit resume's rules: idle, no
      // question open, its own tab, an empty prompt on screen
      const s = r.session
      if (!['idle', 'shell'].includes(s.status) || transcriptTail(home, s).pending) { no(`${p.session} is ${s.status ?? 'in an unknown state'} or asking: tried again next pass`); continue }
      if (!term?.send) { no('no terminal adapter that can type'); continue }
      let tabs = []
      try { tabs = term.all ? term.all() : [] } catch {}
      const f = tabFor(tabs, s)
      if (!f.handle) { no(f.why); continue }
      const scr = term.screen ? term.screen(f.handle) : ''
      if (!String(scr ?? '').trim() || menuOf(scr) || !atPrompt(scr)) { no(`${p.session}'s input prompt is not on screen (an empty "❯"): tried again next pass`); continue }
      try { term.send(f.handle, line) } catch (e) { no(e.message ?? String(e)); continue }
      Object.assign(job, { state: 'handed', handed: new Date(now).toISOString(), to: `${p.session} (pid ${s.pid}, typed into its tab)` }); changed = true
      act({ act: 'schedule', desk: job.role, job: job.id, ok: true, why: `handed to the running ${p.session} (pid ${s.pid})` })
      continue
    }
    // nobody holds the role: the office opens it, with the job as its first message
    const o = open(root, job.role, { cfg, sessions, term, home, caller: { kind: 'watchdog' }, prompt: line })
    if (o?.state !== 'opened') { no(`could not open ${job.role}: ${o?.why ?? 'no answer'}`); continue }
    Object.assign(job, { state: 'handed', handed: new Date(now).toISOString(), to: `a new ${p.session} session (${o.why})` }); changed = true
    act({ act: 'schedule', desk: job.role, job: job.id, ok: true, why: `opened ${p.session} with the job: ${o.why}` })
    tell(job, `scheduled job ${job.id}: no ${p.session} session was running, so the office opened one and handed it ${job.brief}`)
  }
  if (changed) writeJobs(root, jobs)
  return jobs
}

const fmtJob = (j) => `${j.id.padEnd(28)} ${j.state.padEnd(9)} ${j.at ? `${j.at} .. ${j.until}` : 'parked: runs when somebody runs it'}  role ${j.role}${j.needs ? `  needs ${[j.needs.plugin ? `plugin ${j.needs.plugin}` : '', j.needs.command ? `\`${j.needs.command}\`` : ''].filter(Boolean).join(', ')}` : ''}${j.to ? `  -> ${j.to}` : ''}${j.lastWhy && j.state === 'pending' ? `  (last: ${j.lastWhy})` : ''}`
// the command anybody types, no plugin path needed (commands/office-job.md)
export const runHint = (id) => `/office-job run ${id}`

if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2)
  const root = argv[0] && !['add', 'list', 'cancel', 'done', 'run'].includes(argv[0]) ? resolve(argv.shift()) : findOffice(process.cwd())
  const verb = argv.shift()
  const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null }
  const fail = (why, code = 2) => { console.error(`schedule: ${why}`); process.exit(code) }
  if (!root) fail('no office here (office.json)')
  const cfg = readOfficeConfig(root)
  if (verb === 'add') {
    const file = opt('--file')
    let text = ''
    try { text = readFileSync(file, 'utf8') } catch { fail(`--file ${JSON.stringify(file)}: cannot read it`) }
    const me = whoIs(root, cfg, { cwd: process.cwd() })
    const needs = opt('--needs-plugin') || opt('--needs-command') ? { ...(opt('--needs-plugin') ? { plugin: opt('--needs-plugin') } : {}), ...(opt('--needs-command') ? { command: opt('--needs-command') } : {}) } : null
    const r = addJob(root, { id: opt('--id'), at: opt('--at'), until: opt('--until'), role: opt('--role'), text, by: me?.role ?? null, parked: argv.includes('--parked'), needs }, { cfg, caller: me })
    if (!r.job) fail(r.why, 9)
    console.log(fmtJob(r.job))
    // a job nobody will run is worse than none: the board looks scheduled
    if (!existsSync(pathsFor(root).plist)) console.log(`⚠️ no watchdog is installed for ${root}: nothing runs this job until one is (node lib/health.mjs --install-watchdog)`)
  } else if (verb === 'list') {
    const jobs = readJobs(root)
    if (argv.includes('--json')) console.log(JSON.stringify(jobs, null, 1))
    else for (const j of jobs) console.log(fmtJob(j))
  } else if (verb === 'run') {
    const me = whoIs(root, cfg, { cwd: process.cwd() })
    const r = runJob(root, argv[0], { cfg, caller: me, by: me?.role ?? null, say: (t) => console.log(t) })
    if (!r.job) fail(r.why, 9)
    console.log(fmtJob(r.job))
    console.log(existsSync(pathsFor(root).plist) ? `due now: the watchdog hands it to ${r.job.role} on its next pass (within about 2 minutes)` : `⚠️ due now, but no watchdog is installed for ${root}: nothing hands it until one is (node lib/health.mjs --install-watchdog)`)
  } else if (verb === 'cancel') {
    const r = cancelJob(root, argv[0], opt('--why'), { caller: whoIs(root, cfg, { cwd: process.cwd() }) })
    if (!r.job) fail(r.why, 9)
    console.log(fmtJob(r.job))
  } else if (verb === 'done') {
    const r = doneJob(root, argv[0], opt('--note'), { caller: whoIs(root, cfg, { cwd: process.cwd() }) })
    if (!r.job) fail(r.why, 9)
    console.log(fmtJob(r.job))
  } else fail('usage: schedule.mjs [root] add --id <id> (--at <ISO> [--until <ISO>] | --parked) --role <role> --file <brief> [--needs-plugin ">=x.y.z"] [--needs-command "…"] | run <id> | list [--json] | cancel <id> --why "…" | done <id> [--note "…"]')
}
