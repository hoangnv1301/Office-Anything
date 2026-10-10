// DESK HEALTH. "Alive and idle" is not "listening": on 2026-10-05 every desk
// came back resumed after a Mac restart, the registry said idle, and not one
// doorbell Monitor was running. A desk is only healthy when its `wake`
// command runs UNDER its own session. lib/health.mjs owns that question.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { wakePattern, doorbell, officeHealth, processTable, projectChecks, isDoorbell, isOrphan, orphanVerdict, liveSessions } from '../lib/health.mjs'

const WAKE = 'node ../../scripts/bell/wake.mjs'

// an office with one desk that has a doorbell and one that has none
function office({ wake = WAKE, extra = {} } = {}) {
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
const bellDesk = { name: 'bell', wake: WAKE }
const P = (pid, ppid, cmd, ageSec = 60) => [pid, { pid, ppid, ageSec, cmd }]

test('the doorbell is identified by the script in `wake`, not the whole command line', () => {
  assert.ok(wakePattern({ wake: 'node ../../scripts/discord/team-wake.mjs' }).test('/usr/bin/node /x/scripts/discord/team-wake.mjs'))
  assert.ok(wakePattern({ wake: 'node x.mjs', wakeMatch: 'buyer-wake\\.mjs' }).test('node /a/buyer-wake.mjs --thread 7'))
  assert.equal(wakePattern({}), null, 'no wake = no doorbell to look for')
})

test('⛔ a pager, editor or grep that NAMES the script is not a doorbell; the interpreter running it is', () => {
  for (const cmd of ['less scripts/bell/wake.mjs', 'vim /r/scripts/bell/wake.mjs', 'grep -n x scripts/bell/wake.mjs', 'cat ../../scripts/bell/wake.mjs'])
    assert.equal(isDoorbell({ pid: 1, cmd }, bellDesk), false, cmd)
  assert.equal(isDoorbell({ pid: 1, cmd: '/bin/zsh -c node ../../scripts/bell/wake.mjs' }, bellDesk), false, 'the wrapping shell is not the doorbell')
  assert.equal(isDoorbell({ pid: 1, cmd: '/opt/homebrew/bin/node /r/scripts/bell/wake.mjs --thread 9' }, bellDesk), true)
  assert.equal(isDoorbell({ pid: 1, cmd: 'node /r/scripts/bell/not-wake.mjs' }, bellDesk), false)
})

test('ARMED only when the wake process runs under the desk\'s own claude session', async () => {
  const o = office()
  // a stand-in session: a node binary called "claude", so ps sees a claude process
  const bin = mkdtempSync(join(tmpdir(), 'oa-bin-'))
  symlinkSync(process.execPath, join(bin, 'claude'))
  const wake = join(o.root, 'scripts', 'bell', 'wake.mjs')
  const session = spawn(join(bin, 'claude'), ['-e', `require('child_process').spawn(process.execPath, [${JSON.stringify(wake)}], { stdio: 'ignore' }); setInterval(() => {}, 1e6)`], { stdio: 'ignore' })
  try {
    o.register('bell', session.pid, Date.now())
    await new Promise((r) => setTimeout(r, 600))
    const procs = processTable()
    const h = officeHealth(o.root, { home: o.home, procs })
    const bell = h.desks.find((d) => d.name === 'bell')
    assert.equal(bell.session.state, 'alive')
    assert.equal(bell.doorbell.state, 'armed', JSON.stringify(bell.doorbell))
    assert.equal(procs.get(bell.doorbell.pid).ppid, session.pid)
    assert.equal(h.desks.find((d) => d.name === 'quiet').doorbell.state, 'none')
  } finally {
    for (const p of processTable().values()) if (p.ppid === session.pid) { try { process.kill(p.pid) } catch {} }
    session.kill()
  }
})

test('⛔ a stale session file whose pid was REUSED is not a live session', () => {
  const o = office()
  const now = Date.now()
  o.register('bell', 4242, now - 3600_000)
  // pid 4242 is now somebody's vim, started a minute ago
  assert.equal(liveSessions(o.home, new Map([P(4242, 1, 'vim notes.txt', 60)]), now).length, 0, 'not claude')
  assert.equal(liveSessions(o.home, new Map([P(4242, 1, 'claude --resume x', 60)]), now).length, 0, 'claude, but younger than the session')
  assert.equal(liveSessions(o.home, new Map([P(4242, 1, 'claude --resume x', 3700)]), now).length, 1)
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

test('ORPHAN: under launchd, through a `zsh -c -l` wrapper, script inside THIS office', () => {
  const o = office()
  const script = join(o.root, 'scripts', 'bell', 'wake.mjs')
  const procs = new Map([
    P(700, 1, `/bin/zsh -c -l node ${script}`, 30 * 3600),
    P(701, 700, `node ${script} --thread 9`, 30 * 3600),
  ])
  const h = officeHealth(o.root, { home: o.home, procs, cwd: () => null })
  assert.deepEqual(h.orphans.map((x) => [x.desk, x.pid]), [['bell', 701]], 'the node process, not the shell')
  assert.equal(h.orphans[0].ageSec, 30 * 3600)
})

test('⛔ NOT an orphan: a manual run in a terminal, another checkout, a launchd-owned bell, a pager', () => {
  const o = office()
  const script = join(o.root, 'scripts', 'bell', 'wake.mjs')
  const found = (procs, desk = bellDesk, cwd = () => null) => [...procs.values()].filter((p) => isOrphan(p, desk, procs, new Set(), o.root, cwd))
  // a terminal (login, then the terminal app) above it: somebody owns it
  assert.equal(found(new Map([P(10, 1, '/Applications/Orca.app/Contents/MacOS/Orca Helper'), P(11, 10, 'login -fp me'), P(12, 11, '-zsh'), P(13, 12, `node ${script}`)])).length, 0)
  // the same script in a different checkout
  assert.equal(found(new Map([P(20, 1, 'node /elsewhere/scripts/bell/wake.mjs')])).length, 0)
  // a relative path whose cwd cannot be read is not proven inside this office
  assert.equal(found(new Map([P(30, 1, 'node ../../scripts/bell/wake.mjs')])).length, 0)
  assert.equal(found(new Map([P(30, 1, 'node ../../scripts/bell/wake.mjs')]), bellDesk, () => join(o.root, 'desks', 'bell')).length, 1, 'resolved through its cwd, it is ours')
  // declared as owned by a LaunchAgent
  assert.equal(found(new Map([P(40, 1, `node ${script}`)]), { ...bellDesk, wakeOwner: 'launchd' }).length, 0)
  // somebody reading it
  assert.equal(found(new Map([P(50, 1, `less ${script}`)])).length, 0)
})

test('a desk that is not running is RED; autostart:false is "off" unless it asks to be watched', () => {
  const o = office({ extra: { autostart: false } })
  o.register('quiet', process.pid)
  const h = officeHealth(o.root, { home: o.home, procs: new Map() })
  assert.equal(h.desks.find((d) => d.name === 'bell').session.state, 'off')
  assert.equal(h.code, 0)
  assert.match(h.line, /off by design: bell/, 'off is said, never invisible')
  const w = office({ extra: { autostart: false, watch: true } })
  w.register('quiet', process.pid)
  const hw = officeHealth(w.root, { home: w.home, procs: new Map() })
  assert.equal(hw.desks.find((d) => d.name === 'bell').session.state, 'dead')
  assert.equal(hw.code, 4)
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

test('doorbell() is the one place the armed rule lives', () => {
  const procs = new Map([
    P(10, 1, 'claude', 99),
    P(11, 10, '/bin/zsh -c node ../../scripts/bell/wake.mjs', 50),
    P(12, 11, 'node ../../scripts/bell/wake.mjs', 50),
  ])
  const d = doorbell(bellDesk, { pid: 10, startedAt: 0 }, procs, Date.now())
  assert.equal(d.state, 'armed')
  assert.equal(d.pid, 12, 'the innermost match, not the shell wrapping it')
  assert.equal(d.ageSec, 50)
})

test('a doorbell running under ANOTHER session does not arm this desk', () => {
  const procs = new Map([P(20, 1, 'claude', 99), P(21, 20, 'node /r/scripts/bell/wake.mjs', 50), P(30, 1, 'claude', 99)])
  assert.equal(doorbell(bellDesk, { pid: 30, startedAt: 0 }, procs, Date.now()).state, 'unarmed')
})

test('the desk-health CHECK answers on the board through collect(), and is silent where nothing is declared', async () => {
  const { report, applies } = await import('../checks/desk-health.mjs')
  const { CHECKS } = await import('../checks/run.mjs')
  assert.ok(CHECKS.some((c) => c.name === 'desk-health'), 'registered, or it never runs')
  const quiet = mkdtempSync(join(tmpdir(), 'oa-q-'))
  mkdirSync(join(quiet, 'desks', 'a'), { recursive: true })
  writeFileSync(join(quiet, 'desks', 'a', 'desk.json'), JSON.stringify({ name: 'a', kind: 'knowledge', port: 9400 }))
  assert.equal(applies(quiet), false)
  assert.equal(report(quiet).applicable, false)
  const o = office()
  const r = report(o.root, { home: o.home, procs: new Map() })
  assert.equal(r.code, 4)
  assert.ok(r.findings.some((f) => f.desk === 'bell'))
})

test('one unreadable desk.json does not blind the check to the others (fault #4 again)', async () => {
  const { report } = await import('../checks/desk-health.mjs')
  const o = office()
  mkdirSync(join(o.root, 'desks', 'odd'), { recursive: true })
  writeFileSync(join(o.root, 'desks', 'odd', 'desk.json'), JSON.stringify({ name: 'odd', kind: 'oracle', port: 9399, wake: 'node x.mjs' }))
  const r = report(o.root, { home: o.home, procs: new Map() })
  assert.equal(r.applicable, true)
  assert.ok(r.findings.some((f) => f.desk === 'bell'), 'the readable desk is still judged')
  assert.ok(!r.findings.some((f) => f.desk === 'odd'), 'the broken one is desk-readable\'s to name, once')
})

test('⛔ an orphan whose cwd cannot be read is LISTED as unproven, never dropped and never killable', () => {
  // seen live: five buyer-wake processes under launchd with relative script
  // paths and no cwd lsof could read. Silence would hide them; a kill would
  // trust what could not be proven to be this office's
  const o = office()
  const procs = new Map([P(800, 1, '/bin/zsh -c source snap.sh && node ../../scripts/bell/wake.mjs --thread BT-1', 7200), P(801, 800, 'node ../../scripts/bell/wake.mjs --thread BT-1', 7200)])
  const h = officeHealth(o.root, { home: o.home, procs, cwd: () => null })
  assert.deepEqual(h.orphans.map((x) => [x.pid, x.proven]), [[801, false]])
  assert.match(h.orphans[0].why, /cwd/)
  assert.match(h.line, /1 orphan doorbell \(1 unproven\)/)
  assert.equal(isOrphan(procs.get(801), bellDesk, procs, new Set(), o.root, () => null), false, 'heal re-asks this, and it says no')
})

// ── after the second review: the orphan rule decides what --heal kills ──────
const spaced = () => {
  // an office whose path holds a space, like /Volumes/Extreme SSD/…
  const base = mkdtempSync(join(tmpdir(), 'oa sp-'))
  const root = join(base, 'my office')
  mkdirSync(join(root, 'desks', 'bell'), { recursive: true })
  mkdirSync(join(root, 'scripts', 'bell'), { recursive: true })
  writeFileSync(join(root, 'scripts', 'bell', 'wake.mjs'), '')
  return root
}
const verdictOf = (cmd, root, cwd = () => null, desk = bellDesk) => {
  const procs = new Map([P(900, 1, cmd, 100)])
  return orphanVerdict(procs.get(900), desk, procs, new Set(), root, cwd)
}

test('⛔ (a) the wake script must be THE script node runs, not any argument', () => {
  const root = spaced()
  const deskDir = () => join(root, 'desks', 'bell')
  assert.equal(verdictOf('node scripts/lint.mjs ../../scripts/bell/wake.mjs', root, deskDir), null, 'a linter given the file')
  assert.equal(verdictOf('node --require ../../scripts/bell/wake.mjs app.mjs', root, deskDir), null, 'preloaded into another program')
  assert.deepEqual(verdictOf('node ../../scripts/bell/wake.mjs --thread BT-1', root, deskDir), { proven: true })
})

test('⛔ (b) a doorbell in a worktree under the office is not the office\'s', () => {
  const root = spaced()
  const wt = join(root, '.claude', 'worktrees', 'x', 'scripts', 'bell', 'wake.mjs')
  assert.equal(verdictOf(`node ${wt}`, root), null)
  assert.equal(verdictOf('node ../../scripts/bell/wake.mjs', root, () => join(root, '.claude', 'worktrees', 'x', 'desks', 'bell')), null, 'relative, but run from a worktree desk')
})

test('⛔ (c) a path with a space is compared as written, never split', () => {
  const root = spaced()
  const own = join(root, 'scripts', 'bell', 'wake.mjs')
  assert.deepEqual(verdictOf(`node ${own}`, root, () => '/somewhere/else'), { proven: true }, 'our doorbell by absolute path, cwd elsewhere')
  assert.deepEqual(verdictOf(`node ${own} --thread BT-2`, root), { proven: true })
  const other = join(root + ' copy', 'scripts', 'bell', 'wake.mjs')
  assert.equal(verdictOf(`node ${other}`, root), null, 'a sibling folder sharing the prefix')
  assert.equal(verdictOf(`node ${join(root, 'scripts', 'bell', 'wake.mjs.bak')}`, root), null)
})

test('wakeMatch never lets a shell count as the doorbell', () => {
  const d = { ...bellDesk, wakeMatch: 'wake\\.mjs' }
  assert.equal(isDoorbell({ pid: 1, cmd: 'sh -c "grep -n x ../../scripts/bell/wake.mjs"' }, d), false)
  assert.equal(isDoorbell({ pid: 1, cmd: 'node ../../scripts/bell/wake.mjs' }, d), true)
})

test('⛔ the isDoorbell gate: a doorbell by absolute path under a path with a SPACE is armed, and its orphan reaches the proof', () => {
  const root = spaced()
  const own = join(root, 'scripts', 'bell', 'wake.mjs')
  const home = mkdtempSync(join(tmpdir(), 'oa-sp-home-'))
  mkdirSync(join(home, '.claude', 'sessions'), { recursive: true })
  writeFileSync(join(root, 'desks', 'bell', 'desk.json'), JSON.stringify({ name: 'bell', kind: 'knowledge', port: 9301, wake: WAKE }))
  writeFileSync(join(home, '.claude', 'sessions', '10.json'), JSON.stringify({ pid: 10, name: 'desk-bell', startedAt: Date.now() - 600_000 }))
  const armed = officeHealth(root, { home, procs: new Map([P(10, 1, 'claude', 700), P(11, 10, `node ${own}`, 500)]), cwd: () => null })
  assert.equal(armed.desks[0].doorbell.state, 'armed', 'through officeHealth, not by calling the proof directly')
  const orphan = officeHealth(root, { home, procs: new Map([P(12, 1, `node ${own} --thread BT-3`, 500)]), cwd: () => null })
  assert.deepEqual(orphan.orphans.map((x) => [x.pid, x.proven]), [[12, true]])
})
