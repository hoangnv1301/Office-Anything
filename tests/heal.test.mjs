// HEALING. The powers the lead granted (2026-10-05), and nothing more:
//   kill a PROVEN orphan doorbell · restart a dead desk through office.json
//   `start`, at most 3 heals per desk per hour · tell the lead when it cannot
//   heal, at most once per desk per 15 minutes.
// ⛔ NEVER typed into a desk's terminal: an unarmed doorbell is reported and
// the lead is told; the lead re-arms it with SendMessage, session to session.
// Every test injects kill and the process table: nothing here touches a real process.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { heal } from '../lib/heal.mjs'

function office(cfg = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oa-heal-'))
  const home = mkdtempSync(join(tmpdir(), 'oa-heal-home-'))
  mkdirSync(join(root, 'desks', 'bell'), { recursive: true })
  writeFileSync(join(root, 'desks', 'bell', 'desk.json'), JSON.stringify({ name: 'bell', kind: 'knowledge', port: 9301, wake: 'node ../../scripts/bell/wake.mjs' }))
  writeFileSync(join(root, 'office.json'), JSON.stringify({ start: 'echo started {desk} >> started.txt', watchdog: { notify: 'lead' }, ...cfg }))
  return { root, home, script: join(root, 'scripts', 'bell', 'wake.mjs') }
}
const P = (pid, ppid, cmd, ageSec = 60) => [pid, { pid, ppid, ageSec, cmd }]
const health = (over = {}) => ({ code: 1, desks: [{ name: 'bell', session: { state: 'alive', pid: 10 }, doorbell: { state: 'armed' } }], checks: [], orphans: [], ...over })
const dead = () => health({ desks: [{ name: 'bell', session: { state: 'dead' }, doorbell: { state: 'down' } }] })
const alerts = (root) => existsSync(join(root, '.office', 'alerts.log')) ? readFileSync(join(root, '.office', 'alerts.log'), 'utf8').trim().split('\n') : []
const noKill = () => { throw new Error('must not kill') }
const opts = (o, extra = {}) => ({ home: o.home, kill: noKill, freshProcs: () => new Map(), cwd: () => null, ...extra })

test('a proven orphan is killed on a FRESH look, and logged', () => {
  const o = office()
  const killed = []
  const h = health({ orphans: [{ desk: 'bell', pid: 500, ppid: 1, ageSec: 3600, cmd: `node ${o.script}` }] })
  const r = heal(o.root, h, opts(o, { kill: (pid) => killed.push(pid), freshProcs: () => new Map([P(500, 1, `node ${o.script}`, 3602)]) }))
  assert.deepEqual(killed, [500])
  assert.ok(r.acts.some((a) => a.act === 'kill-orphan' && a.pid === 500 && a.ok))
  assert.match(readFileSync(join(o.root, '.office', 'heal.log'), 'utf8'), /kill-orphan.*500/)
})

test('⛔ the snapshot is not the proof: reused pid, new parent, new command, a live session above it, gone', () => {
  const o = office()
  const orphan = { desk: 'bell', pid: 500, ppid: 1, ageSec: 3600, cmd: `node ${o.script}` }
  const h = health({ orphans: [orphan] })
  const cases = [
    ['younger: the pid was reused', new Map([P(500, 1, `node ${o.script}`, 5)]), /reused/],
    ['different parent', new Map([P(77, 1, 'zsh'), P(500, 77, `node ${o.script}`, 3602)]), /something else|someone else/],
    ['different command', new Map([P(500, 1, 'vim notes.txt', 3602)]), /something else/],
    ['gone', new Map(), /gone/],
  ]
  for (const [label, fresh, why] of cases) {
    let calls = 0
    const r = heal(o.root, h, opts(o, { freshProcs: () => fresh, kill: () => { calls++ } }))
    assert.equal(calls, 0, label + ': kill was called')
    assert.match(r.acts.find((a) => a.act === 'kill-orphan').why, why, label)
  }
  // a claude session took it under its wing since the report: not an orphan any more
  mkdirSync(join(o.home, '.claude', 'sessions'), { recursive: true })
  writeFileSync(join(o.home, '.claude', 'sessions', '60.json'), JSON.stringify({ pid: 60, name: 'desk-bell', startedAt: Date.now() - 1000 }))
  let calls = 0
  const r = heal(o.root, health({ orphans: [{ ...orphan, ppid: 60 }] }), opts(o, { kill: () => { calls++ }, freshProcs: () => new Map([P(60, 1, 'claude --resume x', 2), P(500, 60, `node ${o.script}`, 3602)]) }))
  assert.equal(calls, 0)
  assert.match(r.acts.find((a) => a.act === 'kill-orphan').why, /not an orphan/, 'a live session is above it now')
})

