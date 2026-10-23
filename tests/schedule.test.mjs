// DURABLE OFFICE SCHEDULES (0.19.0). The owner, 2026-10-23: "if a scheduled
// run's session isn't there, it must init itself." The desk move at 05:07Z was
// a session-only cron in one builder's memory. A job is now the office's: on
// disk, run by the watchdog, handed to its role whether or not it is up.
// Nothing real is launched or typed: the terminal and the opener are stubs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { addJob, cancelJob, doneJob, readJobs, runDue, jobLine, DEFAULT_WINDOW } from '../lib/schedule.mjs'
import { openRole } from '../lib/role.mjs'
import { heal } from '../lib/heal.mjs'
import { scheduleNote, officeHealth } from '../lib/health.mjs'

const STUBS = mkdtempSync(join(tmpdir(), 'oa-sched-stubs-'))
const CALLS = join(STUBS, 'calls.log')
for (const b of ['osascript', 'tmux', 'orca', 'claude', 'open']) writeFileSync(join(STUBS, b), `#!/bin/sh\necho "${b} $*" >> '${CALLS}'\nexit 1\n`, { mode: 0o755 })
process.env.PATH = `${STUBS}:${dirname(process.execPath)}:/usr/bin:/bin`

const AT = Date.parse('2026-10-23T05:07:00Z')
const BRIEF = '# Move the desks\nStop the services, close the sessions, move, restart, check, report.\n'
function office() {
  const root = mkdtempSync(join(tmpdir(), 'oa-sched-'))
  const home = mkdtempSync(join(tmpdir(), 'oa-sched-home-'))
  mkdirSync(join(root, 'desks', 'x'), { recursive: true })
  writeFileSync(join(root, 'desks', 'x', 'desk.json'), JSON.stringify({ name: 'x', kind: 'knowledge', port: 9911 }))
  mkdirSync(join(root, 'departments', 'aics'), { recursive: true })
  const cfg = {
    roleEnv: 'OFFICE_ROLE',
    departments: { 'customer-service': { dir: 'departments/aics', lead: 'AICS', desks: [] }, 'local-ops': { lead: 'ERP', desks: [] } },
    construction: [{ name: 'construction', root: '.', model: 'opus' }],
    profiles: { construction: { cwd: '.' }, aics: { department: 'customer-service' }, erp: { department: 'local-ops' } },
  }
  writeFileSync(join(root, 'office.json'), JSON.stringify(cfg))
  mkdirSync(join(root, '.office'), { recursive: true })
  writeFileSync(join(root, '.office', 'local.json'), JSON.stringify({ departments: ['customer-service'] }))
  return { root, home, cfg }
}
const add = (o, x = {}) => addJob(o.root, { id: 'aics-desk-move', at: new Date(AT).toISOString(), role: 'construction', text: BRIEF, by: 'office-anything-construction', ...x }, { cfg: o.cfg, now: AT - 5 * 3600_000 })
const session = (o, x = {}) => ({ pid: 5151, name: 'construction', cwd: o.root, sessionId: '00000000-0000-4000-8000-000000005151', status: 'idle', ...x })
const PROMPT = ['⏺ Ready.', '', '────────', '❯ ', '────────'].join('\n')
const termOf = (o, { screen = PROMPT } = {}) => { const typed = []; return { typed, all: () => [{ handle: 't-con', title: '✳ construction', agent: true, path: o.root }], screen: () => screen, send: (h, text) => typed.push({ h, text }) } }

