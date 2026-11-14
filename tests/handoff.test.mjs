// A CASE ONLY A PERSON OUTSIDE THE OFFICE CAN CLOSE WAITS ON THAT PERSON (T-261114-75, 2026-11-14).
// desk-inventory asked desk-selene to have a coworker (Sam here) check two box labels. Only he could answer; the ask rang
// Selene and kept climbing (lead, owner) with nothing she could do. handoff records who it went to and how (and the
// post, ref); nobody is nudged while it waits, past its days it is said once to the lead, and the person's captured
// reply (relay: the office's process or the lead, never a desk) closes it in their words and wakes the asker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addAsk, addTask, handoffTask, relayAnswer, readTasks, staleTasks, sessionTable, run, HANDOFF_DAYS } from '../lib/tasks.mjs'
import { followThrough } from '../lib/follow.mjs'
import { ALWAYS_TYPES, poll } from '../lib/lead-bell.mjs'
import { closeAsksByReply } from '../lib/tasks.mjs'

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR
const T0 = Date.parse('2026-11-14T09:43:38Z')
const LEAD = { kind: 'lead' }, OWNER = { kind: 'owner' }
const desk = (n) => ({ kind: 'desk', desk: n })
function office() {
  const root = mkdtempSync(join(tmpdir(), 'oa-handoff-'))
  for (const [n, port] of [['inventory', 9711], ['selene', 9712]]) { mkdirSync(join(root, 'desks', n), { recursive: true }); writeFileSync(join(root, 'desks', n, 'desk.json'), JSON.stringify({ name: n, kind: 'knowledge', port })) }
  writeFileSync(join(root, 'office.json'), JSON.stringify({ roleEnv: 'OFFICE_ROLE', lead: { session: 'Lead', bell: {} }, asks: { track: true } }))
  return root
}
const cfgOf = (root) => JSON.parse(readFileSync(join(root, 'office.json'), 'utf8'))
const log = (root) => { try { return readFileSync(join(root, '.office', 'alerts.log'), 'utf8').trim().split('\n').filter(Boolean) } catch { return [] } }
const ask = (root) => addAsk(root, { to: 'desk-selene', question: 'Question for Sam, one plain one: could he check the box labels for two wire baskets in the warehouse?' }, { by: desk('inventory'), now: T0 })
/** the CLI in-process, as the desk the role names */
const cliAs = (root, role, args) => { const out = []; run([root, ...args], { cwd: root, env: { OFFICE_ROLE: role }, out: (s) => out.push(s) }); return out.join('\n') }

test('the real case: rung once at its due time; handed to Sam via team chat it rings nobody for the days it waits, then is said once to the lead', () => {
  const root = office(), cfg = cfgOf(root)
  const a = ask(root)
  const step = (min) => followThrough(root, cfg, { now: T0 + min * MIN })
  assert.equal(step(31)[0].step, 'due', 'as before: due, rung to Selene')
  assert.match(step(31)[0]?.text ?? '', /^$/, 'not twice at once')
  const h = handoffTask(root, a.id, { to: 'Sam', via: 'team chat', ref: 'discord:1439000000000000001' }, { by: desk('selene'), now: T0 + 40 * MIN })
  assert.equal(h.state, 'waiting'); assert.deepEqual([h.handed.who, h.handed.via, h.handed.ref], ['Sam', 'team chat', 'discord:1439000000000000001'])
  for (const min of [46, 62, 78, 125, 6 * 60, 30 * 60, 2 * 24 * 60]) assert.deepEqual(step(min), [], `no nudge at +${min} min while Sam has it`)
  assert.deepEqual(staleTasks(root, { now: T0 + 2 * DAY }), [], 'not stale while it waits')
  const late = step(40 + HANDOFF_DAYS * 24 * 60 + 1)
  assert.equal(late.length, 1); assert.equal(late[0].type, 'BLOCKED'); assert.equal(late[0].subject, 'lead')
  assert.match(late[0].text, /handed to Sam via team chat 3 days ago and has no answer\. Ask Sam again, another way, or drop it\./)
  assert.deepEqual(step(40 + HANDOFF_DAYS * 24 * 60 + 90), [], 'said once')
  assert.match(sessionTable(root, 'desk-selene', { now: T0 + HOUR }), /HANDED TO Sam \(team chat\)/)
})

test("relay: Sam's captured reply (by --ref) answers it in his words and wakes desk-inventory, through the lead's bell", () => {
  const root = office()
  const a = ask(root)
  handoffTask(root, a.id, { to: 'Sam', via: 'team chat', ref: 'discord:1439000000000000001' }, { by: desk('selene'), now: T0 + 40 * MIN })
  const r = relayAnswer(root, { ref: 'discord:1439000000000000001', who: 'sam', text: 'basket one label says 100-200, basket two says 100-300' }, { by: OWNER, now: T0 + 3 * HOUR })
  assert.equal(r.state, 'answered'); assert.equal(r.wake, 'desk-inventory')
  assert.equal(r.answer, 'Sam (team chat): basket one label says 100-200, basket two says 100-300')
  const [line] = log(root).filter((l) => / ASK-ANSWERED /.test(l))
  assert.match(line, new RegExp(` ASK-ANSWERED ${a.id} desk-inventory NUDGE desk-inventory ${a.id}: Sam answered \\(team chat\\): "basket one label says 100-200, basket two says 100-300"$`))
  assert.ok(ALWAYS_TYPES.includes('ASK-ANSWERED'), 'the bell hears it whatever its types list says')
  assert.deepEqual(followThrough(root, cfgOf(root), { now: T0 + 10 * DAY }), [], 'answered: never rung again')
  assert.throws(() => relayAnswer(root, { id: a.id, who: 'Sam', text: 'again' }, { by: OWNER, now: T0 + 4 * HOUR }), /final/)
})