test('a dead desk is restarted through office.json `start`, with {desk} filled', () => {
  const o = office()
  const r = heal(o.root, dead(), opts(o))
  assert.ok(r.acts.some((a) => a.act === 'restart' && a.ok))
  assert.equal(readFileSync(join(o.root, 'started.txt'), 'utf8').trim(), 'started bell')
})

test('⛔ the heal is counted BEFORE the restart runs, so a crash mid-restart still spends it', () => {
  const o = office({ start: 'cat .office/heal-state.json > seen.json' })
  heal(o.root, dead(), opts(o))
  const seen = JSON.parse(readFileSync(join(o.root, 'seen.json'), 'utf8'))
  assert.equal(seen.heals['desk:bell'].length, 1, 'the start command already sees its own heal recorded')
})

test('"start": "office:start" restarts a dead desk through the plugin\'s own start, with no path to keep current', async () => {
  const { startCommandFor } = await import('../lib/heal.mjs')
  const o = office({ start: 'office:start' })
  const cmd = startCommandFor(o.root, 'office:start', 'bell')
  assert.match(cmd, /^node '.*\/lib\/start\.mjs' '.*' 'bell'$/)
  assert.equal(startCommandFor(o.root, 'echo {desk}', 'bell'), "echo bell")
})

test('no `start` declared: no restart is invented, the lead is told why', () => {
  const o = office({ start: undefined })
  const r = heal(o.root, dead(), opts(o))
  assert.ok(!r.acts.some((a) => a.act === 'restart' && a.ok))
  assert.match(alerts(o.root).join('\n'), /bell.*no start/i)
})

test('the 4th heal of one desk in an hour is refused, and refusing is reported', () => {
  const o = office()
  const now = Date.parse('2026-10-05T12:00:00Z')
  for (let i = 0; i < 3; i++) heal(o.root, dead(), opts(o, { now: now + i * 6 * 60_000 }))
  const r = heal(o.root, dead(), opts(o, { now: now + 18 * 60_000 }))
  assert.ok(r.acts.some((a) => a.act === 'restart' && !a.ok && /cap/.test(a.why)))
  assert.equal(readFileSync(join(o.root, 'started.txt'), 'utf8').trim().split('\n').length, 3)
  const later = heal(o.root, dead(), opts(o, { now: now + 80 * 60_000 }))
  assert.ok(later.acts.some((a) => a.act === 'restart' && a.ok), 'an hour later the budget is back')
})

test('⛔ one heal at a time: a second run while the lock is held does nothing', () => {
  const o = office()
  mkdirSync(join(o.root, '.office'), { recursive: true })
  writeFileSync(join(o.root, '.office', 'heal.lock'), '1 0\n')
  const r = heal(o.root, dead(), opts(o))
  assert.match(r.skipped, /another heal is running/)
  assert.ok(!existsSync(join(o.root, 'started.txt')))
})

test('an unarmed doorbell is never typed at: the lead is told, once per 15 minutes', () => {
  const o = office()
  const unarmed = health({ desks: [{ name: 'bell', session: { state: 'alive', pid: 10 }, doorbell: { state: 'unarmed', sinceStartSec: 900 } }] })
  const t = Date.parse('2026-10-05T12:00:00Z')
  const r = heal(o.root, unarmed, opts(o, { now: t }))
  assert.ok(!r.acts.some((a) => a.act !== 'notify'), 'the only act is telling the lead')
  heal(o.root, unarmed, opts(o, { now: t + 5 * 60_000 }))
  heal(o.root, unarmed, opts(o, { now: t + 16 * 60_000 }))
  const lines = alerts(o.root).filter((l) => /bell/.test(l) && /doorbell/.test(l))
  assert.equal(lines.length, 2, 'at 0 and 16 minutes, not at 5')
  assert.match(lines[0], /→ lead/, 'addressed to the notify session')
})

