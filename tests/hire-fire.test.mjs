import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hire, inferKind } from '../lib/hire.mjs'
import { fire, blockers } from '../lib/fire.mjs'
import { roster } from '../lib/desk.mjs'
import { report } from '../checks/send-wall.mjs'
import { report as unfinished } from '../checks/unfinished.mjs'

const fresh = () => mkdtempSync(join(tmpdir(), 'office-anything-'))
const clean = (r) => rmSync(r, { recursive: true, force: true })

// ── inference suggests, never decides ────────────────────────────────────────

test('a clear channel description infers channel', () => {
  const r = inferKind('someone who answers our Instagram DMs')
  assert.equal(r.kind, 'channel')
})

test('a clear knowledge description infers knowledge', () => {
  const r = inferKind('works out pricing and margin from our cost catalog')
  assert.equal(r.kind, 'knowledge')
})

test('⛔ an empty description infers NOTHING rather than guessing', () => {
  const r = inferKind('a helpful desk')
  assert.equal(r.kind, null)
  assert.equal(r.confidence, 'none')
})

test('⛔ a description matching two kinds equally is AMBIGUOUS, not first-wins', () => {
  const r = inferKind('quotes prices to customers')     // "price" + "customer"
  assert.equal(r.kind, null, 'a silent guess about who a desk may talk to is the one guess never to make')
  assert.equal(r.confidence, 'ambiguous')
})

// ── hiring ───────────────────────────────────────────────────────────────────

test('⛔ A NEW HIRE IS NOT GREEN. It arrives red, naming what is missing.', () => {
  const root = fresh()
  hire(root, { name: 'chat', kind: 'channel', description: 'answers DMs' })
  // The send wall is correctly SILENT here: a dark channel desk with no sender is fine.
  // What fires is `unfinished`: the desk knows nothing yet, and says so.
  assert.equal(report(root).code, 0, 'the send wall has no complaint about a dark desk, correctly')
  const r = unfinished(root)
  assert.equal(r.code, 4, 'a hire that passes every check teaches you the gates are decoration')
  assert.match(JSON.stringify(r.findings), /knows nothing/)
  clean(root)
})

test('⛔ a knowledge desk is never ISSUED a sender', () => {
  const root = fresh()
  const h = hire(root, { name: 'pricing', kind: 'knowledge', description: 'holds cost catalog' })
  assert.ok(!existsSync(join(h.dir, 'runtime', 'send')), 'the capability must be ABSENT, not disabled')
  assert.ok(h.withheld.includes('sender'))
  assert.ok(h.withheld.includes('browser'), 'and a knowledge desk gets no browser either')
  clean(root)
})

test('a channel desk is issued a browser, a reader and a voice gate, but no sender', () => {
  const root = fresh()
  const h = hire(root, { name: 'chat', kind: 'channel' })
  assert.ok(existsSync(join(h.dir, 'runtime', 'read')))
  assert.ok(existsSync(join(h.dir, 'runtime', 'voice')))
  assert.ok(!existsSync(join(h.dir, 'runtime', 'send')), 'going live is a reviewed edit, not a hire-time default')
  clean(root)
})

test('⛔ hiring renumbers NOBODY, even when the new name sorts first', () => {
  const root = fresh()
  const a = hire(root, { name: 'chat', kind: 'channel' })
  const b = hire(root, { name: 'pricing', kind: 'knowledge' })
  // "billing" sorts before both. Index-based allocation would shift them.
  hire(root, { name: 'billing', kind: 'knowledge' })
  const after = roster(join(root, 'desks'))
  assert.equal(after.find(d => d.name === 'chat').port, a.port, 'chat moved. That is the defect this exists to remove.')
  assert.equal(after.find(d => d.name === 'pricing').port, b.port, 'pricing moved.')
  clean(root)
})

test('⛔ a second lead is refused', () => {
  const root = fresh()
  hire(root, { name: 'boss', kind: 'lead' })
  assert.throws(() => hire(root, { name: 'boss2', kind: 'lead' }), /already a lead/)
  clean(root)
})

test('hiring over an existing desk is refused rather than overwriting it', () => {
  const root = fresh()
  hire(root, { name: 'chat', kind: 'channel' })
  assert.throws(() => hire(root, { name: 'chat', kind: 'channel' }), /already exists/)
  clean(root)
})