test('who may: a desk cannot relay (no "Sam said" from a desk); the person must be the one it was handed to; only a hand-off is relayed; only the assignee or the lead hands off', () => {
  const root = office()
  const a = ask(root)
  assert.throws(() => relayAnswer(root, { id: a.id, who: 'Sam', text: 'x' }, { by: OWNER, now: T0 }), /not handed off/)
  assert.throws(() => handoffTask(root, a.id, { to: 'Sam', via: 'team chat' }, { by: desk('inventory'), now: T0 }), /only it \(or the lead\)/)
  assert.throws(() => handoffTask(root, a.id, { to: 'Sam' }, { by: desk('selene'), now: T0 }), /--via/)
  assert.throws(() => handoffTask(root, a.id, { to: 'Sam', via: 'team chat', days: 30 }, { by: desk('selene'), now: T0 }), /--days/)
  handoffTask(root, a.id, { to: 'Sam', via: 'team chat', ref: 'p1' }, { by: desk('selene'), now: T0 })
  assert.throws(() => relayAnswer(root, { id: a.id, who: 'Sam', text: 'x' }, { by: desk('selene'), now: T0 }), /a desk does not answer for a person/)
  assert.throws(() => relayAnswer(root, { id: a.id, who: 'Hoang', text: 'x' }, { by: OWNER, now: T0 }), /handed to Sam, not Hoang/)
  assert.throws(() => relayAnswer(root, { ref: 'nope', who: 'Sam', text: 'x' }, { by: OWNER, now: T0 }), /no open hand-off/)
  // another open hand-off may not take the same post
  const b = addAsk(root, { to: 'desk-selene', question: 'And the third basket?' }, { by: desk('inventory'), now: T0 })
  assert.throws(() => handoffTask(root, b.id, { to: 'Sam', via: 'team chat', ref: 'p1' }, { by: desk('selene'), now: T0 }), /already names another/)
  // a task handed off is done in his words (the lead still verifies it); the holder is woken
  const t = addTask(root, { said: 'get the label photo', title: 'Label photo', assigned: 'desk-selene' }, { by: LEAD, now: T0 })
  handoffTask(root, t.id, { to: 'Sam', via: 'team chat' }, { by: LEAD, now: T0 })
  const done = relayAnswer(root, { id: t.id, who: 'Sam', text: 'photo sent in #warehouse' }, { by: LEAD, now: T0 + HOUR })
  assert.equal(done.state, 'done'); assert.equal(done.wake, 'desk-selene')
  // the assignee working it again ends the hand-off: the clock is hers once more
  const c = addAsk(root, { to: 'desk-selene', question: 'Fourth basket?' }, { by: desk('inventory'), now: T0 })
  handoffTask(root, c.id, { to: 'Sam', via: 'team chat' }, { by: desk('selene'), now: T0 })
  assert.equal(readTasks(root).find((x) => x.id === c.id).handed?.who, 'Sam')
})

test('the CLI as the desk: Selene hands off as herself; the same desk relaying is refused', () => {
  const root = office()
  const a = ask(root)
  assert.match(cliAs(root, 'desk-selene', ['handoff', a.id, '--to', 'Sam', '--via', 'team chat', '--ref', 'discord:42']), /handed to Sam via team chat: waiting, no nudges until/)
  assert.throws(() => cliAs(root, 'desk-selene', ['relay', '--ref', 'discord:42', '--who', 'Sam', '--text', 'the labels say 100-200']), /a desk does not answer for a person/)
  assert.equal(readTasks(root).find((t) => t.id === a.id).state, 'waiting')
})

test("a reply from Selene to the asker ('handed to Sam, waiting') leaves the hand-off open; the lead's bell carries the answer as a NUDGE line that fits", () => {
  const root = office(), cfg = cfgOf(root)
  const a = ask(root)
  handoffTask(root, a.id, { to: 'Sam', via: 'team chat', ref: 'p9' }, { by: desk('selene'), now: T0 })
  assert.deepEqual(closeAsksByReply(root, { from: 'desk-selene', to: 'desk-inventory' }, { now: T0 + MIN }), [], 'her message is not his answer')
  assert.equal(readTasks(root).find((t) => t.id === a.id).state, 'waiting')
  const r0 = poll(root, cfg, { now: T0 + MIN, state: null })
  relayAnswer(root, { ref: 'p9', who: 'Sam', text: 'x '.repeat(200) + 'end' }, { by: OWNER, now: T0 + 2 * MIN })
  const r = poll(root, cfg, { now: T0 + 3 * MIN, state: r0.state })
  assert.equal(r.lines.length, 1, JSON.stringify(r.lines))
  assert.match(r.lines[0], new RegExp(`^alert ASK-ANSWERED ${a.id} desk-inventory: NUDGE desk-inventory ${a.id}: Sam answered \\(team chat\\): "x x .*…"$`), 'whole, quote closed, inside the bell\'s 300 characters')
})
