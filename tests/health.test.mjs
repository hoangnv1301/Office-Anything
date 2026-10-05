// DESK HEALTH. "Alive and idle" is not "listening": on 2026-10-05 every desk
// came back resumed after a Mac restart, the registry said idle, and not one
// doorbell Monitor was running. A desk is only healthy when its `wake`
// command runs UNDER its own session. lib/health.mjs owns that question.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { wakePattern, doorbell, officeHealth, processTable, projectChecks } from '../lib/health.mjs'

// an office with one desk that has a doorbell and one that has none
function office({ wake = 'node ../../scripts/bell/wake.mjs', extra = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oa-health-'))
  const home = mkdtempSync(join(tmpdir(), 'oa-home-'))
  mkdirSync(join(home, '.claude', 'sessions'), { recursive: true })
  mkdirSync(join(root, 'desks', 'bell'), { recursive: true })
  mkdirSync(join(root, 'desks', 'quiet'), { recursive: true })
  mkdirSync(join(root, 'scripts', 'bell'), { recursive: true })
  writeFileSync(join(root, 'scripts', 'bell', 'wake.mjs'), 'setInterval(() => {}, 1e6)\n')
  writeFileSync(join(root, 'desks', 'bell', 'desk.json'), JSON.stringify({ name: 'bell', kind: 'knowledge', port: 9301, wake, ...extra }))
  writeFileSync(join(root, 'desks', 'quiet', 'desk.json'), JSON.stringify({ name: 'quiet', kind: 'knowledge', port: 9302 }))
  const register = (name, pid, startedAt = Date.now() - 3600_000) =>
    writeFileSync(join(home, '.claude', 'sessions', pid + '.json'), JSON.stringify({ pid, name: 'desk-' + name, cwd: join(root, 'desks', name), sessionId: 's-' + name, status: 'idle', startedAt }))
  return { root, home, register }
}

test('the doorbell is identified by the script in `wake`, not the whole command line', () => {
  assert.ok(wakePattern({ wake: 'node ../../scripts/discord/team-wake.mjs' }).test('/usr/bin/node /x/scripts/discord/team-wake.mjs'))
  assert.ok(wakePattern({ wake: 'node x.mjs', wakeMatch: 'buyer-wake\\.mjs' }).test('node /a/buyer-wake.mjs --thread 7'))
  assert.equal(wakePattern({}), null, 'no wake = no doorbell to look for')
})

test('ARMED only when the wake process runs under the desk\'s own session', async () => {
  const o = office()
  o.register('bell', process.pid)   // this test process plays the session
  const child = spawn(process.execPath, [join(o.root, 'scripts', 'bell', 'wake.mjs')], { stdio: 'ignore' })
  try {
    await new Promise((r) => setTimeout(r, 300))
    const h = officeHealth(o.root, { home: o.home, procs: processTable() })
    const bell = h.desks.find((d) => d.name === 'bell')
    assert.equal(bell.doorbell.state, 'armed', JSON.stringify(bell.doorbell))
    assert.equal(bell.doorbell.pid, child.pid)
    assert.equal(h.desks.find((d) => d.name === 'quiet').doorbell.state, 'none')
  } finally { child.kill() }
})

test('a resumed session with no doorbell is RED once the grace period is over', () => {
  const o = office()
  o.register('bell', process.pid)
  o.register('quiet', process.ppid)
  const h = officeHealth(o.root, { home: o.home, procs: new Map() })
  assert.equal(h.desks.find((d) => d.name === 'bell').doorbell.state, 'unarmed')
  assert.equal(h.code, 4, 'one unarmed doorbell makes the office red')
  assert.match(h.line, /bell.*doorbell/i, 'the human line names the desk and the reason')
})

test('inside the grace period an unarmed doorbell is still "arming", not red', () => {
  const o = office()
  o.register('bell', process.pid, Date.now() - 10_000)
  o.register('quiet', process.ppid)
  const h = officeHealth(o.root, { home: o.home, procs: new Map() })
  assert.equal(h.desks.find((d) => d.name === 'bell').doorbell.state, 'arming')
  assert.equal(h.code, 0)
})

test('a wake process whose session is gone is an ORPHAN, reported with its age', () => {
  const o = office()
  const procs = new Map([
    [5001, { pid: 5001, ppid: 1, ageSec: 30 * 3600, cmd: 'node /r/scripts/bell/wake.mjs --thread 9' }],
  ])
  const h = officeHealth(o.root, { home: o.home, procs })
  assert.equal(h.orphans.length, 1)
  assert.equal(h.orphans[0].pid, 5001)
  assert.equal(h.orphans[0].desk, 'bell')
  assert.equal(h.orphans[0].ageSec, 30 * 3600)
})

test('a desk that is not running is RED; one marked autostart:false is only "off"', () => {
  const o = office({ extra: { autostart: false } })
  o.register('quiet', process.pid)
  const h = officeHealth(o.root, { home: o.home, procs: new Map() })
  assert.equal(h.desks.find((d) => d.name === 'bell').session.state, 'off')
  assert.equal(h.code, 0)
  const o2 = office()
  o2.register('bell', process.pid)
  const h2 = officeHealth(o2.root, { home: o2.home, procs: new Map([[1, { pid: 1, ppid: 0, ageSec: 0, cmd: 'x' }]]) })
  assert.equal(h2.desks.find((d) => d.name === 'quiet').session.state, 'dead')
  assert.equal(h2.code, 4)
})

test('an office with no desks is UNKNOWN (7), never green', () => {
  const root = mkdtempSync(join(tmpdir(), 'oa-empty-'))
  assert.equal(officeHealth(root, { home: root, procs: new Map() }).code, 7)
})

test('project checks: exit code or /regex/ on stdout decides, and a failure is red', () => {
  const root = mkdtempSync(join(tmpdir(), 'oa-pc-'))
  const r = projectChecks(root, [
    { name: 'ok-exit', cmd: 'true' },
    { name: 'bad-exit', cmd: 'false' },
    { name: 'ok-regex', cmd: 'echo listening on 3000', expect: '/listening/' },
    { name: 'bad-regex', cmd: 'echo nothing', expect: '/listening/' },
  ])
  assert.deepEqual(r.map((c) => [c.name, c.ok]), [['ok-exit', true], ['bad-exit', false], ['ok-regex', true], ['bad-regex', false]])
})

test('health only reads: no heal flag, no act', () => {
  // the module must not export anything that acts without being asked to
  const o = office()
  const h = officeHealth(o.root, { home: o.home, procs: new Map() })
  assert.equal(h.healed, undefined)
})

test('doorbell() is the one place the armed rule lives', () => {
  const procs = new Map([
    [10, { pid: 10, ppid: 1, ageSec: 99, cmd: 'claude' }],
    [11, { pid: 11, ppid: 10, ageSec: 50, cmd: '/bin/zsh -c node ../../scripts/bell/wake.mjs' }],
    [12, { pid: 12, ppid: 11, ageSec: 50, cmd: 'node ../../scripts/bell/wake.mjs' }],
  ])
  const d = doorbell({ wake: 'node ../../scripts/bell/wake.mjs' }, { pid: 10, startedAt: 0 }, procs, Date.now())
  assert.equal(d.state, 'armed')
  assert.equal(d.pid, 12, 'the innermost match, not the shell wrapping it')
  assert.equal(d.ageSec, 50)
})

test('a doorbell running under ANOTHER session does not arm this desk', () => {
  // two sessions of one desk (a buyer launcher's), or a stale one: the bell
  // must be under THIS session's pid, or this session is deaf
  const procs = new Map([
    [20, { pid: 20, ppid: 1, ageSec: 99, cmd: 'claude' }],
    [21, { pid: 21, ppid: 20, ageSec: 50, cmd: 'node /r/scripts/bell/wake.mjs' }],
    [30, { pid: 30, ppid: 1, ageSec: 99, cmd: 'claude' }],
  ])
  assert.equal(doorbell({ wake: 'node ../../scripts/bell/wake.mjs' }, { pid: 30, startedAt: 0 }, procs, Date.now()).state, 'unarmed')
})

test('the desk-health CHECK answers on the board through collect(), and is silent where nothing is declared', async () => {
  const { report, applies } = await import('../checks/desk-health.mjs')
  const { CHECKS } = await import('../checks/run.mjs')
  assert.ok(CHECKS.some((c) => c.name === 'desk-health'), 'registered, or it never runs')
  // this repo has no desks with doorbells: a fourth state, not a pass
  const quiet = mkdtempSync(join(tmpdir(), 'oa-q-'))
  mkdirSync(join(quiet, 'desks', 'a'), { recursive: true })
  writeFileSync(join(quiet, 'desks', 'a', 'desk.json'), JSON.stringify({ name: 'a', kind: 'knowledge', port: 9400 }))
  assert.equal(applies(quiet), false)
  assert.equal(report(quiet).applicable, false)
  // a desk with a doorbell and no session: a finding (4) that names the desk
  const o = office()
  const r = report(o.root, { home: o.home, procs: new Map() })
  assert.equal(r.code, 4)
  assert.ok(r.findings.some((f) => f.desk === 'bell'))
})

test('one unreadable desk.json does not blind the check to the others (fault #4 again)', async () => {
  // seen live: desk-discord declared kind "liaison"; the check stepped aside
  // for the whole office and the five readable desks went unwatched
  const { report } = await import('../checks/desk-health.mjs')
  const o = office()
  mkdirSync(join(o.root, 'desks', 'odd'), { recursive: true })
  writeFileSync(join(o.root, 'desks', 'odd', 'desk.json'), JSON.stringify({ name: 'odd', kind: 'liaison', port: 9399, wake: 'node x.mjs' }))
  const r = report(o.root, { home: o.home, procs: new Map() })
  assert.equal(r.applicable, true)
  assert.ok(r.findings.some((f) => f.desk === 'bell'), 'the readable desk is still judged')
  assert.ok(!r.findings.some((f) => f.desk === 'odd'), 'the broken one is desk-readable\'s to name, once')
})
