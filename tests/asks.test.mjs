// AN ASK BETWEEN SESSIONS IS A CASE WITH A DUE TIME (Office-Anything #97, 2026-11-06).
// `full` asked AICS and waited; nothing re-rang. Now the ask is recorded (by a hook, not by
// anyone remembering), rung again when late, raised to the lead, then said once to the owner.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { addAsk, answerAsk, readTasks, trackAsk, closeAsksByReply, canonName, sessionTable, openTable, staleTasks } from '../lib/tasks.mjs'
import { followThrough, nextStep, followPolicy } from '../lib/follow.mjs'
import { poll } from '../lib/lead-bell.mjs'
import { heal } from '../lib/heal.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const HOOK = join(HERE, '..', 'hooks', 'ask-track.mjs')
const MIN = 60_000
const T0 = Date.parse('2026-11-06T09:00:00Z')
const LEAD = { kind: 'lead' }, FULL = { kind: 'session', name: 'full' }
function office(cfg = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oa-asks-'))
  mkdirSync(join(root, 'desks', 'aics'), { recursive: true })
  writeFileSync(join(root, 'desks', 'aics', 'desk.json'), JSON.stringify({ name: 'aics', kind: 'knowledge', port: 9701 }))
  writeFileSync(join(root, 'office.json'), JSON.stringify({ roleEnv: 'OFFICE_ROLE', lead: { session: 'Lead', bell: {} }, ...cfg }))
  return root
}
const log = (root) => { try { return readFileSync(join(root, '.office', 'alerts.log'), 'utf8').trim().split('\n') } catch { return [] } }

test('an ask is a task of kind ask: from the asker, assigned to the canonical session, due in 30 minutes', () => {
  const root = office()
  const a = addAsk(root, { to: 'desk-aics', question: 'Can you post the 0.22.0 note on Discord?' }, { by: FULL, now: T0 })
  assert.equal(a.kind, 'ask'); assert.equal(a.from, 'full'); assert.equal(a.assigned, 'desk-aics')
  assert.equal(a.dueAt, T0 + 30 * MIN)
  assert.equal(canonName(root, 'Lead'), 'lead')
  assert.throws(() => addAsk(root, { to: 'full', question: 'x?' }, { by: FULL, now: T0 }), /someone else/)
  assert.throws(() => addAsk(root, { to: 'desk-aics' }, { by: FULL, now: T0 }), /question/)
  // the asked session sees it at start
  assert.match(sessionTable(root, 'desk-aics', { now: T0 }), /post the 0\.22\.0 note/)
})

test('late: rung to the asked session, rung again, raised to the lead, then said once to the owner; each exactly once', () => {
  const root = office()
  const a = addAsk(root, { to: 'desk-aics', question: 'Can you post the note?' }, { by: FULL, now: T0 })
  const cfg = JSON.parse(readFileSync(join(root, 'office.json'), 'utf8'))
  const step = (min) => followThrough(root, cfg, { now: T0 + min * MIN })
  assert.deepEqual(step(29), [], 'not due yet: nothing')
  const d = step(31)
  assert.equal(d.length, 1); assert.equal(d[0].step, 'due')
  assert.match(d[0].text, /^NUDGE desk-aics T-\d+-1: full asked you "Can you post the note\?"/)
  assert.deepEqual(step(31), [], 'a second pass at the same minute does not ring again')
  assert.deepEqual(step(40), [], 'not before reringMinutes')
  assert.equal(step(46)[0].step, 'rering')
  assert.equal(step(62)[0].step, 'rering')
  const lead = step(78)
  assert.equal(lead[0].step, 'lead'); assert.equal(lead[0].type, 'ASK-LATE')
  assert.deepEqual(step(80), [])
  const own = step(125)   // 90 min past due is T0+120
  assert.equal(own[0].step, 'owner'); assert.equal(own[0].type, 'ASK-OWNER')
  assert.match(own[0].text, /nobody has answered/)
  assert.deepEqual(step(600), [], 'after the owner has been told, silence: said once')
  const types = log(root).map((l) => l.split(' ')[1])
  assert.deepEqual(types, ['ASK-DUE', 'ASK-DUE', 'ASK-DUE', 'ASK-LATE', 'ASK-OWNER'])
  assert.equal(readTasks(root).find((t) => t.id === a.id).updated, T0, 'a ring is not an update by the assignee')
})

test('an ask to the lead goes to the owner, not to the lead again', () => {
  const root = office()
  addAsk(root, { to: 'Lead', question: 'May I merge?' }, { by: { kind: 'desk', desk: 'aics' }, now: T0 })
  const cfg = JSON.parse(readFileSync(join(root, 'office.json'), 'utf8'))
  const steps = [31, 46, 62, 125].map((m) => followThrough(root, cfg, { now: T0 + m * MIN })[0]?.step)
  assert.deepEqual(steps, ['due', 'rering', 'rering', 'owner'])
})

