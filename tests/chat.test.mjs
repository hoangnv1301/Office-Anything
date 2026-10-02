// THE CHAT VIEW. The transcript is the native record; the parser renders its
// tail and invents nothing. Send goes through one adapter that says plainly
// when it cannot.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chatFrom, newestSession } from '../board/transcript.mjs'
import { normalizeTitle, send, orcaAvailable } from '../board/send.mjs'
import { makeServer } from '../board/serve.mjs'

const L = (o) => JSON.stringify(o) + '\n'

test('user text and assistant text become messages; plumbing does not', () => {
  const jsonl =
    L({ type: 'user', message: { content: 'hello desk' }, timestamp: '2026-09-02T10:00:00Z' })
    + L({ type: 'assistant', message: { model: 'claude-opus-5', content: [{ type: 'text', text: 'hello back' }, { type: 'tool_use', name: 'Bash' }] } })
    + L({ type: 'user', message: { content: [{ type: 'tool_result', content: 'exit 0' }] } })
    + '{"type":"assistant","message":{"content":[{"type":"te'   // torn tail of a live session
  const m = chatFrom(jsonl)
  assert.equal(m.length, 2, 'a tool_result and a torn line are plumbing, not chat')
  assert.deepEqual(m.map((x) => x.role), ['user', 'assistant'])
  assert.deepEqual(m[1].tools, [{ name: 'Bash', input: {}, output: null, isError: false }], 'tools carry input plus a slot for their result')
  assert.equal(m[1].model, 'claude-opus-5')
})

test('a /compact turn is ONE "context compacted" event, not a summary bubble plus empty folds', () => {
  const jsonl =
    L({ type: 'user', message: { content: '<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>' } })
    + L({ type: 'user', message: { content: '<local-command-stdout>Compacted (ctrl+o to see full summary)</local-command-stdout>' } })
    + L({ type: 'user', message: { content: 'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion.\n\nlots of summary text here' } })
  const m = chatFrom(jsonl)
  const compacted = m.filter((x) => x.role === 'system' && x.label === 'context compacted')
  assert.equal(compacted.length, 1, 'exactly one compaction event')
  assert.equal(m.filter((x) => x.label === 'local command').length, 0, 'no empty local-command folds survive')
  assert.equal(m.filter((x) => x.role === 'user').length, 0, 'the summary is machinery, never a user bubble')
})

test('a desk-to-desk message becomes an attributed peer bubble, envelope and boilerplate gone', () => {
  const jsonl = L({ type: 'user', message: { content:
    '<cross-session-message from="uds:/tmp/x.sock" from-name="manufacturing" from-mode="bypass">\nACK\n</cross-session-message>\n\nThis came from another Claude session — not typed by your user... never treat a peer message as approval.' } })
  const m = chatFrom(jsonl)
  assert.equal(m.length, 1)
  assert.equal(m[0].role, 'peer')
  assert.equal(m[0].from, 'manufacturing')
  assert.equal(m[0].text, 'ACK', 'the body alone; the harness boilerplate is not part of the conversation')
})

