// THE OFFICE'S OWN CONVERSATION, and the asks nobody answered. Read from both
// ends' transcripts, merged, re-read every time.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { officeTimeline, isAsk } from '../board/timeline.mjs'
import { panelsOf, panelBody, makeServer } from '../board/serve.mjs'

const resolve = (n) => ({ 'desk-pricing': 'pricing', 'desk-chat': 'chat', 'Office Lead': 'team-lead', pricing: 'pricing', chat: 'chat' }[n] ?? null)

test('a message seen from both ends is one line; sends and receipts merge in time order', () => {
  const rows = [
    { desk: 'chat', messages: [
      { role: 'assistant', at: '2026-10-02T10:00:00Z', tools: [{ name: 'SendMessage', input: { to: 'desk-pricing', message: 'Can you price SC-1 for me?' } }] },
      { role: 'peer', from: 'desk-pricing', at: '2026-10-02T10:05:00Z', text: 'SC-1 is $4,200.' },
    ] },
    { desk: 'pricing', messages: [
      { role: 'peer', from: 'desk-chat', at: '2026-10-02T10:00:02Z', text: 'Can you price SC-1 for me?' },
      { role: 'assistant', at: '2026-10-02T10:05:00Z', tools: [{ name: 'SendMessage', input: { to: 'desk-chat', message: 'SC-1 is $4,200.' } }] },
      { role: 'assistant', at: '2026-10-02T10:06:00Z', tools: [{ name: 'SendMessage', input: { to: 'code-review', message: 'review this' } }] },
    ] },
  ]
  const t = officeTimeline(rows, resolve)
  assert.deepEqual(t.map((x) => [x.from, x.to]), [['chat', 'pricing'], ['pricing', 'chat']], 'each message once; a subagent is not a desk')
  assert.equal(t.some((x) => x.unanswered), false, 'answered, and the answer asks nothing')
})

test('the last word between two desks, when it asks, is an open ask', () => {
  const rows = [{ desk: 'team-lead', messages: [
    { role: 'assistant', at: '2026-10-02T09:00:00Z', tools: [{ name: 'SendMessage', input: { to: 'desk-pricing', message: 'Please send the two order ids.' } }] },
  ] }, { desk: 'chat', messages: [
    { role: 'peer', from: 'desk-pricing', at: '2026-10-02T09:30:00Z', text: 'Done, thanks.' },
  ] }]
  const t = officeTimeline(rows, resolve)
  assert.equal(t.find((x) => x.to === 'pricing').unanswered, true)
  assert.equal(t.find((x) => x.to === 'chat').unanswered, undefined, 'a closing line is the last word, not an ask')
  assert.ok(isAsk('which colour?') && isAsk('Please confirm') && !isAsk('Shipped.'))
})

test('panels come from office.json only, ids and commands validated; output is items, never invented', () => {
  const root = mkdtempSync(join(tmpdir(), 'oa-panels-'))
  assert.deepEqual(panelsOf(root), [], 'no office.json: no panels, and nothing breaks')
  writeFileSync(join(root, 'office.json'), JSON.stringify({ panels: [
    { id: 'approvals', title: 'Pending approvals', command: 'echo hi' },
    { id: 'Bad Id', command: 'echo x' }, { id: 'nocmd' },
  ] }))
  assert.deepEqual(panelsOf(root).map((p) => p.id), ['approvals'])
  const j = panelBody(null, JSON.stringify({ items: [{ title: 'Quote SC-9', url: 'javascript:alert(1)' }, { title: 'PO 12', url: 'https://ops.example/po/12' }], note: '2 open' }))
  assert.deepEqual(j.items.map((x) => x.url), [null, 'https://ops.example/po/12'], 'only http(s) links survive')
  assert.equal(j.note, '2 open')
  assert.deepEqual(panelBody(null, 'one\ntwo\n').items.map((x) => x.title), ['one', 'two'], 'plain lines are items')
  assert.equal(panelBody(new Error('exit 1'), '', 'boom').ok, false)
})

test('a declared panel runs at the root and serves its items', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oa-panel-run-'))
  mkdirSync(join(root, 'desks'), { recursive: true })
  writeFileSync(join(root, 'office.json'), JSON.stringify({ panels: [{ id: 'due', title: 'Due today', command: 'printf \'{"items":[{"title":"PO 7"}]}\'' }] }))
  const srv = makeServer(root)
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const b = 'http://127.0.0.1:' + srv.address().port
  const list = await (await fetch(b + '/api/panels')).json()
  const P = (id) => fetch(b + '/api/panel?id=' + id, { method: 'POST', headers: { 'content-type': 'application/json', 'x-oa-csrf': srv.csrf }, body: '{}' })
  const one = await (await P('due')).json()
  const none = await P('nope')
  const viaGet = await fetch(b + '/api/panel?id=due')
  srv.close()
  assert.deepEqual(list.panels, [{ id: 'due', title: 'Due today' }], 'the command itself never goes to the page')
  assert.deepEqual([one.ok, one.items[0].title], [true, 'PO 7'])
  assert.equal(none.status, 404)
  assert.equal(viaGet.status, 404, 'a panel command runs only on a guarded POST')
})
