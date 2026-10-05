// HEALING. The powers the lead granted (2026-10-05), and nothing more:
//   kill a PROVEN orphan doorbell · restart a dead desk through office.json
//   `start`, at most 3 heals per desk per hour · tell the lead when it cannot
//   heal, at most once per desk per 15 minutes.
// ⛔ NEVER typed into a desk's terminal: an unarmed doorbell is reported and
// the lead is told; the lead re-arms it with SendMessage, session to session.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { heal } from '../lib/heal.mjs'

function office(cfg = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oa-heal-'))
  mkdirSync(join(root, 'desks', 'bell'), { recursive: true })
  writeFileSync(join(root, 'desks', 'bell', 'desk.json'), JSON.stringify({ name: 'bell', kind: 'knowledge', port: 9301, wake: 'node w.mjs' }))
  writeFileSync(join(root, 'office.json'), JSON.stringify({ start: 'echo started {desk} >> started.txt', watchdog: { notify: 'lead' }, ...cfg }))
  return root
}
const health = (over = {}) => ({ code: 1, desks: [{ name: 'bell', session: { state: 'alive', pid: 10 }, doorbell: { state: 'armed' } }], checks: [], orphans: [], ...over })
const alerts = (root) => existsSync(join(root, '.office', 'alerts.log')) ? readFileSync(join(root, '.office', 'alerts.log'), 'utf8').trim().split('\n') : []

test('a proven orphan is killed and logged; a process with a live session above it never is', () => {
  const root = office()
  const killed = []
  const procs = new Map([
    [500, { pid: 500, ppid: 1, ageSec: 3600, cmd: 'node /r/w.mjs' }],          // orphan
    [10, { pid: 10, ppid: 1, ageSec: 99, cmd: 'claude' }],
    [600, { pid: 600, ppid: 10, ageSec: 60, cmd: 'node /r/w.mjs' }],           // under a live session
  ])
  const h = health({ orphans: [{ desk: 'bell', pid: 500, ageSec: 3600, cmd: 'node /r/w.mjs' }, { desk: 'bell', pid: 600, ageSec: 60, cmd: 'node /r/w.mjs' }] })
  const r = heal(root, h, { kill: (pid) => killed.push(pid), procs, livePids: new Set([10]) })
  assert.deepEqual(killed, [500], 'only the proven orphan')
  assert.ok(r.acts.some((a) => a.act === 'kill-orphan' && a.pid === 500 && a.ok))
  assert.ok(r.acts.some((a) => a.pid === 600 && !a.ok), 'the re-check refused the live one, and said so')
  assert.match(readFileSync(join(root, '.office', 'heal.log'), 'utf8'), /kill-orphan.*500/)
})

test('a dead desk is restarted through office.json `start`, with {desk} filled', () => {
  const root = office()
  const r = heal(root, health({ desks: [{ name: 'bell', session: { state: 'dead' }, doorbell: { state: 'down' } }] }), { procs: new Map() })
  assert.ok(r.acts.some((a) => a.act === 'restart' && a.ok))
  assert.equal(readFileSync(join(root, 'started.txt'), 'utf8').trim(), 'started bell')
})

test('no `start` declared: no restart is invented, the lead is told why', () => {
  const root = office({ start: undefined })
  const r = heal(root, health({ desks: [{ name: 'bell', session: { state: 'dead' }, doorbell: { state: 'down' } }] }), { procs: new Map() })
  assert.ok(!r.acts.some((a) => a.act === 'restart' && a.ok))
  assert.match(alerts(root).join('\n'), /bell.*no start/i)
})

test('the 4th heal of one desk in an hour is refused, and refusing is reported', () => {
  const root = office()
  const dead = health({ desks: [{ name: 'bell', session: { state: 'dead' }, doorbell: { state: 'down' } }] })
  let now = Date.parse('2026-10-05T12:00:00Z')
  for (let i = 0; i < 3; i++) heal(root, dead, { procs: new Map(), now: now + i * 60_000 })
  const r = heal(root, dead, { procs: new Map(), now: now + 4 * 60_000 })
  assert.ok(r.acts.some((a) => a.act === 'restart' && !a.ok && /cap/.test(a.why)))
  assert.equal(readFileSync(join(root, 'started.txt'), 'utf8').trim().split('\n').length, 3)
  // an hour later the budget is back
  const later = heal(root, dead, { procs: new Map(), now: now + 61 * 60_000 })
  assert.ok(later.acts.some((a) => a.act === 'restart' && a.ok))
})

test('an unarmed doorbell is never typed at: the lead is told, once per 15 minutes', () => {
  const root = office()
  const unarmed = health({ desks: [{ name: 'bell', session: { state: 'alive', pid: 10 }, doorbell: { state: 'unarmed', sinceStartSec: 900 } }] })
  const t = Date.parse('2026-10-05T12:00:00Z')
  const r = heal(root, unarmed, { procs: new Map(), now: t })
  assert.ok(!r.acts.some((a) => /type|send|arm/.test(a.act) && a.ok), 'no act reaches into the desk')
  heal(root, unarmed, { procs: new Map(), now: t + 5 * 60_000 })
  heal(root, unarmed, { procs: new Map(), now: t + 16 * 60_000 })
  const lines = alerts(root).filter((l) => /bell/.test(l) && /doorbell/.test(l))
  assert.equal(lines.length, 2, 'at 0 and 16 minutes, not at 5')
  assert.match(lines[0], /lead/, 'addressed to the notify session')
})

test('a failing project check runs its own `heal`, inside the same cap', () => {
  const root = office()
  const r = heal(root, health({ checks: [{ name: 'web', ok: false, why: 'exit 1', heal: 'echo healed >> web.txt' }] }), { procs: new Map() })
  assert.ok(r.acts.some((a) => a.act === 'check-heal' && a.name === 'web' && a.ok))
  assert.equal(readFileSync(join(root, 'web.txt'), 'utf8').trim(), 'healed')
})

test('a green office is left alone: no act, no alert', () => {
  const root = office()
  const r = heal(root, { code: 0, desks: [{ name: 'bell', session: { state: 'alive', pid: 10 }, doorbell: { state: 'armed' } }], checks: [], orphans: [] }, { procs: new Map() })
  assert.equal(r.acts.length, 0)
  assert.equal(alerts(root).length, 0)
})
