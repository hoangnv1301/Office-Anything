// THE QUEUE ON THE BOARD (owner, 2026-10-18): which of the things we are doing are
// being worked on, and which are not. Read-only, from the same fold the lead uses.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addTask, updateTask, verifyTask, queueView, evidenceOf } from '../lib/tasks.mjs'
import { makeServer } from '../board/serve.mjs'

const HOUR = 3600_000
const NOW = new Date(2026, 9, 18, 12, 0, 0).getTime()
const LEAD = { kind: 'lead' }
function office() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'oa-bt-')))
  mkdirSync(join(root, 'desks', 'design'), { recursive: true })
  writeFileSync(join(root, 'desks', 'design', 'desk.json'), JSON.stringify({ name: 'design', kind: 'knowledge', port: 9800 }))
  writeFileSync(join(root, 'office.json'), JSON.stringify({ lead: { session: 'Lead' } }))
  return root
}
const add = (root, o = {}, now = NOW) => addTask(root, { said: 'owner words', title: 'T', ...o }, { by: LEAD, now })

test('queueView: by assignee, with state counts, age, due, OVERDUE and STALE, and closed work kept out of the open groups', () => {
  const root = office()
  const a = add(root, { title: 'overdue one', assigned: 'ops-construction', due: '2026-10-17' }, NOW - 30 * HOUR)
  add(root, { title: 'working one', assigned: 'ops-construction' }, NOW - 2 * HOUR)
  updateTask(root, add(root, { title: 'waiting', assigned: 'desk-design' }, NOW - 3 * HOUR).id, { state: 'waiting' }, { by: LEAD, now: NOW - HOUR })
  const v = add(root, { title: 'checked', assigned: 'desk-design' }, NOW - 5 * HOUR)
  verifyTask(root, v.id, { evidence: 'proof.txt', proof: 'seen' }, { by: LEAD, now: NOW - HOUR })
  const q = queueView(root, { now: NOW })
  assert.deepEqual(q.assignees.map((x) => x.name), ['ops-construction', 'desk-design'])
  const ops = q.assignees[0]
  assert.deepEqual({ open: ops.counts.open, working: ops.counts.working, overdue: ops.overdue }, { open: 2, working: 0, overdue: 1 })
  const row = ops.tasks.find((t) => t.id === a.id)
  assert.equal(row.overdue, true); assert.equal(row.stale, true); assert.equal(row.age, '1d'); assert.equal(row.due, '2026-10-17')
  assert.equal(q.assignees[1].tasks.length, 1, 'verified work is not in the open groups')
  assert.equal(q.assignees[1].counts.waiting, 1)
  assert.equal(q.totals.open + q.totals.working + q.totals.waiting + q.totals.done, 4 - 1)
  assert.equal(q.totals.overdue, 1); assert.equal(q.totals.stale, 1)
  assert.equal(q.closed.length, 1); assert.equal(q.closed[0].state, 'verified')
  assert.equal(q.closed[0].evidence[0].proof, 'seen')
})

test('GET /api/tasks answers from the fold, read-only; nothing in the office changes', async () => {
  const root = office()
  add(root, { title: 'one', assigned: 'ops-construction' }, Date.now() - HOUR)
  const srv = makeServer(root)
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const { port } = srv.address()
  const j = await (await fetch(`http://127.0.0.1:${port}/api/tasks`)).json()
  assert.equal(j.assignees[0].name, 'ops-construction'); assert.equal(j.assignees[0].tasks[0].title, 'one')
  const post = await fetch(`http://127.0.0.1:${port}/api/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  srv.close()
  assert.equal(post.status, 403, 'the board writes nothing: a POST to the queue is refused by the same guard as every other write')
})

test('evidence click-through: a file inside the office, a link, or text; never outside, never a secret, only what a task recorded', async () => {
  const root = office()
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'oa-bt-out-')))
  writeFileSync(join(outside, 'secret.txt'), 'FILE-CONTENT-OUTSIDE')
  writeFileSync(join(root, 'proof.txt'), 'both buyers replied')
  mkdirSync(join(root, 'desks', 'design', 'runtime'), { recursive: true })
  writeFileSync(join(root, 'desks', 'design', 'runtime', 'token.json'), '{"t":1}')
  writeFileSync(join(root, '.env'), 'K=1')
  symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'))
  const mk = (evidence) => { const t = add(root, { title: evidence }); verifyTask(root, t.id, { evidence, proof: 'p' }, { by: LEAD, now: NOW }); return t.id }
  const ids = Object.fromEntries(['proof.txt', 'https://example.com/x', 'sent the mail myself', '../' + outside.split('/').pop() + '/secret.txt', outside + '/secret.txt', 'link.txt', 'desks/design/runtime/token.json', '.env'].map((e) => [e, mk(e)]))
  assert.deepEqual(evidenceOf(root, ids['proof.txt'], 0), { kind: 'text', content: 'both buyers replied', path: 'proof.txt' })
  assert.deepEqual(evidenceOf(root, ids['https://example.com/x'], 0), { kind: 'link', url: 'https://example.com/x' })
  assert.deepEqual(evidenceOf(root, ids['sent the mail myself'], 0), { kind: 'note', content: 'sent the mail myself' })
  for (const bad of ['../' + outside.split('/').pop() + '/secret.txt', outside + '/secret.txt', 'link.txt', 'desks/design/runtime/token.json', '.env']) {
    const r = evidenceOf(root, ids[bad], 0)
    assert.equal(r.kind, 'refused', bad + ' -> ' + JSON.stringify(r))
    assert.ok(!JSON.stringify(r).includes('FILE-CONTENT-OUTSIDE') && !JSON.stringify(r).includes('K=1'))
  }
  assert.equal(evidenceOf(root, 'T-000000-9', 0).kind, 'refused')
  assert.equal(evidenceOf(root, ids['proof.txt'], 5).kind, 'refused')
  const srv = makeServer(root)
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const { port } = srv.address()
  const ok = await (await fetch(`http://127.0.0.1:${port}/api/task-evidence?id=${ids['proof.txt']}&n=0`)).json()
  const no = await (await fetch(`http://127.0.0.1:${port}/api/task-evidence?id=${ids['.env']}&n=0&path=/etc/passwd`)).json()
  srv.close()
  assert.equal(ok.content, 'both buyers replied'); assert.equal(no.kind, 'refused')
})

test('the built UI carries the panel, and the README says where to find it', async () => {
  const { readFileSync, readdirSync } = await import('node:fs')
  const dist = new URL('../board/ui/dist/assets/', import.meta.url)
  const js = readdirSync(dist).filter((f) => f.endsWith('.js')).map((f) => readFileSync(new URL(f, dist), 'utf8')).join('')
  assert.ok(js.includes('api/tasks') && js.includes('api/task-evidence'), 'dist/ was rebuilt from the source that fetches the queue')
  assert.match(readFileSync(new URL('../README.md', import.meta.url), 'utf8'), /Tasks panel|tasks panel/)
})