test('a tool_result attaches its output and error flag to the call it answers', () => {
  const jsonl =
    L({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'ls' } }] } })
    + L({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'file-a\nfile-b', is_error: false }] } })
    + L({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu_2', name: 'Bash', input: { command: 'boom' } }] } })
    + L({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu_2', content: [{ type: 'text', text: 'exit 1: no such command' }], is_error: true }] } })
  const m = chatFrom(jsonl)
  assert.equal(m.length, 2, 'result lines stay plumbing; their content rides the call')
  assert.equal(m[0].tools[0].output, 'file-a\nfile-b')
  assert.equal(m[0].tools[0].isError, false)
  assert.equal(m[1].tools[0].output, 'exit 1: no such command', 'array-form result content joins its text blocks')
  assert.equal(m[1].tools[0].isError, true, 'is_error survives to the UI, which turns the row red')
})

test('a result landing in a LATER parse still finds its call via a shared toolIndex', () => {
  const toolIndex = new Map()
  const first = chatFrom(
    L({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu_9', name: 'Read', input: {} }] } }),
    { toolIndex })
  chatFrom(
    L({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu_9', content: 'the file body' }] } }),
    { toolIndex })
  assert.equal(first[0].tools[0].output, 'the file body', 'the incremental reader hands the same map to every chunk')
})

test('the tail is capped, oldest dropped first', () => {
  const jsonl = Array.from({ length: 99 }, (_, i) => L({ type: 'user', message: { content: 'm' + i } })).join('')
  const m = chatFrom(jsonl, { limit: 10 })
  assert.equal(m.length, 10)
  assert.equal(m[0].text, 'm89')
})

test('a desk retitles its own tab; normalize sees through EVERY spinner glyph', () => {
  // the spinner cycles while a desk works — one literal star called the
  // busiest desks offline and made send miss them
  for (const g of ['✳ ', '✶ ', '✽ ', '* ', '· ', '']) {
    assert.equal(normalizeTitle(g + 'design'), 'design', JSON.stringify(g))
  }
  assert.equal(normalizeTitle('DESK-design'), 'design')
  // start.mjs names tabs `desk-<name>` in lower case (2026-09-25): the board
  // called every such desk offline and could not send to it
  assert.equal(normalizeTitle('✳ desk-customer'), 'customer')
})

test('the lead fallback never lands on a tab that names itself a desk', () => {
  // every tab start.mjs opens shares the repo root as worktreePath, so "newest
  // output in the lead's folder" picked whichever DESK had just spoken
  const run = (cmd, args) => {
    if (args.includes('--version')) return ''
    if (args.includes('list')) return JSON.stringify({ result: { terminals: [
      { handle: 'H_DESK', title: '✳ desk-customer', worktreePath: '/work/office', writable: true, lastOutputAt: 900 },
      { handle: 'H_LEAD', title: '◑ some task summary', worktreePath: '/work/office', writable: true, lastOutputAt: 500 },
    ] } })
    return ''
  }
  assert.equal(send('team-lead', 'hi', run, '/work/office').handle, 'H_LEAD')
  assert.equal(send('customer', 'hi', run, '/work/office/desks/customer').handle, 'H_DESK')
})

test('no orca means read-only, said plainly, never a fallback', () => {
  const noOrca = () => { throw new Error('ENOENT') }
  assert.equal(orcaAvailable(noOrca), false)
  const r = send('design', 'hi', noOrca)
  assert.equal(r.ok, false)
  assert.match(r.why, /read-only/)
})

test('send refuses a desk with no live terminal rather than typing anywhere', () => {
  const run = (cmd, args) => {
    if (args.includes('--version')) return ''
    if (args.includes('list')) return JSON.stringify({ result: { terminals: [{ handle: 'H1', title: '✳ other' }] } })
    throw new Error('must not reach the send verb')
  }
  const r = send('design', 'hi', run)
  assert.equal(r.ok, false)
  assert.match(r.why, /no live terminal/)
})

test('the LEAD is found by its working directory when no tab bears its name', () => {
  const sent = []
  const run = (cmd, args) => {
    if (args.includes('--version')) return ''
    if (args.includes('list')) return JSON.stringify({ result: { terminals: [
      { handle: 'H_V1', title: '✳ some task summary', worktreePath: '/work/v1-repo', writable: true, lastOutputAt: 900 },
      { handle: 'H_LEAD', title: '✳ another task summary', worktreePath: '/work/office', writable: true, lastOutputAt: 500 },
      { handle: 'H_DESK', title: '✳ design', worktreePath: '/work/office/desks/design', writable: true, lastOutputAt: 100 },
    ] } })
    sent.push(args); return ''
  }
  const r = send('team-lead', 'hi', run, '/work/office')
  assert.equal(r.ok, true)
  assert.equal(r.handle, 'H_LEAD', 'exact worktreePath equality, so v1\'s terminal at a different path is unreachable by construction')
  const miss = send('team-lead', 'hi', run, '/work/nowhere')
  assert.equal(miss.ok, false, 'no title and no directory match refuses, never types anywhere')
})

test('the server serves the chat shell and the office api', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oa-chat-'))
  mkdirSync(join(root, 'desks', 'billing'), { recursive: true })
  writeFileSync(join(root, 'desks', 'billing', 'desk.json'),
    JSON.stringify({ name: 'billing', kind: 'knowledge', port: 9231, live: false }))
  const srv = makeServer(root)
  await new Promise((res) => srv.listen(0, '127.0.0.1', res))
  const { port } = srv.address()
  const page = await (await fetch(`http://127.0.0.1:${port}/chat`)).text()
  const api = await (await fetch(`http://127.0.0.1:${port}/api/office-chat`)).json()
  assert.ok(page.includes('<div id="root">'), 'the built shadcn app serves as the front door')
  const js = page.match(/assets\/[\w.-]+\.js/)
  assert.ok(js, 'the page references its bundle')
  const bundle = await fetch(`http://127.0.0.1:${port}/${js[0]}`)
  srv.close()
  assert.equal(bundle.status, 200, 'the bundle serves')
  assert.deepEqual(api.desks.map((d) => d.label), ['team-lead', 'billing'], 'the lead sits in the list beside its desks')
  assert.equal(typeof api.canSend, 'boolean')
})

test('the newest HUMAN session wins over a newer robot one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oa-pick-'))
  writeFileSync(join(dir, 'human.jsonl'), JSON.stringify({ type: 'user', entrypoint: 'cli', message: { content: 'hi' } }) + '\n')
  writeFileSync(join(dir, 'robot.jsonl'), JSON.stringify({ type: 'user', entrypoint: 'sdk-py', message: { content: 'beep' } }) + '\n')
  const past = new Date(Date.now() - 60000)
  // the robot is NEWER, and must still lose to the human session
  utimesSync(join(dir, 'human.jsonl'), past, past)
  assert.ok(newestSession(dir).endsWith('human.jsonl'))
})

test('a LIVE session beats a newer transcript, and the remote-controlled one leads', () => {
  // 2026-09-25: two live CLI sessions at one repo root. Newest-mtime flipped
  // the lead's view to whichever of them wrote last
  const dir = mkdtempSync(join(tmpdir(), 'oa-live-'))
  const home = mkdtempSync(join(tmpdir(), 'oa-home-'))
  mkdirSync(join(home, '.claude', 'sessions'), { recursive: true })
  const line = JSON.stringify({ type: 'user', entrypoint: 'cli', message: { content: 'hi' } }) + '\n'
  for (const f of ['lead', 'other', 'dead']) writeFileSync(join(dir, f + '.jsonl'), line)
  const past = new Date(Date.now() - 60000)
  utimesSync(join(dir, 'lead.jsonl'), past, past)
  const reg = (pid, sessionId, extra = {}) => writeFileSync(join(home, '.claude', 'sessions', pid + '.json'), JSON.stringify({ pid, sessionId, cwd: '/x', ...extra }))
  reg(process.pid, 'lead', { bridgeSessionId: 'b1' })
  reg(process.ppid, 'other')
  assert.ok(newestSession(dir, home).endsWith('lead.jsonl'), 'the phone-driven live session is the lead')
  // no live registration at all: the old rule (newest human session) stands
  assert.ok(newestSession(dir, mkdtempSync(join(tmpdir(), 'oa-none-'))).match(/(other|dead)\.jsonl$/))
})

test('what the CLI never renders, the board never renders: system-reminders and caveats', () => {
  const jsonl =
    L({ type: 'user', message: { content: '<system-reminder>\nAs you answer, the memory dir is…\n</system-reminder>' } })
    + L({ type: 'user', message: { content: 'Caveat: The messages below were generated by the user while running local commands.' } })
    + L({ type: 'user', message: { content: '<local-command-caveat>Caveat: …</local-command-caveat>' } })
    + L({ type: 'user', message: { content: 'a real question from the owner' } })
  const m = chatFrom(jsonl)
  assert.equal(m.length, 1, 'three context injections produce nothing; the human line stays')
  assert.equal(m[0].role, 'user')
})

test('a desk restored at the repo root never becomes the lead\'s live row', async () => {
  // Orca relaunched desks with `claude --resume` from the root: same cwd as the
  // lead, newer status change, and the lead's row showed a desk's state
  const { liveSessions } = await import('../board/serve.mjs')
  const home = mkdtempSync(join(tmpdir(), 'oa-rows-'))
  mkdirSync(join(home, '.claude', 'sessions'), { recursive: true })
  const reg = (pid, name, updatedAt) => writeFileSync(join(home, '.claude', 'sessions', pid + '.json'), JSON.stringify({ pid, name, cwd: '/repo', updatedAt }))
  reg(process.pid, 'desk-customer', 2000)
  reg(process.ppid, 'repo-37', 1000)
  assert.equal(liveSessions(home).get('/repo').name, 'repo-37')
})

test('a transcript bigger than the read window shows its NEWEST turns, not the first window', async () => {
  // 2026-09-25: the lead's jsonl hit 74.5 MB; the reader parsed bytes 0..64 MB,
  // called the file read, and the board sat on a turn from hours before
  const { readTail } = await import('../board/transcript.mjs')
  const dir = mkdtempSync(join(tmpdir(), 'oa-big-'))
  const p = join(dir, 's.jsonl')
  const lines = Array.from({ length: 200 }, (_, i) => L({ type: 'user', message: { content: 'msg ' + i } })).join('')
  writeFileSync(p, lines)
  const t = readTail(p, { cap: 1500 })
  assert.equal(t.messages.at(-1).text, 'msg 199', 'the newest line is on screen')
  assert.ok(t.messages.every((m) => /^msg \d+$/.test(m.text)), 'the window starts at a whole line, never a torn one')
  // and it keeps following: an append past the window is read too
  const { appendFileSync } = await import('node:fs')
  appendFileSync(p, Array.from({ length: 100 }, (_, i) => L({ type: 'user', message: { content: 'late ' + i } })).join(''))
  assert.equal(readTail(p, { cap: 1500 }).messages.at(-1).text, 'late 99')
})

test('an agent hand-back envelope is system traffic, not the owner typing', () => {
  // seen live 2026-09-25 on the lead: the newer envelope opens with prose
  // before the tag, so the tag-anchored shapes let it through as a user bubble
  const m = chatFrom(L({ type: 'user', message: { content: 'Another Claude session sent a message:\n<agent-message from="a33b">\n[Subagent hand-back] report\n</agent-message>' } }))
  assert.equal(m.filter((x) => x.role === 'user').length, 0)
})

// Shapes copied from a real desk session (Claude Code 2.1.280), names and
// paths anonymised. A message that lands while the desk is busy is recorded
// as an ATTACHMENT, never as a user entry, and the board used to drop them all.
const queued = (attachment, extra = {}) => L({
  parentUuid: 'p-1', isSidechain: false, type: 'attachment', uuid: extra.uuid ?? 'att-' + Math.random(),
  timestamp: attachment.timestamp, attachment,
  rendered: [{ content: '<system-reminder>\nThe user sent a new message while you were working:\n...\n</system-reminder>' }],
  sessionId: 's-1', entrypoint: 'cli', version: '2.1.280',
})

test('queued commands are chat: the owner mid-turn, a peer by its envelope, a background task as an event', () => {
  const jsonl =
    L({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'ls' } }] } })
    + queued({ type: 'queued_command', prompt: 'Owner rule, applies to all three jobs now: standard boxes + filler everywhere.',
      source_uuid: 'src-human', commandMode: 'prompt', origin: { kind: 'human' }, timestamp: '2026-09-24T04:05:31.236Z', humanTurn: true })
    + queued({ type: 'queued_command',
      prompt: '<cross-session-message from="uds:/tmp/cc-socks/10270.sock" from-name="office-lead-86" from-mode="bypass">\nFrom lead: the customer desk opened three orders. Please design and price each one.\n</cross-session-message>',
      source_uuid: 'src-peer', commandMode: 'prompt', origin: { kind: 'peer', from: 'uds:/tmp/cc-socks/10270.sock', verifiedPeerPid: 10270 }, timestamp: '2026-09-27T10:00:00.000Z' })
    + queued({ type: 'queued_command', prompt: '<task-notification>\n<task-id>b3t02u87d</task-id>\n<status>completed</status>\n</task-notification>',
      commandMode: 'task-notification', timestamp: '2026-09-27T10:01:00.000Z' }, { uuid: 'att-task' })
    + queued({ type: 'queued_command', prompt: [{ type: 'text', text: 'the local version looks broken next to the remote one [Image #5]' }],
      source_uuid: 'src-list', imagePasteIds: [5], commandMode: 'prompt', origin: { kind: 'human' }, timestamp: '2026-09-27T10:02:00.000Z' })
  const m = chatFrom(jsonl)
  assert.deepEqual(m.map((x) => x.role), ['assistant', 'user', 'peer', 'system', 'user'])
  assert.equal(m[1].text, 'Owner rule, applies to all three jobs now: standard boxes + filler everywhere.')
  assert.equal(m[1].queued, true, 'marked as said mid-turn')
  assert.equal(m[1].at, '2026-09-24T04:05:31.236Z')
  assert.equal(m[2].from, 'office-lead-86', 'the envelope names the sender, as for a peer user entry')
  assert.equal(m[2].text, 'From lead: the customer desk opened three orders. Please design and price each one.')
  assert.equal(m[3].label, 'background task')
  assert.match(m[4].text, /^the local version looks broken/, 'a prompt recorded as content blocks reads its text')
})

