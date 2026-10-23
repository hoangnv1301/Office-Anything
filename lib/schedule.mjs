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
//   node lib/schedule.mjs [root] list [--json]
//   node lib/schedule.mjs [root] cancel <id> --why "<reason, 20+ characters>"
//   node lib/schedule.mjs [root] done <id> [--note "..."]
//
// ⛔ ONE JOB, ONE RUN. A job is handed once; a session-only cron for the same
// work must be removed when the job is added, or two sessions do it.
// ⛔ NOT FROM A DESK. A desk that could schedule a role would open a session
// outside its own wall, the same reason a desk does not open a role.
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs'
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
export function addJob(root, { id, at, until = null, role, text, by = null }, { cfg = readOfficeConfig(root), now = Date.now(), caller = null } = {}) {
  if (caller?.kind === 'desk') return { why: `a desk does not schedule a role (it is desk ${caller.desk}): that is the lead's or a developer's` }
  if (!ID.test(String(id ?? ''))) return { why: `job id ${JSON.stringify(id)}: lower-case letters, digits and -, 3 to 41 characters` }
  const a = Date.parse(at ?? ''), u = until == null ? a + DEFAULT_WINDOW : Date.parse(until)
  if (!Number.isFinite(a)) return { why: `--at ${JSON.stringify(at)} is not a time (ISO, e.g. 2026-10-23T05:07:00Z)` }
  if (!Number.isFinite(u) || u <= a) return { why: '--until must be a time after --at' }
  if (u <= now) return { why: `its window already closed (${new Date(u).toISOString()})` }
  const R = rolesHere(root, cfg)
  if (!R.list.some((p) => p.name === role)) return { why: R.hidden.includes(role) ? `${role} belongs to a department this machine does not run: it would never run here` : `no role called ${role}; this machine may open: ${R.list.map((p) => p.name).join(', ') || 'none'}` }
  const t = String(text ?? '')
  if (!t.trim()) return { why: 'the brief is empty: say what the job is' }
  if (t.length > MAX_BRIEF) return { why: `the brief is ${t.length} characters, at most ${MAX_BRIEF}` }
  const jobs = readJobs(root)
  if (jobs.some((j) => j.id === id)) return { why: `a job ${id} exists already (${jobs.find((j) => j.id === id).state}): one id, one job` }
  mkdirSync(join(root, '.office', 'schedule'), { recursive: true })
  writeFileSync(join(root, briefRel(id)), t.endsWith('\n') ? t : t + '\n')
  const job = { id, at: new Date(a).toISOString(), until: new Date(u).toISOString(), role, brief: briefRel(id), by, created: new Date(now).toISOString(), state: 'pending' }
  writeJobs(root, [...jobs, job])
  return { job }
}

export function cancelJob(root, id, why) {
  if (String(why ?? '').trim().length < 20) return { why: 'a cancel needs a reason of 20+ characters, recorded on the job' }
  const j = update(root, id, (x) => { if (['pending', 'handed'].includes(x.state)) Object.assign(x, { state: 'cancelled', cancelled: new Date().toISOString(), why: String(why).trim() }) })
  if (!j) return { why: `no job ${id}` }
  return j.state === 'cancelled' ? { job: j } : { why: `job ${id} is ${j.state}: nothing to cancel` }
}
export function doneJob(root, id, note = null) {
  const j = update(root, id, (x) => { if (x.state !== 'cancelled') Object.assign(x, { state: 'done', done: new Date().toISOString(), ...(note ? { note: String(note).slice(0, 500) } : {}) }) })
  return j ? (j.state === 'done' ? { job: j } : { why: `job ${id} was cancelled` }) : { why: `no job ${id}` }
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

const fmtJob = (j) => `${j.id.padEnd(28)} ${j.state.padEnd(9)} ${j.at} .. ${j.until}  role ${j.role}${j.to ? `  -> ${j.to}` : ''}${j.lastWhy && j.state === 'pending' ? `  (last: ${j.lastWhy})` : ''}`

if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2)
  const root = argv[0] && !['add', 'list', 'cancel', 'done'].includes(argv[0]) ? resolve(argv.shift()) : findOffice(process.cwd())
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
    const r = addJob(root, { id: opt('--id'), at: opt('--at'), until: opt('--until'), role: opt('--role'), text, by: me?.role ?? null }, { cfg, caller: me })
    if (!r.job) fail(r.why, 9)
    console.log(fmtJob(r.job))
    // a job nobody will run is worse than none: the board looks scheduled
    if (!existsSync(pathsFor(root).plist)) console.log(`⚠️ no watchdog is installed for ${root}: nothing runs this job until one is (node lib/health.mjs --install-watchdog)`)
  } else if (verb === 'list') {
    const jobs = readJobs(root)
    if (argv.includes('--json')) console.log(JSON.stringify(jobs, null, 1))
    else for (const j of jobs) console.log(fmtJob(j))
  } else if (verb === 'cancel') {
    const r = cancelJob(root, argv[0], opt('--why'))
    if (!r.job) fail(r.why, 9)
    console.log(fmtJob(r.job))
  } else if (verb === 'done') {
    const r = doneJob(root, argv[0], opt('--note'))
    if (!r.job) fail(r.why, 9)
    console.log(fmtJob(r.job))
  } else fail('usage: schedule.mjs [root] add --id <id> --at <ISO> [--until <ISO>] --role <role> --file <brief> | list [--json] | cancel <id> --why "…" | done <id> [--note "…"]')
}