test('⛔ a job is the office\'s: on disk with its brief, for a role this machine opens; a desk cannot add one', () => {
  const o = office()
  const r = add(o)
  assert.ok(r.job, r.why)
  assert.equal(readFileSync(join(o.root, '.office', 'schedule', 'aics-desk-move.md'), 'utf8'), BRIEF)
  assert.deepEqual(readJobs(o.root).map((j) => [j.id, j.state, j.role, j.at, Date.parse(j.until) - Date.parse(j.at)]), [['aics-desk-move', 'pending', 'construction', '2026-10-23T05:07:00.000Z', DEFAULT_WINDOW]])
  assert.match(readFileSync(join(o.root, '.office', '.gitignore'), 'utf8'), /^\*$/m, 'never committed')
  const why = (x, opt) => addJob(o.root, { id: 'job-two', at: new Date(AT).toISOString(), role: 'construction', text: BRIEF, ...x }, { cfg: o.cfg, now: AT - 3600_000, ...opt }).why
  assert.match(add(o).why, /exists already/)
  assert.match(why({}, { caller: { kind: 'desk', desk: 'x' } }), /a desk does not schedule a role/)
  assert.match(why({ id: 'X Y' }), /job id/)
  assert.match(why({ at: 'tonight' }), /not a time/)
  assert.match(why({ until: new Date(AT - 1).toISOString() }), /after --at/)
  assert.match(why({ role: 'erp' }), /department this machine does not run/)
  assert.match(why({ role: 'nobody' }), /no role called nobody/)
  assert.match(why({ text: '  ' }), /empty/)
  assert.match(addJob(o.root, { id: 'job-old', at: new Date(AT).toISOString(), role: 'construction', text: BRIEF }, { cfg: o.cfg, now: AT + DEFAULT_WINDOW + 1 }).why, /window already closed/)
})

test('⛔ the session is not there: at its time the office opens the role with the job as its first message', () => {
  const o = office()
  add(o)
  const opened = []
  const open = (root, role, opt) => { opened.push({ role, prompt: opt.prompt, caller: opt.caller }); return { state: 'opened', why: 'Orca tab t-new' } }
  runDue(o.root, { cfg: o.cfg, now: AT - 60_000, sessions: [], open, home: o.home })
  assert.equal(opened.length, 0, 'not before its time')
  const acts = []
  runDue(o.root, { cfg: o.cfg, now: AT + 60_000, sessions: [], open, home: o.home, act: (a) => acts.push(a) })
  assert.deepEqual(opened, [{ role: 'construction', prompt: jobLine(readJobs(o.root)[0]), caller: { kind: 'watchdog' } }])
  assert.match(opened[0].prompt, /^Scheduled office job aics-desk-move is due \(2026-10-23T05:07:00\.000Z\)\. Read \.office\/schedule\/aics-desk-move\.md and do it now\. When it is finished, run: node .*\/lib\/schedule\.mjs \. done aics-desk-move$/)
  assert.equal(readJobs(o.root)[0].state, 'handed')
  assert.ok(acts.some((a) => a.ok && a.job === 'aics-desk-move'))
  // one job, one run
  runDue(o.root, { cfg: o.cfg, now: AT + 5 * 60_000, sessions: [], open, home: o.home })
  assert.equal(opened.length, 1, 'a handed job is never handed again')
  assert.equal(doneJob(o.root, 'aics-desk-move', 'moved, checked, reported').job.state, 'done')
  assert.match(cancelJob(o.root, 'aics-desk-move', 'too late to call it off now, it ran').why, /is done: nothing to cancel/)
})

test('⛔ the session is there: the job is typed into its own tab, only idle at an empty prompt; busy or asking waits a pass', () => {
  const o = office()
  add(o)
  const never = () => { throw new Error('must not open a second session') }
  const busy = termOf(o)
  runDue(o.root, { cfg: o.cfg, now: AT + 60_000, sessions: [session(o, { status: 'busy' })], term: busy, open: never, home: o.home })
  assert.equal(busy.typed.length, 0)
  assert.match(readJobs(o.root)[0].lastWhy, /busy or asking: tried again next pass/)
  const menu = termOf(o, { screen: 'Do you want to proceed?\n❯ 1. Yes\n  2. No' })
  runDue(o.root, { cfg: o.cfg, now: AT + 2 * 60_000, sessions: [session(o)], term: menu, open: never, home: o.home })
  assert.equal(menu.typed.length, 0, 'never typed into a question')
  assert.equal(readJobs(o.root)[0].state, 'pending')
  const t = termOf(o)
  runDue(o.root, { cfg: o.cfg, now: AT + 3 * 60_000, sessions: [session(o)], term: t, open: never, home: o.home })
  assert.deepEqual(t.typed, [{ h: 't-con', text: jobLine(readJobs(o.root)[0]) }])
  assert.match(readJobs(o.root)[0].to, /construction \(pid 5151, typed into its tab\)/)
  // one name, one session: the role running in another folder is not this one
  const o2 = office(); add(o2)
  runDue(o2.root, { cfg: o2.cfg, now: AT + 60_000, sessions: [session(o2, { cwd: '/elsewhere' })], term: termOf(o2), open: never, home: o2.home })
  assert.match(readJobs(o2.root)[0].lastWhy, /runs at \/elsewhere/)
})