test('an answer closes it for good: no ring after, and only the asked one (or the owner) may answer', () => {
  const root = office()
  const a = addAsk(root, { to: 'desk-aics', question: 'Can you post it?' }, { by: FULL, now: T0 })
  assert.throws(() => answerAsk(root, a.id, { text: 'done' }, { by: { kind: 'session', name: 'someone-else' }, now: T0 }), /only they/)
  assert.throws(() => answerAsk(root, a.id, { text: 'done' }, { by: FULL, now: T0 }), /only they/)
  assert.equal(answerAsk(root, a.id, { text: 'posted, link in #releases' }, { by: { kind: 'desk', desk: 'aics' }, now: T0 + 5 * MIN }).state, 'answered')
  assert.throws(() => answerAsk(root, a.id, { text: 'again' }, { by: { kind: 'owner' } }), /final/)
  assert.deepEqual(followThrough(root, JSON.parse(readFileSync(join(root, 'office.json'), 'utf8')), { now: T0 + 500 * MIN }), [])
  assert.equal(openTable(root, { now: T0 }), '', 'an answered ask is not open')
  assert.deepEqual(staleTasks(root, { now: T0 + 99 * 3600_000 }), [])
})

test('the office may tune the policy, and a bad value falls back', () => {
  assert.deepEqual(followPolicy({}), { reringMinutes: 15, reringTimes: 2, ownerAfterMinutes: 90 })
  assert.deepEqual(followPolicy({ followThrough: { reringMinutes: 5, reringTimes: 0, ownerAfterMinutes: 'x' } }), { reringMinutes: 5, reringTimes: 0, ownerAfterMinutes: 90 })
  const t = { dueAt: T0, state: 'open', assigned: 'desk-aics', rings: [{ stage: 'due', at: T0 + MIN }] }
  assert.equal(nextStep(t, followPolicy({ followThrough: { reringTimes: 0 } }), T0 + 20 * MIN), 'lead')
})

test('the lead\'s bell hears the follow-through alerts even when the office listed its own types', () => {
  const root = office()
  const cfg = JSON.parse(readFileSync(join(root, 'office.json'), 'utf8'))
  cfg.lead.bell = { types: ['HELD-LEAD'], asks: [] }
  const r0 = poll(root, cfg, { now: T0, state: null })
  addAsk(root, { to: 'desk-aics', question: 'Can you post it?' }, { by: FULL, now: T0 })
  followThrough(root, cfg, { now: T0 + 31 * MIN })
  const r = poll(root, cfg, { now: T0 + 32 * MIN, state: r0.state })
  assert.equal(r.lines.length, 1, JSON.stringify(r.lines))
  assert.match(r.lines[0], /^alert ASK-DUE T-\d+-1 desk-aics: NUDGE desk-aics/)
})

test('heal runs the follow-through, so one writer per office rings it', () => {
  const root = office()
  addAsk(root, { to: 'desk-aics', question: 'Can you post it?' }, { by: FULL, now: T0 })
  const r = heal(root, { code: 0, desks: [], checks: [], orphans: [], lead: null }, { now: T0 + 31 * MIN, home: mkdtempSync(join(tmpdir(), 'oa-asks-home-')), kill: () => { throw new Error('no') }, freshProcs: () => new Map(), cwd: () => null })
  assert.ok(r.acts.some((a) => a.act === 'follow-through' && a.step === 'due'), JSON.stringify(r.acts))
  assert.ok(log(root).some((l) => / ASK-DUE /.test(l)))
})

// the hook: the ask is recorded from the message itself
function hook(root, role, to, message) {
  const env = { ...process.env, OFFICE_ROLE: role, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'oa-asks-cfg-')) }
  return spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name: 'SendMessage', tool_input: { to, message }, cwd: root }), encoding: 'utf8', env })
}
test('hook: a question sent to a session opens an ask; a statement does not; a second message opens no second', () => {
  const root = office()
  assert.equal(hook(root, 'full', 'desk-aics', 'FYI the release is out.').status, 0)
  assert.equal(readTasks(root).length, 0)
  assert.equal(hook(root, 'full', 'desk-aics', 'Can you post the 0.22.0 note on Discord?').status, 0)
  assert.equal(hook(root, 'full', 'desk-aics', 'Ping, did you see this?').status, 0)
  const t = readTasks(root)
  assert.equal(t.length, 1); assert.equal(t[0].kind, 'ask'); assert.equal(t[0].from, 'full'); assert.equal(t[0].assigned, 'desk-aics')
})
test('hook: the asked session writing back to the asker closes the ask', () => {
  const root = office()
  hook(root, 'full', 'desk-aics', 'Can you post it?')
  assert.equal(readTasks(root)[0].state, 'open')
  hook(root, 'desk-aics', 'full', 'Posted.')
  const t = readTasks(root)[0]
  assert.equal(t.state, 'answered'); assert.match(t.answer, /replied by message/)
})
test('hook: failures and outsiders exit 0 and write nothing', () => {
  const out = mkdtempSync(join(tmpdir(), 'oa-asks-none-'))
  assert.equal(hook(out, 'full', 'x', 'why?').status, 0)
  const r = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8' })
  assert.equal(r.status, 0)
})
test('trackAsk and closeAsksByReply treat a lead alias and a desk name as the same session', () => {
  const root = office()
  trackAsk(root, { from: 'desk-aics', to: 'Lead', text: 'May I?' }, { now: T0 })
  assert.equal(readTasks(root)[0].assigned, 'lead')
  assert.equal(closeAsksByReply(root, { from: 'Lead', to: 'desk-aics' }, { now: T0 }).length, 1)
})
