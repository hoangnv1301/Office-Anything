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
