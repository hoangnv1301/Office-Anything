// THE SESSION'S INBOX. The board talks to a desk the way SendMessage does: the
// socket Claude Code registers per session, one auth line, one message line.
// The shapes here are the CLI's own (2.1.280), verified against a live session.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inboxOf, frameFor, sendToInbox, routeFor, envelope } from '../board/send.mjs'
import { answerKeys } from '../board/serve.mjs'

test('a frame is the auth line, then one user message in the CLI\'s own envelope, asserting no mode', () => {
  const [auth, msg, rest] = frameFor('ship the quote', 'tok123', { id: '00000000-0000-4000-8000-000000000000' }).split('\n')
  assert.deepEqual(JSON.parse(auth), { type: 'auth', token: 'tok123' })
  const m = JSON.parse(msg)
  assert.equal(m.type, 'user')
  assert.equal(m.msgV, 1)
  assert.equal(m.priority, 'next')
  assert.equal(m.message.content, '<cross-session-message from-name="office board">\nship the quote\n</cross-session-message>')
  assert.ok(!/from-mode/.test(m.message.content), '⛔ the board never claims a permission mode it does not have')
  assert.equal(rest, '', 'newline-terminated: the receiver reads by line')
  assert.equal(envelope('x', 'a"b<c>'), '<cross-session-message from-name="abc">\nx\n</cross-session-message>', 'a name cannot break out of its attribute')
})

test('the inbox is found from the session record and its key file, and receives the frame', async () => {
  const home = mkdtempSync(join(tmpdir(), 'oa-inbox-'))
  const sockDir = mkdtempSync(join(tmpdir(), 'oa-sock-'))
  const sock = join(sockDir, '4242.sock')
  mkdirSync(join(home, '.claude', 'sessions'), { recursive: true })
  const ls = { pid: 4242, messagingSocketPath: sock }
  assert.equal(inboxOf(ls, home), null, 'no key file, no inbox: never an unauthenticated write')
  writeFileSync(join(home, '.claude', 'sessions', `4242.${createHash('sha256').update(sock).digest('hex')}.key`), JSON.stringify({ peerToken: 'pt-1' }))
  const inbox = inboxOf(ls, home)
  assert.deepEqual(inbox, { sock, token: 'pt-1', pid: 4242 })
  assert.equal(inboxOf({ pid: 1, messagingSocketPath: 'relative.sock' }, home), null)
  let got = ''
  const srv = createServer((c) => c.on('data', (d) => { got += d }))
  await new Promise((r) => srv.listen(sock, r))
  const r = await sendToInbox(inbox, 'hello desk')
  srv.close()
  assert.deepEqual(r, { ok: true, via: 'inbox' })
  const lines = got.split('\n')
  assert.deepEqual(JSON.parse(lines[0]), { type: 'auth', token: 'pt-1' })
  assert.match(JSON.parse(lines[1]).message.content, /\nhello desk\n/)
  const dead = await sendToInbox({ sock: join(sockDir, 'gone.sock'), token: 'x' }, 'hi')
  assert.equal(dead.ok, false, 'a stale socket is a plain failure, never a throw')
})

test('the road: inbox where the desk takes it, terminal where it would be held, a reason where neither', () => {
  assert.deepEqual(routeFor({ inbox: true, mode: 'default', terminal: 'h1' }), { via: 'inbox' })
  assert.deepEqual(routeFor({ inbox: true, mode: 'acceptEdits', terminal: null }), { via: 'inbox' })
  // a bypass-mode desk holds a message that asserts no mode, for approval at its own screen
  assert.deepEqual(routeFor({ inbox: true, mode: 'bypassPermissions', terminal: 'h1' }), { via: 'terminal' })
  const held = routeFor({ inbox: true, mode: 'bypassPermissions', terminal: null })
  assert.equal(held.via, null)
  assert.match(held.why, /bypassed/)
  assert.equal(routeFor({ inbox: true, mode: null, terminal: null }).via, null, 'an unknown mode is not assumed to accept')
  assert.equal(routeFor({ inbox: false, mode: 'default', terminal: 'h1' }).via, 'terminal')
  assert.match(routeFor({ inbox: false, mode: 'default', terminal: null }).why, /no live session inbox/)
})

test('an answer is the option\'s number, only for the dialog one keystroke completes', () => {
  const q = (over = {}) => ({ type: 'question', questions: [{ question: 'Pick a color', header: 'Color', multiSelect: false, options: [{ label: 'Red' }, { label: 'Green' }, { label: 'Blue' }] }], ...over })
  assert.deepEqual(answerKeys(q(), 1), { ok: true, keys: '2', label: 'Green' })
  assert.equal(answerKeys(q(), 3).ok, false, 'no such option')
  assert.equal(answerKeys(q(), '1').ok, false, 'an index, not text')
  assert.equal(answerKeys(null, 0).ok, false)
  assert.match(answerKeys({ type: 'plan', plan: 'x' }, 0).why, /plan approval/)
  assert.match(answerKeys(q({ questions: [q().questions[0], q().questions[0]] }), 0).why, /2 questions/)
  assert.match(answerKeys({ type: 'question', questions: [{ ...q().questions[0], multiSelect: true }] }, 0).why, /several choices/)
})

