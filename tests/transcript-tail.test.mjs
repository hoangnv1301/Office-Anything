// ⛔ THE INCREMENTAL READER MUST EQUAL THE FULL PARSE, ALWAYS. Its only excuse
// for existing is cost: a 62 MB transcript re-read synchronously on every
// poll saturated the server's one thread and froze the whole board.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, appendFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readTail, chatFrom } from '../board/transcript.mjs'

const L = (o) => JSON.stringify(o) + '\n'
const user = (t) => L({ type: 'user', message: { content: t } })
const asst = (t, usage = { input_tokens: 10, output_tokens: 5 }) =>
  L({ type: 'assistant', message: { model: 'claude-x', content: [{ type: 'text', text: t }], usage } })

const world = () => join(mkdtempSync(join(tmpdir(), 'oa-tail-')), 't.jsonl')

test('the tail equals a full parse of the same file', () => {
  const f = world()
  writeFileSync(f, user('hello') + asst('hi there') + user('more'))
  const tail = readTail(f)
  assert.deepEqual(tail.messages, chatFrom(user('hello') + asst('hi there') + user('more'), { limit: Infinity }))
  assert.equal(tail.stats.turns, 1)
  assert.equal(tail.stats.input, 10)
  assert.equal(tail.stats.model, 'claude-x')
})

test('an unchanged file costs a stat and returns the SAME object', () => {
  const f = world()
  writeFileSync(f, user('a') + asst('b'))
  const one = readTail(f)
  const two = readTail(f)
  assert.equal(one, two, 'identity, not equality: nothing was re-read or re-built')
})

test('appended lines extend counts without corrupting what was already parsed', () => {
  const f = world()
  writeFileSync(f, user('first') + asst('answer one'))
  const before = readTail(f)
  assert.equal(before.stats.turns, 1)
  appendFileSync(f, asst('answer two', { input_tokens: 7, output_tokens: 3 }))
  utimesSync(f, new Date(), new Date())
  const after = readTail(f)
  assert.equal(after.stats.turns, 2)
  assert.equal(after.stats.input, 17)
  assert.equal(after.messages.at(-1).text, 'answer two')
  assert.equal(after.messages[0].text, 'first', 'the old head survived the append path')
})

test('a torn final line is carried, then parsed exactly once when completed', () => {
  const f = world()
  const full = asst('completed later')
  writeFileSync(f, user('start') + full.slice(0, 40))          // torn mid-line
  const torn = readTail(f)
  assert.equal(torn.stats.turns, 0, 'a torn line is not a turn')
  appendFileSync(f, full.slice(40))                            // the rest arrives
  utimesSync(f, new Date(), new Date())
  const done = readTail(f)
  assert.equal(done.stats.turns, 1, 'once completed it counts exactly once')
  assert.equal(done.messages.at(-1).text, 'completed later')
})

test('the message list stays capped while stats keep the full total', () => {
  const f = world()
  writeFileSync(f, Array.from({ length: 30 }, (_, i) => asst('m' + i)).join(''))
  const t = readTail(f, { limit: 10 })
  assert.equal(t.messages.length, 10)
  assert.equal(t.stats.turns, 30, 'the cap trims the VIEW, never the accounting')
})

test('subagents are the OTHER recent transcripts, labeled by their task', async () => {
  const { subagentsOf } = await import('../board/read.mjs')
  const dir = mkdtempSync(join(tmpdir(), 'oa-sub-'))
  const main = join(dir, 'main.jsonl')
  writeFileSync(main, user('the human session'))
  writeFileSync(join(dir, 'bot1.jsonl'), user('Review the diff for correctness issues') + asst('on it'))
  writeFileSync(join(dir, 'old-bot.jsonl'), user('ancient task'))
  const past = new Date(Date.now() - 60 * 60_000)
  utimesSync(join(dir, 'old-bot.jsonl'), past, past)
  const agents = subagentsOf(dir, main)
  assert.equal(agents.length, 1, 'the main session and the hour-old bot are both excluded')
  assert.match(agents[0].label, /Review the diff/)
  assert.equal(agents[0].turns, 1)
})

test('⛔ a question as the LAST word marks the desk blocked; an answer unblocks it', async () => {
  const { pendingAsk } = await import('../board/transcript.mjs')
  const ask = {
    role: 'assistant', text: '',
    tools: [{ name: 'AskUserQuestion', input: { questions: [{ question: 'Ship it?', header: 'Deploy', options: [{ label: 'Yes' }, { label: 'Hold', description: 'wait for QA' }] }] } }],
  }
  const p = pendingAsk([{ role: 'user', text: 'deploy?' }, ask])
  assert.equal(p.type, 'question')
  assert.equal(p.questions[0].options.length, 2)
  assert.equal(p.questions[0].options[1].description, 'wait for QA')
  assert.equal(pendingAsk([ask, { role: 'user', text: 'Yes' }]), null, 'anything after the ask means answered')
  assert.equal(pendingAsk([{ role: 'assistant', text: 'plain reply', tools: [] }]), null)
})

test('a pending plan approval is surfaced with its plan text', async () => {
  const { pendingAsk } = await import('../board/transcript.mjs')
  const p = pendingAsk([{ role: 'assistant', text: '', tools: [{ name: 'ExitPlanMode', input: { plan: '1. do the thing' } }] }])
  assert.equal(p.type, 'plan')
  assert.match(p.plan, /do the thing/)
})
