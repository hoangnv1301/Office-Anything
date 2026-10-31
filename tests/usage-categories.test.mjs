// usage categories: every API call gets a TRIGGER and an ACTION; text is read only to label it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { usage, renderBy, classifyTrigger, classifyAction } from '../lib/usage.mjs'

const NOW = Date.parse('2026-10-10T12:00:00Z')
const slug = (d) => d.replace(/[^A-Za-z0-9]/g, '-')
let n = 0
const iso = () => new Date(NOW - 3600e3 + ++n * 1000).toISOString()
const user = (content, extra = {}) => JSON.stringify({ type: 'user', timestamp: iso(), message: { role: 'user', content }, ...extra }) + '\n'
const toolResult = () => user([{ type: 'tool_result', tool_use_id: 'x', content: 'PROBE-RESULT-TEXT' }])
const call = (id, blocks = [], extra = {}) => JSON.stringify({ type: 'assistant', timestamp: iso(), requestId: 'r' + id, ...extra, message: { id, model: 'claude-sonnet-5-5', content: blocks, usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 5 } } }) + '\n'
const tu = (name, input = {}) => ({ type: 'tool_use', id: 't' + ++n, name, input })

function office(files, cfg = {}) {
  const cc = mkdtempSync(join(tmpdir(), 'oa-usagecat-')), root = '/Volumes/X/office'
  const d = join(cc, 'projects', slug(root)); mkdirSync(join(d, 's', 'subagents'), { recursive: true })
  for (const [name, text] of Object.entries(files)) writeFileSync(join(d, name), text)
  return usage({ configDir: cc, root, hours: 24, now: NOW, cfg })
}
const rowOf = (r, trigger, action) => r.rows.find((x) => x.trigger === trigger && x.action === action)

test('triggers: each built-in kind is told apart', async () => {
  const lines = [
    user('please fix the thing'), call('p1'),
    user('<<autonomous-loop-dynamic>> check things'), call('h1'),
    user('Scheduled office job j1 is due (2026-10-10). Read x and do it now.'), call('h2'),
    user('<cross-session-message from="desk-a">hi</cross-session-message>'), call('c1'),
    user('<task-notification><task-id>1</task-id></task-notification>'), call('t1'),
    user('This session is being continued from a previous conversation that ran out of context.'), call('k1'),
    user('<system-reminder>hook says something</system-reminder>'), call('o1'),
    user([{ type: 'text', text: 'typed after a reminder' }]), call('p2'),
  ].join('')
  const sub = user('Do this subtask for me'), subc = call('s1')
  const r = await office({ 'a.jsonl': lines, 's/subagents/agent-1.jsonl': sub + subc })
  for (const [t, c] of [['person', 2], ['heartbeat', 2], ['peer', 1], ['task-notice', 1], ['compact', 1], ['hook', 1], ['subagent-brief', 1]]) {
    assert.equal(r.by.trigger[t]?.calls, c, `${t}: ${JSON.stringify(Object.keys(r.by.trigger))}`)
  }
})

test('triggers: a tool result is not a new turn, and a call before any user line is unknown', async () => {
  const r = await office({ 'a.jsonl': call('u0') + user('<<autonomous-loop>>') + call('x1') + toolResult() + call('x2') })
  assert.equal(r.by.trigger.unknown.calls, 1)
  assert.equal(r.by.trigger.heartbeat.calls, 2)
})

