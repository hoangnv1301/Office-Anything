// A role closed on purpose (office.json profiles, opened with /role) is reopened by heal only when an
// open ask or step task waits for it, and only for a profile that opted in with "wakeOnWork".
// Nothing real opens: every test injects `open` and the process table.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { heal } from '../lib/heal.mjs'
import { addTask, addAsk } from '../lib/tasks.mjs'

const MIN = 60_000
function office({ wake = true, extra = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oa-rolewake-'))
  const home = mkdtempSync(join(tmpdir(), 'oa-rolewake-home-'))
  writeFileSync(join(root, 'office.json'), JSON.stringify({ watchdog: { notify: 'lead' }, profiles: { full: { cwd: '.', ...(wake ? { wakeOnWork: true } : {}) } }, ...extra }))
  return { root, home }
}
const H = { code: 0, desks: [], checks: [], orphans: [] }
const mk = (o, sessions = []) => {
  const opened = []
  const open = (root, role) => { opened.push(role); return { state: 'opened', why: 'opened in a tab' } }
  const run = (now) => heal(o.root, H, { now, home: o.home, kill: () => { throw new Error('no kill') }, freshProcs: () => new Map(), cwd: () => null, open, terminal: { titles: () => [] } })
  return { opened, run }
}
const log = (o) => readFileSync(join(o.root, '.office', 'heal.log'), 'utf8')
const live = (o, name) => { // a live registry entry, as the CLI writes it
  mkdirSync(join(o.home, '.claude', 'sessions'), { recursive: true })
  writeFileSync(join(o.home, '.claude', 'sessions', '4242.json'), JSON.stringify({ pid: 4242, name, cwd: o.root, startedAt: Date.now() - 1000 }))
}
const T0 = Date.now()

test('no waiting work: a closed role is not reopened, however long it has been down', () => {
  const o = office(); const m = mk(o)
  m.run(T0); m.run(T0 + 60 * MIN)
  assert.deepEqual(m.opened, [])
})

test('an open ask reopens it, but not at once: after the grace, said in the action log', () => {
  const o = office(); const m = mk(o)
  addAsk(o.root, { to: 'full', question: 'is the plugin released?' }, { by: { kind: 'owner' }, now: T0 })
  const first = m.run(T0 + MIN)
  assert.deepEqual(m.opened, [], 'just closed: left alone')
  assert.match(first.acts.find((a) => a.act === 'role-wake').why, /waiting 10m/)
  const r = m.run(T0 + 12 * MIN)
  assert.deepEqual(m.opened, ['full'])
  const a = r.acts.find((x) => x.act === 'role-wake')
  assert.ok(a.ok); assert.match(a.why, /open ask\/task for full: T-/)
  assert.match(log(o), /role-wake/)
})

test('an open step task assigned to the session counts too', () => {
  const o = office(); const m = mk(o)
  addTask(o.root, { said: 'do it', title: 'check the build', assigned: 'full' }, { now: T0 })
  m.run(T0); m.run(T0 + 11 * MIN)
  assert.deepEqual(m.opened, ['full'])
})

test('work for somebody else, or a finished task, wakes nothing', () => {
  const o = office(); const m = mk(o)
  addTask(o.root, { said: 'x', title: 'other', assigned: 'lead' }, { now: T0 })
  m.run(T0); m.run(T0 + 30 * MIN)
  assert.deepEqual(m.opened, [])
})

test('a profile that did not opt in is never reopened', () => {
  const o = office({ wake: false }); const m = mk(o)
  addAsk(o.root, { to: 'full', question: 'hello?' }, { by: { kind: 'owner' }, now: T0 })
  m.run(T0); m.run(T0 + 60 * MIN)
  assert.deepEqual(m.opened, [])
})

test('never a second session: one live under the name is left alone, and the grace restarts when it closes', () => {
  const o = office(); const m = mk(o)
  live(o, 'full')
  addAsk(o.root, { to: 'full', question: 'hello?' }, { by: { kind: 'owner' }, now: T0 })
  const procs = new Map([[4242, { pid: 4242, ppid: 1, ageSec: 5, cmd: 'claude' }]])
  const run = (now, p) => heal(o.root, H, { now, home: o.home, kill: () => {}, freshProcs: () => p, cwd: () => null, open: (r, role) => { m.opened.push(role); return { state: 'opened', why: 'x' } }, terminal: { titles: () => [] } })
  run(T0, procs); run(T0 + 30 * MIN, procs)
  assert.deepEqual(m.opened, [], 'it is up')
  // closed now: first look down starts the grace; it is not reopened that same pass
  run(T0 + 31 * MIN, new Map())
  assert.deepEqual(m.opened, [])
})

test('the cap holds: the cap of wakes an hour, then said to the lead, not a fourth', () => {
  const o = office({ extra: { watchdog: { notify: 'lead', maxHealsPerHour: 2 } } })
  const opened = []
  const open = (r, role) => { opened.push(role); return { state: 'opened', why: 'x' } }
  const run = (now) => heal(o.root, H, { now, home: o.home, kill: () => {}, freshProcs: () => new Map(), cwd: () => null, open, terminal: { titles: () => [] } })
  addAsk(o.root, { to: 'full', question: 'hello?' }, { by: { kind: 'owner' }, now: T0 })
  run(T0)
  const t = [T0 + 11 * MIN, T0 + 17 * MIN, T0 + 23 * MIN, T0 + 29 * MIN]
  const last = t.map(run).at(-1)
  assert.equal(opened.length, 2)
  assert.match(last.acts.find((a) => a.act === 'role-wake').why, /cap: 2 wakes/)
  assert.match(readFileSync(join(o.root, '.office', 'alerts.log'), 'utf8'), /did not come up after 2 wakes/)
})

test('right after a wake it waits for the session to register (no second open)', () => {
  const o = office(); const m = mk(o)
  addAsk(o.root, { to: 'full', question: 'hello?' }, { by: { kind: 'owner' }, now: T0 })
  m.run(T0); m.run(T0 + 11 * MIN)
  const r = m.run(T0 + 12 * MIN)
  assert.equal(m.opened.length, 1)
  assert.match(r.acts.find((a) => a.act === 'role-wake').why, /waiting for it to register/)
})