// ── firing ───────────────────────────────────────────────────────────────────

test('⛔ firing without a real reason is refused, and a short one does not count', () => {
  const root = fresh()
  hire(root, { name: 'chat', kind: 'channel' })
  assert.throws(() => fire(root, 'chat', { reason: 'nope' }), /at least 20 characters/,
    'an override that is free to type becomes boilerplate')
  clean(root)
})

test('⛔ firing a LIVE desk is REFUSED, not warned about', () => {
  const root = fresh()
  const h = hire(root, { name: 'chat', kind: 'channel' })
  writeFileSync(join(h.dir, 'desk.json'), JSON.stringify({ ...h, kind: 'channel', live: true }))
  assert.throws(() => fire(root, 'chat', { reason: 'this role is going away next quarter' }), /is LIVE/)
  clean(root)
})

test('⛔ firing is REFUSED while anything still names the desk', () => {
  const root = fresh()
  hire(root, { name: 'chat', kind: 'channel' })
  mkdirSync(join(root, 'docs'), { recursive: true })
  writeFileSync(join(root, 'docs', 'team.md'), '| chat | answers DMs |\n')
  const b = blockers(root, 'chat')
  assert.ok(b.some(x => x.id === 'referenced'), 'a dangling reference outlives the folder')
  assert.throws(() => fire(root, 'chat', { reason: 'consolidating this into another desk' }), /still name/)
  clean(root)
})

test('a clean fire ARCHIVES to bk/ and never deletes', () => {
  const root = fresh()
  hire(root, { name: 'chat', kind: 'channel' })
  const r = fire(root, 'chat', { reason: 'the channel is being retired this quarter', date: '2026-08-31' })
  assert.ok(existsSync(join(root, 'bk', '2026-08-31-chat-removed')), 'never delete, always retire')
  assert.ok(!existsSync(join(root, 'desks', 'chat')))
  assert.ok(r.remaining.length >= 4, 'and it hands back the steps a script cannot do for you')
  clean(root)
})

test('⛔ the manual steps are RETURNED, so a skipped one is visible', () => {
  const root = fresh()
  hire(root, { name: 'chat', kind: 'channel' })
  const r = fire(root, 'chat', { reason: 'this desk is being folded into another one' })
  const ids = r.remaining.map(s => s.id)
  for (const must of ['session', 'shared', 'knowledge', 'docs']) {
    assert.ok(ids.includes(must), `${must} must be handed back; it is the step that broke something real`)
  }
  clean(root)
})

// ── two readers must agree ───────────────────────────────────────────────────
// ⛔ The highest-stakes call this tool makes is who may talk to a customer. A model
// deciding alone is one unchecked judgement from one sentence; a keyword list deciding
// alone cannot read intent at all. So they check each other.

test('⛔ hire REFUSES when the model and the words disagree', async () => {
  const { agreeOnKind } = await import('../lib/hire.mjs')
  const r = agreeOnKind('knowledge', 'answers customer DMs on Instagram all day')
  assert.equal(r.ok, false, 'one reading gives it a browser and a route to customers; the other does not')
  assert.match(r.why, /browser and a route to customers/)
})

test('⛔ and it refuses an AMBIGUOUS description even when the model sounds sure', async () => {
  const { agreeOnKind } = await import('../lib/hire.mjs')
  const r = agreeOnKind('channel', 'quotes prices to customers')
  assert.equal(r.ok, false, 'confidence is not evidence when the sentence does two things')
})

test('agreement passes when both readers land on the same kind', async () => {
  const { agreeOnKind } = await import('../lib/hire.mjs')
  assert.equal(agreeOnKind('channel', 'answers our Instagram DMs').ok, true)
})

test('⛔ NO keyword signal is not a disagreement', async () => {
  const { agreeOnKind } = await import('../lib/hire.mjs')
  const r = agreeOnKind('knowledge', 'handles refunds')
  assert.equal(r.ok, true, 'a clear description can contain none of the words this list knows')
  assert.equal(r.secondOpinion, 'no signal')
})

test('⛔ hire() itself refuses, not just the helper', () => {
  const root = fresh()
  assert.throws(
    () => hire(root, { name: 'x', kind: 'knowledge', description: 'answers customer DMs on Instagram' }),
    /refusing to hire/, 'the guard must be in the path everyone uses, not one they can skip')
  clean(root)
})