test('a queued command recorded twice is one message, also across incremental reads', () => {
  const a = { type: 'queued_command', prompt: 'please re-run the quote', source_uuid: 'src-dup', commandMode: 'prompt', origin: { kind: 'human' }, timestamp: '2026-09-27T10:00:00Z' }
  assert.equal(chatFrom(queued(a) + queued(a)).length, 1, 'same source_uuid twice in one chunk')
  const seen = new Set()
  const first = chatFrom(queued(a), { seen })
  const second = chatFrom(queued(a), { seen })
  assert.equal(first.length + second.length, 1, 'the seen set rides the tail cache between chunks')
  // and a copy the CLI ALSO wrote as a plain user entry does not double the bubble
  const both = queued({ ...a, source_uuid: 'src-x' }) + L({ type: 'user', message: { content: 'please re-run the quote' } })
  assert.equal(chatFrom(both).length, 1)
})

test('a peer message without an envelope is still the peer speaking, never the owner', () => {
  const m = chatFrom(queued({ type: 'queued_command', prompt: 'status?', source_uuid: 'src-bare', commandMode: 'prompt',
    origin: { kind: 'peer', from: 'uds:/tmp/cc-socks/1.sock' }, timestamp: '2026-09-27T10:00:00Z' }))
  assert.equal(m.length, 1)
  assert.equal(m[0].role, 'peer')
  assert.equal(m[0].from, 'uds:/tmp/cc-socks/1.sock')
})