test('⛔ delivered means the desk\'s own record shows the words queued; a closed socket alone is not', async () => {
  const { confirmDelivery, envelope } = await import('../board/send.mjs')
  const { appendFileSync } = await import('node:fs')
  const dir = mkdtempSync(join(tmpdir(), 'oa-ack-'))
  const t = join(dir, 's.jsonl')
  writeFileSync(t, '{"type":"user"}\n')
  const before = 16
  assert.equal(await confirmDelivery(t, 'price SC-1', before, { timeoutMs: 300 }), false, 'nothing appended: not delivered')
  setTimeout(() => appendFileSync(t, JSON.stringify({ type: 'queue-operation', operation: 'enqueue', content: envelope('price SC-1') }) + '\n'), 100)
  assert.equal(await confirmDelivery(t, 'price SC-1', before, { timeoutMs: 2000 }), true, 'the enqueue entry is the acknowledgement')
  assert.equal(await confirmDelivery(t, 'something else', before, { timeoutMs: 200 }), false)
})

test('⛔ a terminal is the tab named for THIS session, never just one at its folder', async () => {
  const { terminalForSession } = await import('../board/send.mjs')
  const list = (terminals) => () => JSON.stringify({ result: { terminals } })
  const tabs = [{ handle: 'dev', title: 'repo-dev-3', worktreePath: '/repo' }, { handle: 'lead', title: '✳ Office Lead', worktreePath: '/repo' }]
  assert.equal(terminalForSession({ name: 'Office Lead' }, list(tabs)), 'lead', 'the spinner glyph is not part of the name')
  assert.equal(terminalForSession({ name: 'Office Lead' }, list([tabs[0]])), null, 'no tab of its own: no terminal, not the developer\'s')
  assert.equal(terminalForSession({ name: 'Office Lead' }, list([...tabs, { handle: 'x', title: 'Office Lead' }])), null, 'two tabs one name: refuse to guess')
  assert.equal(terminalForSession({}, list(tabs)), null)
})

test('⛔ a writing request from another site, or not JSON, never reaches a desk', async () => {
  const { requestGuard } = await import('../board/send.mjs')
  const req = (headers) => ({ headers })
  const J = { 'content-type': 'application/json' }
  assert.equal(requestGuard(req({ host: '127.0.0.1:7719', ...J }), { port: 7719 }), null, 'curl on the machine')
  assert.equal(requestGuard(req({ host: '127.0.0.1:7719', origin: 'http://127.0.0.1:7719', ...J }), { port: 7719 }), null, 'the board page itself')
  assert.match(requestGuard(req({ host: '127.0.0.1:7719', origin: 'https://evil.example', ...J }), { port: 7719 }), /another site/)
  assert.match(requestGuard(req({ host: '127.0.0.1:7719', origin: 'http://127.0.0.1:7719', 'content-type': 'text/plain' }), { port: 7719 }), /application\/json/, 'the no-preflight form a page could send')
  assert.match(requestGuard(req({ host: 'evil.example', ...J }), { port: 7719 }), /own address/, 'DNS rebinding arrives with a foreign Host')
  assert.equal(requestGuard(req({ host: 'office.example.com', origin: 'https://office.example.com', ...J }), { port: 7719, hosts: ['office.example.com'] }), null, 'a host the office lists (behind its own login)')
})

test('the server refuses a cross-site POST to /api/send and /api/answer before reading it', async () => {
  const { makeServer } = await import('../board/serve.mjs')
  const root = mkdtempSync(join(tmpdir(), 'oa-guard-'))
  mkdirSync(join(root, 'desks'), { recursive: true })
  const srv = makeServer(root)
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const b = 'http://127.0.0.1:' + srv.address().port
  const post = (path, headers) => fetch(b + path, { method: 'POST', headers, body: JSON.stringify({ key: 'x', text: 'hi', option: 0 }) })
  const plain = await post('/api/send', { 'content-type': 'text/plain' })
  const foreign = await post('/api/answer', { 'content-type': 'application/json', origin: 'https://evil.example' })
  const fine = await post('/api/send', { 'content-type': 'application/json' })
  srv.close()
  assert.deepEqual([plain.status, foreign.status], [403, 403])
  assert.equal(fine.status, 404, 'a same-machine JSON request gets as far as "unknown desk"')
})

test('⛔ an answer names the question it answers, and only a waiting session takes one', async () => {
  const { askId } = await import('../board/serve.mjs')
  const q = { type: 'question', questions: [{ question: 'Pick', options: [{ label: 'A' }, { label: 'B' }] }] }
  const other = { type: 'question', questions: [{ question: 'Ship it?', options: [{ label: 'A' }, { label: 'B' }] }] }
  assert.equal(askId(q), askId(JSON.parse(JSON.stringify(q))), 'stable for the same question')
  assert.notEqual(askId(q), askId(other), 'a different question on screen is a different id')
  assert.equal(askId(null), null)
})

test('/api/answer refuses with no live session behind the row, even with a question in its transcript', async () => {
  const { makeServer } = await import('../board/serve.mjs')
  const { slugFor } = await import('../board/read.mjs')
  const root = mkdtempSync(join(tmpdir(), 'oa-ans-'))
  mkdirSync(join(root, 'desks', 'zz-no-session-desk'), { recursive: true })
  writeFileSync(join(root, 'desks', 'zz-no-session-desk', 'desk.json'), JSON.stringify({ name: 'zz-no-session-desk', kind: 'knowledge', port: 9399 }))
  const srv = makeServer(root)
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const r = await (await fetch('http://127.0.0.1:' + srv.address().port + '/api/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: slugFor(join(root, 'desks', 'zz-no-session-desk')), option: 0, ask: 'abc' }) })).json()
  srv.close()
  assert.equal(r.ok, false)
  assert.match(r.why, /no live session/)
})