test('a failing project check runs its own `heal`, inside the same cap', () => {
  const o = office()
  const r = heal(o.root, health({ checks: [{ name: 'web', ok: false, why: 'exit 1', heal: 'echo healed >> web.txt' }] }), opts(o))
  assert.ok(r.acts.some((a) => a.act === 'check-heal' && a.name === 'web' && a.ok))
  assert.equal(readFileSync(join(o.root, 'web.txt'), 'utf8').trim(), 'healed')
})

test('a green office is left alone: no act, no alert', () => {
  const o = office()
  const r = heal(o.root, { code: 0, desks: [{ name: 'bell', session: { state: 'alive', pid: 10 }, doorbell: { state: 'armed' } }], checks: [], orphans: [] }, opts(o))
  assert.equal(r.acts.length, 0)
  assert.equal(alerts(o.root).length, 0)
})

test('.office/ keeps itself out of git, and its logs do not grow without bound', () => {
  const o = office({ start: 'false' })
  mkdirSync(join(o.root, '.office'), { recursive: true })
  writeFileSync(join(o.root, '.office', 'heal.log'), 'x'.repeat(600 * 1024))
  heal(o.root, dead(), opts(o))
  assert.match(readFileSync(join(o.root, '.office', '.gitignore'), 'utf8'), /^\*$/m)
  assert.ok(statSync(join(o.root, '.office', 'heal.log')).size < 4096, 'rotated')
  assert.ok(existsSync(join(o.root, '.office', 'heal.log.1')), 'one generation kept')
})

// ── after the second review ────────────────────────────────────────────────
test('⛔ a live heal that keeps touching its lock is never robbed, even mid-way through a long restart', () => {
  const o = office()
  mkdirSync(join(o.root, '.office'), { recursive: true })
  const lock = join(o.root, '.office', 'heal.lock')
  writeFileSync(lock, `${process.pid} other\n`)               // a live holder
  const mid = new Date(Date.now() - 5 * 60_000); utimesSync(lock, mid, mid)   // last touched 5 min ago: inside one 180 s act x 2
  assert.match(heal(o.root, dead(), opts(o)).skipped, /another heal is running/)
  assert.equal(readFileSync(lock, 'utf8'), `${process.pid} other\n`, 'left exactly as it was')
})

test('a lock whose holder is dead is taken over, and released after', () => {
  const o = office()
  mkdirSync(join(o.root, '.office'), { recursive: true })
  writeFileSync(join(o.root, '.office', 'heal.lock'), '999999 gone\n')
  const r = heal(o.root, dead(), opts(o))
  assert.equal(r.skipped, undefined)
  assert.ok(r.acts.some((a) => a.act === 'restart' && a.ok))
  assert.ok(!existsSync(join(o.root, '.office', 'heal.lock')))
})

test('⛔ a lock that is no longer ours is never deleted on the way out', () => {
  const o = office({ start: 'echo "1 someone-else" > .office/heal.lock' })
  heal(o.root, dead(), opts(o))
  assert.equal(readFileSync(join(o.root, '.office', 'heal.lock'), 'utf8').trim(), '1 someone-else')
})

test('⛔ the budget is re-read from disk before each spend, so another run\'s heals count', () => {
  // the desk restart (first) writes three fresh check heals into the state, as
  // a concurrent run would; the check heal later in this run must see them
  const t = Date.now()
  const o = office({ start: `node -e "const f='.office/heal-state.json';const s=JSON.parse(require('fs').readFileSync(f));s.heals['check:web']=[${t},${t},${t}];require('fs').writeFileSync(f,JSON.stringify(s))"` })
  const r = heal(o.root, health({ desks: dead().desks, checks: [{ name: 'web', ok: false, why: 'exit 1', heal: 'echo healed >> web.txt' }] }), opts(o, { now: t }))
  assert.ok(r.acts.some((a) => a.act === 'check-heal' && !a.ok && /cap/.test(a.why)), JSON.stringify(r.acts))
  assert.ok(!existsSync(join(o.root, 'web.txt')))
})

