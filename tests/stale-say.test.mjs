// A STALE TASK RINGS ONCE (owner, 2026-11-14: "why there are many doorbell ring up
// and not purpose?"). heal said every stale task to the lead on every pass: 132
// lines a batch, every ~15 minutes, about a list that had not changed. Now a task
// is said once when it goes stale, the still-stale list is one digest line a day,
// and an unchanged list writes nothing between digests.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addTask, updateTask, staleTasks } from '../lib/tasks.mjs'
import { heal } from '../lib/heal.mjs'

const HOUR = 3600_000
const MIN = 60_000
const NOW = new Date(2026, 10, 14, 9, 0, 0).getTime()
const LEAD = { kind: 'lead' }
function office() {
  const root = mkdtempSync(join(tmpdir(), 'oa-stale-'))
  mkdirSync(join(root, 'desks', 'design'), { recursive: true })
  writeFileSync(join(root, 'desks', 'design', 'desk.json'), JSON.stringify({ name: 'design', kind: 'knowledge', port: 9711 }))
  writeFileSync(join(root, 'office.json'), JSON.stringify({ roleEnv: 'OFFICE_ROLE', lead: { session: 'Lead' } }))
  return root
}
const add = (root, title, assigned, at) => addTask(root, { said: 'x', title, assigned }, { by: LEAD, now: at }).id
const run = (root, now) => heal(root, { code: 0, desks: [], checks: [], orphans: [], lead: null }, { now, home: mkdtempSync(join(tmpdir(), 'oa-stale-home-')), kill: () => {}, freshProcs: () => new Map(), cwd: () => null })
const lines = (root) => { const f = join(root, '.office', 'alerts.log'); return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : [] }
const count = (root, re) => lines(root).filter((l) => re.test(l)).length

test('a task is said once when it goes stale, not on every pass; an unchanged list writes nothing', () => {
  const root = office()
  // the first pass learns the list (the digest only); the list is empty here
  run(root, NOW - 2 * HOUR)
  assert.equal(lines(root).length, 0, 'nothing stale, nothing said')
  const a = add(root, 'Quote Pat Example', 'construction', NOW - 25 * HOUR)
  run(root, NOW)
  assert.equal(count(root, new RegExp(`task ${a} "Quote Pat Example" \\(construction\\) open 25h with no update`)), 1)
  const before = lines(root).length
  // eight more passes, 15 minutes apart: the lead's bell hears nothing
  for (let i = 1; i <= 8; i++) run(root, NOW + i * 15 * MIN)
  assert.equal(lines(root).length, before, 'an unchanged stale list rings nothing')
  assert.equal(staleTasks(root, { now: NOW + HOUR }).length, 1, 'it is still a stale finding (health stays red)')
})

test('the still-stale list is one digest line a day: the count and the five oldest', () => {
  const root = office()
  run(root, NOW - 2 * HOUR)  // learns an empty list
  const ids = []
  for (let i = 0; i < 7; i++) ids.push(add(root, `Task ${i}`, 'construction', NOW - (30 + i) * HOUR))
  run(root, NOW)
  assert.equal(count(root, /→ lead: task T-/), 7, 'each newly stale task is said once')
  assert.equal(count(root, /stale tasks:/), 0, 'no digest yet: it is not a day since the last')
  run(root, NOW + 22 * HOUR + 2 * HOUR)  // a day after the first pass
  const d = lines(root).filter((l) => /stale tasks:/.test(l))
  assert.equal(d.length, 1)
  assert.match(d[0], /stale tasks: 7 still stale; oldest: /)
  // oldest first: Task 6 (36h), then 5, 4, 3, 2; two more not listed
  const order = [...d[0].matchAll(/"(Task \d)"/g)].map((m) => m[1])
  assert.deepEqual(order, ['Task 6', 'Task 5', 'Task 4', 'Task 3', 'Task 2'])
  assert.match(d[0], /\+2 more/)
  assert.equal(count(root, /→ lead: task T-/), 7, 'the old tasks are not said again one by one')
  run(root, NOW + 25 * HOUR)
  assert.equal(count(root, /stale tasks:/), 1, 'one a day, not every pass')
})

