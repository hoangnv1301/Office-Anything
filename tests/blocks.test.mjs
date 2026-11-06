// A BLOCK NAMES WHO CAN UNBLOCK IT, ONCE, IN ONE PLAIN LINE (Office-Anything #97, 2026-11-06).
// Example from the release that started this: "#dev channel has no id, owner must create it".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addTask, updateTask, readTasks, openTable, blockOf } from '../lib/tasks.mjs'
import { followThrough } from '../lib/follow.mjs'
import { poll } from '../lib/lead-bell.mjs'
import { queueView } from '../lib/tasks.mjs'

const MIN = 60_000
const T0 = Date.parse('2026-11-06T09:00:00Z')
const LEAD = { kind: 'lead' }
const CFG = { roleEnv: 'OFFICE_ROLE', lead: { session: 'Lead', bell: { types: ['HELD-LEAD'], asks: [] } } }
function office() {
  const root = mkdtempSync(join(tmpdir(), 'oa-block-'))
  mkdirSync(join(root, 'desks', 'aics'), { recursive: true })
  writeFileSync(join(root, 'desks', 'aics', 'desk.json'), JSON.stringify({ name: 'aics', kind: 'knowledge', port: 9731 }))
  writeFileSync(join(root, 'office.json'), JSON.stringify(CFG))
  return root
}
const mk = (root) => addTask(root, { said: 'tell David on Discord', title: 'Tell David about 0.22.0' }, { by: LEAD, now: T0 })
const lines = (root) => { try { return readFileSync(join(root, '.office', 'alerts.log'), 'utf8').trim().split('\n') } catch { return [] } }

test('waiting without a named unblocker is refused, with the exact words to add', () => {
  const root = office(); const t = mk(root)
  assert.throws(() => updateTask(root, t.id, { state: 'waiting' }, { by: LEAD, now: T0 }), /says who can unblock it: add --blocked-by/)
  assert.throws(() => updateTask(root, t.id, { state: 'waiting', blockedBy: 'stuck' }, { by: LEAD, now: T0 }), /one plain line/)
  assert.throws(() => updateTask(root, t.id, { state: 'waiting', blockedBy: 'owner: x' }, { by: LEAD, now: T0 }), /one plain line/)
  assert.throws(() => updateTask(root, t.id, { state: 'working', blockedBy: 'owner: create the channel' }, { by: LEAD, now: T0 }), /goes with --state waiting/)
  assert.equal(blockOf('owner: create the #dev channel, it has no id').who, 'owner')
  assert.equal(readTasks(root)[0].state, 'open')
})

test('a block is kept on the task, shown in the open table, and cleared when work resumes', () => {
  const root = office(); const t = mk(root)
  updateTask(root, t.id, { state: 'waiting', blockedBy: 'owner: create the #dev channel, it has no id' }, { by: LEAD, now: T0 + MIN })
  assert.deepEqual({ who: readTasks(root)[0].blocked.who, what: readTasks(root)[0].blocked.what }, { who: 'owner', what: 'create the #dev channel, it has no id' })
  assert.match(openTable(root, { now: T0 + 2 * MIN }), /WAITING ON owner: create the #dev channel, it has no id/)
  updateTask(root, t.id, { state: 'working' }, { by: LEAD, now: T0 + 3 * MIN })
  assert.equal(readTasks(root)[0].blocked, null)
  assert.doesNotMatch(openTable(root, { now: T0 + 4 * MIN }), /WAITING ON/)
})

test('the block goes to the owner once, as one plain line; the same line never rings twice, a changed one does', () => {
  const root = office(); const t = mk(root)
  updateTask(root, t.id, { state: 'waiting', blockedBy: 'owner: create the #dev channel, it has no id' }, { by: LEAD, now: T0 + MIN })
  const a = followThrough(root, CFG, { now: T0 + 2 * MIN })
  assert.equal(a.length, 1); assert.equal(a[0].type, 'ASK-OWNER'); assert.equal(a[0].subject, 'owner')
  assert.equal(a[0].text, 'Blocked: Tell David about 0.22.0 (lead). owner can unblock it: create the #dev channel, it has no id.')
  assert.deepEqual(followThrough(root, CFG, { now: T0 + 90 * MIN }), [], 'said once')
  // work resumes and the SAME block comes back: still once per (task, line)
  updateTask(root, t.id, { state: 'working' }, { by: LEAD, now: T0 + 91 * MIN })
  updateTask(root, t.id, { state: 'waiting', blockedBy: 'owner: create the #dev channel, it has no id' }, { by: LEAD, now: T0 + 92 * MIN })
  assert.deepEqual(followThrough(root, CFG, { now: T0 + 93 * MIN }), [])
  // a different blocker is a different block
  updateTask(root, t.id, { state: 'waiting', blockedBy: 'David: send the channel id' }, { by: LEAD, now: T0 + 94 * MIN })
  const b = followThrough(root, CFG, { now: T0 + 95 * MIN })
  assert.equal(b.length, 1); assert.equal(b[0].type, 'BLOCKED'); assert.match(b[0].text, /David can unblock it: send the channel id\.$/)
  assert.equal(lines(root).length, 2)
})

test('the bell hears BLOCKED and the owner line whatever types the office listed', () => {
  const root = office(); const t = mk(root)
  const r0 = poll(root, CFG, { now: T0, state: null })
  updateTask(root, t.id, { state: 'waiting', blockedBy: 'aics: confirm the release note wording' }, { by: LEAD, now: T0 + MIN })
  followThrough(root, CFG, { now: T0 + 2 * MIN })
  const r = poll(root, CFG, { now: T0 + 3 * MIN, state: r0.state })
  assert.equal(r.lines.length, 1, JSON.stringify(r.lines))
  assert.match(r.lines[0], /^alert BLOCKED T-\d+-1 aics: Blocked: Tell David about 0\.22\.0 \(lead\)\. aics can unblock it: confirm the release note wording\.$/)
})

test('the board\'s read-only API carries the block (the board has no button that sets a state, so there is nothing to send --blocked-by)', () => {
  const root = office(); const t = mk(root)
  updateTask(root, t.id, { state: 'waiting', blockedBy: 'owner: create the #dev channel, it has no id' }, { by: LEAD, now: T0 + MIN })
  const row = queueView(root, { now: T0 + 2 * MIN }).assignees.flatMap((a) => a.tasks).find((x) => x.id === t.id)
  assert.deepEqual(row.blocked, { who: 'owner', what: 'create the #dev channel, it has no id' })
})