test('a desk restarted minutes ago is given time to register, not started twice', () => {
  const o = office()
  const t = Date.parse('2026-10-05T12:00:00Z')
  heal(o.root, dead(), opts(o, { now: t }))
  const again = heal(o.root, dead(), opts(o, { now: t + 2 * 60_000 }))
  assert.ok(again.acts.some((a) => a.act === 'restart' && !a.ok && /waiting/.test(a.why)))
  heal(o.root, dead(), opts(o, { now: t + 6 * 60_000 }))
  assert.equal(readFileSync(join(o.root, 'started.txt'), 'utf8').trim().split('\n').length, 2, 'at 0 and 6 minutes, not at 2')
})

// ── after the third review: the lock itself ─────────────────────────────────
test('⛔ two contenders for a dead lock: exactly one holds it (6 processes, 8 trials)', async () => {
  const { spawn } = await import('node:child_process')
  const lib = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'heal.mjs')
  for (let t = 0; t < 8; t++) {
    const dir = mkdtempSync(join(tmpdir(), 'oa-race-'))
    writeFileSync(join(dir, 'heal.lock'), '999999 crashed\n')
    const at = Date.now() + 500
    const kids = Array.from({ length: 6 }, () => new Promise((res) => {
      let out = ''
      const c = spawn(process.execPath, ['--input-type=module', '-e', `
        const { acquireLock } = await import(${JSON.stringify(lib)})
        while (Date.now() < ${at}) {}
        const l = acquireLock(${JSON.stringify(dir)})
        if (l.ok) { console.log('HELD'); await new Promise((r) => setTimeout(r, 400)) }`], { stdio: ['ignore', 'pipe', 'inherit'] })
      c.stdout.on('data', (d) => { out += d })
      c.on('close', () => res(out))
    }))
    const outs = await Promise.all(kids)
    assert.equal(outs.filter((o) => o.includes('HELD')).length, 1, `trial ${t}: holders ${outs.filter((o) => o.includes('HELD')).length}`)
  }
})

test('⛔ a reused pid does not hold the lock forever: a live pid with an old lock is taken over, and said', async () => {
  const { acquireLock } = await import('../lib/heal.mjs')
  const dir = mkdtempSync(join(tmpdir(), 'oa-reuse-'))
  // pid 1 always "answers" (EPERM): the lock of a heal that died in 2025
  writeFileSync(join(dir, 'heal.lock'), '1 stale-from-2025\n')
  const old = new Date(Date.now() - 3600_000); utimesSync(join(dir, 'heal.lock'), old, old)
  const l = acquireLock(dir)
  assert.ok(l.ok, l.why)
  assert.match(l.note, /took over/)
  l.release()
  // the same pid with a FRESH lock is a running heal: left alone, and the reason given
  writeFileSync(join(dir, 'heal.lock'), '1 running\n')
  const busy = acquireLock(dir)
  assert.equal(busy.ok, false)
  assert.match(busy.why, /pid 1.*\d+s ago/)
})

test('a skipped heal says why on the command line, never silently', async () => {
  const o = office()
  mkdirSync(join(o.root, 'desks', 'quiet'), { recursive: true })
  mkdirSync(join(o.root, '.office'), { recursive: true })
  writeFileSync(join(o.root, '.office', 'heal.lock'), `${process.pid} busy\n`)
  const { spawnSync } = await import('node:child_process')
  const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'health.mjs')
  const r = spawnSync(process.execPath, [cli, o.root, '--heal'], { encoding: 'utf8', env: { ...process.env, HOME: o.home } })
  assert.match(r.stdout, /heal skipped: another heal is running/)
})