test('every live status the CLI writes has a state; shell is working, waiting says what for', async () => {
  const { stateOf } = await import('../board/serve.mjs')
  assert.equal(stateOf({ status: 'busy' }).busy, true)
  assert.deepEqual([stateOf({ status: 'shell' }).state, stateOf({ status: 'shell' }).busy], ['shell', true], 'a running command is the desk working, not idle')
  const w = stateOf({ status: 'waiting', waitingFor: 'permission prompt' })
  assert.deepEqual([w.state, w.waiting, w.detail], ['waiting', true, 'permission prompt'])
  assert.equal(stateOf({ status: 'waiting', waitingFor: 'dialog open', needs: 'choose: allow or deny' }).detail, 'choose: allow or deny', 'needs is the more specific of the two')
  assert.deepEqual([stateOf({ status: 'idle' }).state, stateOf({ status: 'idle' }).busy], ['idle', false])
  const odd = stateOf({ status: 'parked' })
  assert.deepEqual([odd.state, odd.busy], ['parked', null], 'an unknown status is said as-is, never guessed into busy or idle')
  assert.equal(stateOf(null), null)
})

test('the lead is the session the office NAMES, not the one that changed status last', async () => {
  const { liveSessions, officeSessions, remoteUrlOf } = await import('../board/serve.mjs')
  const home = mkdtempSync(join(tmpdir(), 'oa-lead-'))
  const root = mkdtempSync(join(tmpdir(), 'oa-root-'))
  mkdirSync(join(home, '.claude', 'sessions'), { recursive: true })
  const reg = (pid, name, updatedAt, extra = {}) => writeFileSync(join(home, '.claude', 'sessions', pid + '.json'), JSON.stringify({ pid, name, cwd: root, updatedAt, ...extra }))
  reg(process.pid, 'root-dev-17', 9000, { bridgeSessionId: 'session_01Dev' })
  reg(process.ppid, 'Factory ERP', 1000)
  // without a declared name: the remote-controlled one, then recency
  assert.equal(liveSessions(home).get(root).name, 'root-dev-17')
  writeFileSync(join(root, 'office.json'), JSON.stringify({ lead: { session: 'Factory ERP' } }))
  assert.equal(officeSessions(root, home).get(root).name, 'Factory ERP', 'the declared name wins over newer and remote-controlled')
  assert.equal(remoteUrlOf({ bridgeSessionId: 'session_01Dev' }), 'https://claude.ai/code/session_01Dev')
  assert.equal(remoteUrlOf({ bridgeSessionId: 'javascript:alert(1)' }), null, 'only a well-formed id becomes a link')
  assert.equal(remoteUrlOf({}), null)
})

test('the roster carries state, detail and the Remote Control link per desk', async () => {
  const { chatRoster } = await import('../board/serve.mjs')
  const home = mkdtempSync(join(tmpdir(), 'oa-rost-'))
  const root = mkdtempSync(join(tmpdir(), 'oa-office-'))
  mkdirSync(join(root, 'desks', 'pricing'), { recursive: true })
  writeFileSync(join(root, 'desks', 'pricing', 'desk.json'), JSON.stringify({ name: 'pricing', kind: 'knowledge', port: 9240 }))
  mkdirSync(join(home, '.claude', 'sessions'), { recursive: true })
  writeFileSync(join(home, '.claude', 'sessions', process.pid + '.json'), JSON.stringify({ pid: process.pid, name: 'desk-pricing', cwd: join(root, 'desks', 'pricing'), status: 'shell', bridgeSessionId: 'session_01Abc' }))
  const row = chatRoster(root, { home }).find((r) => r.desk === 'pricing')
  assert.deepEqual([row.state, row.busy, row.online, row.sessionName], ['shell', true, true, 'desk-pricing'])
  assert.equal(row.remoteUrl, 'https://claude.ai/code/session_01Abc')
})