test('⛔ a job its window passes by is MISSED, loudly: an alert for the lead and a health line', () => {
  const o = office()
  add(o)
  const refuse = () => ({ state: 'refused', why: 'Orca is running but has no workspace holding it' })
  runDue(o.root, { cfg: o.cfg, now: AT + 60_000, sessions: [], open: refuse, home: o.home })
  assert.equal(readJobs(o.root)[0].state, 'pending', 'a refused open is tried again')
  assert.match(scheduleNote(o.root, AT + 60_000), /next scheduled: aics-desk-move \(construction\) at .*waiting: could not open construction: Orca is running but has no workspace/)
  runDue(o.root, { cfg: o.cfg, now: AT + DEFAULT_WINDOW + 60_000, sessions: [], open: refuse, home: o.home })
  assert.equal(readJobs(o.root)[0].state, 'missed')
  const alerts = readFileSync(join(o.root, '.office', 'alerts.log'), 'utf8')
  assert.match(alerts, / SCHEDULE - construction scheduled job aics-desk-move for role construction was MISSED: .*last try: could not open construction/)
  assert.match(scheduleNote(o.root, AT + DEFAULT_WINDOW + 120_000), /⚠ scheduled job MISSED: aics-desk-move \(construction/)
  const h = officeHealth(o.root, { home: o.home, procs: new Map(), now: AT + DEFAULT_WINDOW + 120_000, checks: false, cwd: () => null })
  assert.match(JSON.stringify(h), /scheduled job MISSED: aics-desk-move/, 'health says it')
})

test('cancel needs a reason; a cancelled job never runs', () => {
  const o = office()
  add(o)
  assert.match(cancelJob(o.root, 'aics-desk-move', 'later').why, /20\+ characters/)
  const desk = { kind: 'desk', desk: 'x' }
  assert.match(cancelJob(o.root, 'aics-desk-move', 'a desk would rather this did not run', { caller: desk }).why, /a desk does not cancel/)
  assert.match(doneJob(o.root, 'aics-desk-move', null, { caller: desk }).why, /a desk does not close/)
  assert.equal(readJobs(o.root)[0].state, 'pending')
  assert.equal(cancelJob(o.root, 'aics-desk-move', 'the lead postponed the move one day').job.state, 'cancelled')
  const opened = []
  runDue(o.root, { cfg: o.cfg, now: AT + 60_000, sessions: [], open: () => { opened.push(1); return { state: 'opened' } }, home: o.home })
  assert.equal(opened.length, 0)
  assert.match(doneJob(o.root, 'aics-desk-move').why, /cancelled/)
})

test('⛔ the role opened for a job gets it as its first message, after "--"; the watchdog\'s heal runs due jobs and never opens a real window under a test', () => {
  const o = office()
  const created = []
  const term = { all: () => [], create: (x) => { created.push(x); return 't-new' } }
  const r = openRole(o.root, 'construction', { cfg: o.cfg, sessions: [], term, run: () => ({ status: 1 }), caller: { kind: 'watchdog' }, home: o.home, prompt: 'Scheduled office job a-b-c is due.' })
  assert.equal(r.state, 'opened', r.why)
  assert.match(created[0].command, / claude --name 'construction' .* -- 'Scheduled office job a-b-c is due\.'$/)
  // heal: no injected opener, so the real one refuses under node --test, and says so on the job
  add(o)
  heal(o.root, { leads: [], desks: [], checks: [] }, { now: AT + 60_000, home: o.home, freshProcs: () => new Map(), cwd: () => null, terminal: { all: () => [], screen: () => '', send: () => { throw new Error('no typing') } } })
  const j = readJobs(o.root)[0]
  assert.equal(j.state, 'pending')
  assert.match(j.lastWhy, /under node --test no real window or session is opened/)
  assert.equal(existsSync(CALLS) ? readFileSync(CALLS, 'utf8') : '', '', 'nothing real was called')
})
