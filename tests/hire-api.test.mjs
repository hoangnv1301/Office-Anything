// ⛔ THE + BUTTON MUST GO THROUGH hire(), and the refusals must reach the
// screen intact. These pin the endpoint to the guarded entry's behavior.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeServer } from '../board/serve.mjs'

const office = () => {
  const root = mkdtempSync(join(tmpdir(), 'oa-hireapi-'))
  mkdirSync(join(root, 'desks'), { recursive: true })
  return root
}
const srv = async (root) => {
  const s = makeServer(root)
  await new Promise((r) => s.listen(0, '127.0.0.1', r))
  return { s, port: s.address().port }
}
const post = (port, body) => fetch(`http://127.0.0.1:${port}/api/hire`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})

test('a clean hire creates the desk on disk', async () => {
  const root = office(); const { s, port } = await srv(root)
  const r = await post(port, { name: 'billing', kind: 'knowledge', description: 'holds our internal margins and rates' })
  s.close()
  assert.equal(r.status, 200, await r.text())
  assert.ok(existsSync(join(root, 'desks', 'billing', 'desk.json')), 'the desk exists where the roster looks')
})

test('⛔ the two-reader disagreement is refused, with the WHY intact', async () => {
  const root = office(); const { s, port } = await srv(root)
  // the human says knowledge; the words say customers — exactly the ambiguity hire exists to stop
  const r = await post(port, { name: 'pricing', kind: 'knowledge', description: 'chats with customers about our prices' })
  const j = await r.json()
  s.close()
  assert.equal(r.status, 409)
  assert.equal(j.ok, false)
  assert.match(j.why, /agree|read/i, 'the refusal explains itself; a bare no gets worked around')
})

test('a bad name is refused by the contract, not by the endpoint improvising', async () => {
  const root = office(); const { s, port } = await srv(root)
  const r = await post(port, { name: 'Not A Name', kind: 'channel', description: 'x' })
  const j = await r.json()
  s.close()
  assert.equal(j.ok, false)
  assert.match(j.why, /not a desk name/i)
})