test('actions: each built-in kind', async () => {
  const r = await office({ 'a.jsonl': user('go') + [
    call('a1', [tu('Read', { file_path: '/x' })]), call('a2', [tu('Grep')]), call('a3', [tu('Bash', { command: 'cd /x && rg foo' })]), call('a4', [tu('Bash', { command: 'sed -n 1,5p f' })]),
    call('a5', [tu('Edit')]), call('a6', [tu('Write')]), call('a7', [tu('Bash', { command: 'npm test' })]), call('a8', [tu('mcp__claude-in-chrome__navigate')]),
    call('a9', [tu('SendMessage')]), call('b1', [tu('Agent')]), call('b2', [tu('WebFetch')]), call('b3', [tu('Skill', { skill: 'humanize' })]),
    call('b4', [tu('TaskCreate')]), call('b5', [{ type: 'text', text: 'just words' }]), call('b6', [tu('Read'), tu('Edit')]),
  ].join('') })
  const A = r.by.action
  assert.deepEqual([A.find.calls, A.edit.calls, A.shell.calls, A.browser.calls, A.message.calls, A.agent.calls, A.web.calls, A.skill.calls, A['other-tool'].calls, A.reply.calls], [4, 3, 1, 1, 1, 1, 1, 1, 1, 1])
})

test('a call split over lines (one tool block per line) counts once and keeps its action; a duplicate line does not double', async () => {
  const one = call('d1', [tu('Edit')]), two = call('d1', [tu('Read')], { requestId: 'rd1' })
  const r = await office({ 'a.jsonl': user('go') + one + one + two })
  assert.equal(r.calls, 1)
  assert.equal(r.by.action.edit.calls, 1)
  assert.equal(r.by.trigger.person.cacheRead, 1000)
})

test('office-defined triggers and actions come first', async () => {
  const cfg = { usage: { triggers: [{ label: 'reply customer', match: '询盘回复' }, { label: 'bad', match: '(' }], actions: [{ label: 'reply customer', tool: 'Bash', match: 'ops\\.mjs propose (询盘回复|发邮件)' }, { label: 'ask skill', match: '^humanize$' }] } }
  const r = await office({ 'a.jsonl': user('<<autonomous-loop>> 询盘回复 BT-1') + call('o1', [tu('Bash', { command: 'node ops.mjs propose 发邮件 x' })]) + call('o2', [tu('Bash', { command: 'cat f' })]) + call('o3', [tu('Skill', { skill: 'humanize' })]) + call('o4', [tu('Read', { file_path: 'ops.mjs propose 发邮件' })]) }, cfg)
  assert.equal(r.by.trigger['reply customer'].calls, 4, 'the office label beats heartbeat')
  assert.equal(rowOf(r, 'reply customer', 'reply customer').calls, 1)
  assert.equal(rowOf(r, 'reply customer', 'find').calls, 2)
  assert.equal(rowOf(r, 'reply customer', 'ask skill').calls, 1)
})

test('shares: effective and cache-read shares sorted biggest first', async () => {
  const r = await office({ 'a.jsonl': user('x') + call('s1') + user('<<autonomous-loop>>') + call('s2') + call('s3') })
  const txt = renderBy(r, 24, ['trigger'])
  const lines = txt.split('\n')
  assert.match(lines[3], /^heartbeat\s+2\s.*66\.7%/)
  assert.match(lines[4], /^person\s+1\s.*33\.3%/)
})

test('privacy: JSON, table and result carry no prompt or command text', async () => {
  const PROBE = 'ZZ-PROBE-PROMPT-ZZ'
  const r = await office({ 'a.jsonl': user(PROBE) + call('v1', [tu('Bash', { command: `echo ${PROBE}` }), tu('Skill', { skill: PROBE })]) + toolResult() })
  const all = JSON.stringify(r) + renderBy(r, 24, ['trigger', 'action'])
  assert.ok(!all.includes(PROBE) && !all.includes('PROBE-RESULT-TEXT'))
  for (const row of r.rows) assert.deepEqual(Object.keys(row).sort(), ['action', 'cacheRead', 'cacheWrite', 'calls', 'effective', 'group', 'input', 'model', 'output', 'session', 'trigger'])
})

test('cli: --by and --json print labels and numbers', () => {
  const bad = spawnSync(process.execPath, ['lib/usage.mjs', '--by', 'color'], { encoding: 'utf8' })
  assert.equal(bad.status, 1)
  assert.equal(classifyTrigger('hello'), 'person')
  assert.equal(classifyAction([]), 'reply')
})