test('the first pass after the upgrade learns the list quietly: one digest line, not a burst', () => {
  const root = office()
  for (let i = 0; i < 40; i++) add(root, `Old ${i}`, 'construction', NOW - (48 + i) * HOUR)
  // heal-state as the old code left it: per-task keys, no "stale" list
  mkdirSync(join(root, '.office'), { recursive: true })
  writeFileSync(join(root, '.office', 'heal-state.json'), JSON.stringify({ heals: {}, notified: { 'task:T-261114-1': NOW - 10 * MIN }, restarted: {}, down: {} }))
  run(root, NOW)
  assert.equal(count(root, /→ lead: task T-/), 0, 'no line per old stale task')
  assert.equal(count(root, /stale tasks: 40 still stale/), 1)
  const st = JSON.parse(readFileSync(join(root, '.office', 'heal-state.json'), 'utf8'))
  assert.equal(Object.keys(st.stale).length, 40)
  assert.ok(!('task:T-261114-1' in st.notified), 'the old per-task keys are dropped')
  const before = lines(root).length
  run(root, NOW + 15 * MIN); run(root, NOW + 30 * MIN)
  assert.equal(lines(root).length, before)
})

test('a task that stops being stale is forgotten, and said again if it goes stale again; done-not-verified is its own going-stale', () => {
  const root = office()
  run(root, NOW - 2 * HOUR)
  const a = add(root, 'Reprice', 'design', NOW - 25 * HOUR)
  run(root, NOW)
  assert.equal(count(root, new RegExp(`task ${a} .* open 25h`)), 1)
  // the desk moves it: no longer stale
  updateTask(root, a, { state: 'working', note: 'on it' }, { by: { kind: 'desk', desk: 'design' }, now: NOW + HOUR })
  run(root, NOW + HOUR + 15 * MIN)
  const st = JSON.parse(readFileSync(join(root, '.office', 'heal-state.json'), 'utf8'))
  assert.deepEqual(st.stale, {}, 'forgotten once it is not stale')
  // quiet again for a day: said again, once
  run(root, NOW + 26 * HOUR)
  assert.equal(count(root, new RegExp(`task ${a} .* open 25h`)), 2)
  // done and not verified for 6 h: a different staleness, said once
  updateTask(root, a, { state: 'done', note: 'sent' }, { by: { kind: 'desk', desk: 'design' }, now: NOW + 27 * HOUR })
  run(root, NOW + 34 * HOUR)
  run(root, NOW + 34 * HOUR + 15 * MIN)
  assert.equal(count(root, new RegExp(`task ${a} .* done 7h ago and not verified`)), 1)
})

test('NUDGE: once per task per day at most, and only on a pass that rings anyway', () => {
  const root = office()
  run(root, NOW - 2 * HOUR)
  const a = add(root, 'Quote Pat Example', 'construction', NOW - 25 * HOUR)
  add(root, 'mine', 'lead', NOW - 25 * HOUR)
  run(root, NOW)
  assert.equal(count(root, /NUDGE construction/), 1, 'nudged on the pass it went stale')
  assert.equal(count(root, /NUDGE lead/), 0, "the lead's own task is not nudged")
  for (let i = 1; i <= 8; i++) run(root, NOW + i * HOUR)
  assert.equal(count(root, /NUDGE/), 1)
  // a new task going stale rings, but the first nudge is still inside its day
  add(root, 'Draw SO-1031', 'design', NOW - 15 * HOUR)
  run(root, NOW + 10 * HOUR)
  assert.equal(count(root, /NUDGE construction/), 1)
  assert.equal(count(root, /NUDGE design/), 1)
  // the daily digest (a day after the first pass; three stale, the lead's own counted): the first nudge is only 22 h old
  run(root, NOW + 22 * HOUR)
  assert.equal(count(root, /stale tasks: 3 still stale/), 1)
  assert.equal(count(root, /NUDGE construction/), 1, 'inside its day: not again')
  // past its day, but nothing rings on this pass: no nudge either
  run(root, NOW + 25 * HOUR)
  assert.equal(count(root, /NUDGE construction/), 1, 'a nudge never rings the bell on its own')
  // the next digest: both are past their day and go with it
  run(root, NOW + 46 * HOUR)
  assert.equal(count(root, /stale tasks: 3 still stale/), 2)
  assert.equal(count(root, new RegExp(`NUDGE construction ${a}`)), 2)
  assert.equal(count(root, /NUDGE design/), 2)
})
