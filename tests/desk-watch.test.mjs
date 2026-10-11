// desk-watch: each flag from a fixture transcript, nothing when healthy,
// alerts once per cause with a resolved line, never a kill or a send.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { watch, alertProblems } from '../lib/desk-watch.mjs'

const NOW = Date.parse('2026-10-11T12:00:00Z')
const at = (min) => new Date(NOW - min * 60_000).toISOString()
const slug = (d) => d.replace(/[^A-Za-z0-9]/g, '-')
let n = 0
const asst = (min, content, read = 1000) => JSON.stringify({ type: 'assistant', timestamp: at(min), message: { id: 'm' + n++, model: 'claude-sonnet-5-5', usage: { cache_read_input_tokens: read }, content } })
const use = (name, input) => ({ type: 'tool_use', id: 't' + n++, name, input })
const result = (min, is_error, text = 'ok') => JSON.stringify({ type: 'user', timestamp: at(min), message: { content: [{ type: 'tool_result', tool_use_id: 'x', is_error, content: text }] } })
const inbound = (min, from, name) => JSON.stringify({ type: 'user', timestamp: at(min), message: { content: `<cross-session-message from="${from}" from-name="${name}">\nhello\n</cross-session-message>` } })

function office(transcripts, { desks = ['a'], extra = {} } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'oa-watch-'))), cc = mkdtempSync(join(tmpdir(), 'oa-watch-cc-'))
  for (const d of desks) { mkdirSync(join(root, 'desks', d), { recursive: true }); writeFileSync(join(root, 'desks', d, 'desk.json'), JSON.stringify({ name: d, kind: 'knowledge', port: 9000 + d.charCodeAt(0) })) }
  const sessions = Object.entries(transcripts).map(([d, { lines, status = 'idle', statusUpdatedAt = NOW }], i) => {
    const cwd = join(root, 'desks', d), sessionId = `s${i}`
    mkdirSync(join(cc, 'projects', slug(cwd)), { recursive: true })
    writeFileSync(join(cc, 'projects', slug(cwd), `${sessionId}.jsonl`), lines.join('\n') + '\n')
    return { pid: 100 + i, sessionId, cwd, name: `desk-${d}`, status, statusUpdatedAt }
  })
  return { root, run: (cfg = {}, now = NOW) => watch(root, { cfg: { ...extra, ...cfg }, configDir: cc, sessions, now }) }
}
const types = (r) => r.problems.map((p) => p.type).sort()

test('a healthy desk: nothing to say', () => {
  const o = office({ a: { lines: [asst(5, [use('Read', { file_path: 'x' })]), result(5, false)] } })
  assert.deepEqual(o.run().problems, [])
})

test('loop: the same call over loopRepeats times in the window; the same message repeated', () => {
  const lines = []; for (let i = 0; i < 6; i++) lines.push(asst(10 - i, [use('Bash', { command: 'node ops.mjs ask x' })]), result(10 - i, false))
  const o = office({ a: { lines } })
  const p = o.run().problems
  assert.deepEqual(types({ problems: p }), ['DESK-LOOP'])
  assert.match(p[0].line, /same call 6 times/); assert.ok(p[0].nudge)
  assert.deepEqual(o.run({ deskWatch: { loopRepeats: 6 } }).problems, [])
})

test('error streak: tool errors and wall refusals in a row', () => {
  const lines = [asst(9, [use('Bash', { command: 'a' })])]
  for (let i = 0; i < 3; i++) lines.push(result(8 - i, true))
  lines.push(result(4, false, '⛔ desk wall (desk a): a desk writes only inside its own folder'), result(3, false, '⛔ desk wall (desk a): x'))
  assert.match(office({ a: { lines } }).run().problems.find((p) => p.cause === 'errors').line, /5 tool errors or wall refusals in a row/)
})

test('noisy: over noisyPerHour messages sent in the last hour (to the lead when leadNames is set)', () => {
  const lines = []; for (let i = 0; i < 13; i++) lines.push(asst(50 - i * 3, [use('SendMessage', { to: i % 2 ? 'lead' : 'desk-b', message: 'update ' + i })]))
  const o = office({ a: { lines } })
  assert.deepEqual(types(o.run()), ['DESK-NOISY'])
  assert.deepEqual(o.run({ deskWatch: { leadNames: ['lead'] } }).problems, [], '6 to the lead is under the limit')
})

test('stale: busy with a silent transcript; a dialog open too long', () => {
  const o = office({ a: { lines: [asst(45, [])], status: 'busy' }, b: { lines: [asst(1, [])], status: 'waiting', statusUpdatedAt: NOW - 15 * 60_000 } }, { desks: ['a', 'b'] })
  const p = o.run().problems
  assert.match(p.find((x) => x.cause === 'silent').line, /busy, but its transcript has been silent for 45 min/)
  assert.match(p.find((x) => x.cause === 'dialog').line, /dialog has been open for 15 min/)
  assert.equal(p.find((x) => x.cause === 'dialog').nudge, null, 'a dialog needs a person, not a message')
})

test('big context: average over the last calls above the limit; no nudge (compacting is typed by a person)', () => {
  const o = office({ a: { lines: [1, 2, 3, 4].map((m) => asst(m, [], 450_000)) } })
  const p = o.run().problems
  assert.deepEqual(types({ problems: p }), ['DESK-CONTEXT'])
  assert.equal(p[0].nudge, null)
})

test('unanswered inbox: a message with no reply to its sender after unansweredMinutes', () => {
  const o = office({ a: { lines: [inbound(40, 'uds:/tmp/lead.sock', 'lead'), asst(39, [use('Read', { file_path: 'x' })])] } })
  assert.match(o.run().problems[0].line, /message from lead has been unanswered for 40 min/)
  const elsewhere = office({ a: { lines: [inbound(40, 'uds:/tmp/lead.sock', 'lead'), asst(39, [use('SendMessage', { to: 'desk-b', message: 'hi' })])] } })
  assert.equal(elsewhere.run().problems.length, 1, 'a message to someone else is not an answer')
  const answered = office({ a: { lines: [inbound(40, 'uds:/tmp/lead.sock', 'lead'), asst(39, [use('SendMessage', { to: 'uds:/tmp/lead.sock', message: 'on it' })])] } })
  assert.deepEqual(answered.run().problems, [])
})

test('dead: a desk expected to run with no live session; office checks are DESK-TROUBLE lines', () => {
  const o = office({ a: { lines: [asst(1, [])] } }, { desks: ['a', 'b'] })
  const r = o.run({ deskWatch: { checks: [{ name: 'claims', command: "echo 'desk-a holds BT-1 claim, not renewed 2 h'", parse: 'lines' }] } })
  assert.deepEqual(types(r), ['DESK-DEAD', 'DESK-TROUBLE'])
  assert.match(r.problems.find((p) => p.type === 'DESK-DEAD').line, /desk-b: no live session/)
  assert.equal(r.rows.find((x) => x.desk === 'b').alive, false)
})

test('alerts: once per cause, again after alertRepeatMinutes, a DESK-RESOLVED line when it clears', () => {
  const lines = []; for (let i = 0; i < 6; i++) lines.push(asst(10 - i, [use('Bash', { command: 'same' })]))
  const o = office({ a: { lines } })
  const log = () => { try { return readFileSync(join(o.root, '.office', 'alerts.log'), 'utf8').trim().split('\n') } catch { return [] } }
  assert.equal(alertProblems(o.root, {}, o.run().problems, NOW), 1)
  assert.equal(alertProblems(o.root, {}, o.run().problems, NOW + 5 * 60_000), 0, 'quiet inside the window')
  assert.equal(alertProblems(o.root, {}, o.run().problems, NOW + 31 * 60_000), 1, 'again after 30 min')
  assert.equal(alertProblems(o.root, {}, [], NOW + 40 * 60_000), 1)
  assert.deepEqual(log().map((l) => l.split(' ')[1]), ['DESK-LOOP', 'DESK-LOOP', 'DESK-RESOLVED'])
  assert.equal(alertProblems(o.root, {}, [], NOW + 50 * 60_000), 0, 'resolved once')
})
