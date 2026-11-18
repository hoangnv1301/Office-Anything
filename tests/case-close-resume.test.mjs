// A CLOSED CASE LEAVES NO TAB; THE NEXT WAKE RESUMES ITS OWN CONVERSATION; A LONG
// ONE STARTS FRESH WITH A DIGEST (0.30.0). Owner, 2026-11-18, with the Orca list:
// dozens of finished case entries 8-18 h old, one order 6 times: "are these
// sessions failed to auto close, it should be able to close then re-open
// afterward later on, if it's too long we should have a session that read old
// saved conversation". Every entry was a tab left at a shell prompt by a close;
// each order had one conversation, reopened many times.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openCase, closeCase, sweep, tidy, readCases, digestOf, strayCaseTabs, perCaseOf } from '../lib/cases.mjs'
import { projectDirOf } from '../lib/conversation.mjs'

const KEY = '^S[CO]-\\d{6}-\\d{3,}$'
const K = 'SO-261103-237'
const S1 = '00000000-0000-4000-8000-000000000001'
function office(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oa-ccr-'))
  mkdirSync(join(root, 'desks', 'design'), { recursive: true })
  writeFileSync(join(root, 'desks', 'design', 'desk.json'), JSON.stringify({ name: 'design', kind: 'knowledge', port: 9811, perCase: { kind: 'design-draw', key: KEY, max: 3, idleCloseMinutes: 10, adapter: 'node ../../adapter.mjs' } }))
  writeFileSync(join(root, 'office.json'), JSON.stringify({ roleEnv: 'OFFICE_ROLE', lead: { session: 'Office Lead' }, launch: { model: 'haiku' }, ...extra }))
  return root
}
function adapter(waiting = []) {
  const held = {}
  return (desk, pc, req) => {
    if (req.op === 'claim') { if (held[req.key] && held[req.key] !== req.session) return { ok: false, status: 409, holder: held[req.key] }; held[req.key] = req.session; return { ok: true } }
    if (req.op === 'release') { delete held[req.key]; return { ok: true } }
    if (req.op === 'heartbeat') return { lost: [] }
    if (req.op === 'open') return { cases: waiting }
    return { ok: true }
  }
}
// a terminal that records what it ran and closed; each tab it opens registers a live session running conversation `sid`
function term(live, { sid = S1, tabs = [] } = {}) {
  const t = {
    made: [], closed: [], tabs,
    titles: () => t.tabs, screen: () => '', answerImports: () => {},
    close: (h, o) => { t.closed.push({ h, tab: !!o?.tab }); t.tabs = t.tabs.filter((x) => x.handle !== h) },
    create: ({ title, command }) => { t.made.push({ title, command }); live.push({ pid: 7000 + t.made.length, name: title, status: 'idle', sessionId: sid, statusUpdatedAt: Date.now() }); return 'term_' + t.made.length },
  }
  return t
}
const conv = (root, dir, id, text) => { const p = projectDirOf(join(root, 'desks', 'design'), dir); mkdirSync(p, { recursive: true }); writeFileSync(join(p, `${id}.jsonl`), text); return join(p, `${id}.jsonl`) }
const line = (o) => JSON.stringify(o) + '\n'

test('one order woken twice is one session: the second wake resumes the case\'s own conversation (its kept id), and while it lives nothing new opens', async () => {
  const root = office(), live = [], dir = mkdtempSync(join(tmpdir(), 'oa-ccr-cl-'))
  const t = term(live)
  const o = { live: () => live, terminal: t, sleep: async () => {}, dir, kill: (pid) => { const i = live.findIndex((s) => s.pid === pid); if (i >= 0) live.splice(i, 1) }, adapter: adapter() }
  const r1 = await openCase(root, 'design', K, o)
  assert.equal(r1.state, 'up')
  assert.doesNotMatch(t.made[0].command, /--resume/, 'the first wake starts a conversation')
  assert.equal(readCases(root)[`design--${K}`].sessionId, S1, 'the conversation is kept per case')
  conv(root, dir, S1, line({ type: 'user', message: { content: 'start' } }))   // its transcript (no name record in it)
  assert.equal((await openCase(root, 'design', K, o)).state, 'already', 'a second wake while it lives opens nothing')
  assert.equal(t.made.length, 1)
  closeCase(root, 'design', K, 'idle 10 min', o)
  const r2 = await openCase(root, 'design', K, o)
  assert.equal(r2.state, 'up')
  assert.equal(t.made.length, 2)
  assert.match(t.made[1].command, new RegExp(`--resume ${S1}`), 'the next wake resumes the same conversation')
  assert.match(t.made[1].command, /Your case brief may have changed/)
  assert.equal(live.filter((s) => s.name === `desk-design--${K}`).length, 1, 'never a second live session for one case')
})

test('a done case is closed with its whole tab; a case tab nobody is in is closed by the next sweep; a tab with a claude in it, a live one or a fresh one is never touched', async () => {
  const root = office()
  const live = [{ pid: 51, name: `desk-design--${K}`, status: 'idle', sessionId: S1 }]
  const t = term(live, { tabs: [{ handle: 'term_k', title: `desk-design--${K}`, agent: true, quietMs: 0 }] })
  const o = { live: () => live, terminal: t, sleep: async () => {}, dir: mkdtempSync(join(tmpdir(), 'oa-ccr-cl-')), kill: (pid) => { const i = live.findIndex((s) => s.pid === pid); if (i >= 0) live.splice(i, 1) }, adapter: adapter(), procs: () => new Map() }
  const c = closeCase(root, 'design', K, 'idle 10 min', o)
  assert.deepEqual(t.closed, [{ h: 'term_k', tab: true }], 'the whole tab, not only its pane')
  assert.match(c.why, /tab: closed 1 tab/)
  // the leftovers of earlier closes
  t.closed = []
  t.tabs = [
    { handle: 'old1', title: 'desk-design--SO-261015-156', agent: false, quietMs: 600 * 60_000 },
    { handle: 'old2', title: 'desk-design--SO-261015-156', agent: false, quietMs: 30 * 60_000 },
    { handle: 'busy', title: 'desk-design--SO-261116-287', agent: true, quietMs: 600 * 60_000 },
    { handle: 'just', title: 'desk-design--SO-261117-299', agent: false, quietMs: 30_000 },
    { handle: 'livetab', title: 'desk-design--SO-261117-300', agent: false, quietMs: 600 * 60_000 },
    { handle: 'parent', title: 'desk-design', agent: false, quietMs: 600 * 60_000 },
    { handle: 'unsure', title: 'desk-design--SO-261117-301', agent: false, quietMs: null },
  ]
  live.push({ pid: 90, name: 'desk-design--SO-261117-300', status: 'busy', sessionId: 'x' })
  const acts = await sweep(root, o)
  assert.deepEqual(t.closed.map((x) => x.h).sort(), ['old1', 'old2'])
  assert.ok(t.closed.every((x) => x.tab))
  assert.equal(acts.filter((a) => a.act === 'stray-tab').length, 2)
})

test('a long saved conversation is not reloaded: the case starts fresh with a digest of it in its brief', async () => {
  const root = office({ cases: { freshOverKB: 64 } }), live = [], dir = mkdtempSync(join(tmpdir(), 'oa-ccr-cl-'))
  const pad = line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'x'.repeat(900) } }] } })
  conv(root, dir, S1, line({ type: 'user', message: { content: 'Read your case brief and start on case SO-261103-237.' } }) + pad.repeat(90)
    + line({ type: 'user', message: { content: 'The buyer wants the island at 96 in, not 84.' } })
    + line({ type: 'user', message: { content: [{ type: 'tool_result', content: 'secret tool output' }] } })
    + line({ type: 'user', message: { content: '<task-notification>doorbell</task-notification>' } })
    + line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Saved kitchen v4 with the 96 in island; handed to quotation.' }] } }))
  mkdirSync(join(root, '.office'), { recursive: true })
  writeFileSync(join(root, '.office', 'cases.json'), JSON.stringify({ [`design--${K}`]: { sessionId: S1, closedAt: '2026-11-18T03:41:29Z' } }))
  const t = term(live, { sid: '00000000-0000-4000-8000-000000000002' })
  const r = await openCase(root, 'design', K, { live: () => live, terminal: t, sleep: async () => {}, dir, kill: () => {}, adapter: adapter([{ key: K, brief: 'Draw the kitchen.' }]) })
  assert.equal(r.state, 'up')
  assert.doesNotMatch(t.made[0].command, /--resume/, 'not resumed')
  assert.match(t.made[0].command, /Read your case brief/)
  assert.match(r.why, /fresh: .* KB; digest in the brief/)
  const brief = readFileSync(join(root, '.office', 'cases', `design--${K}.md`), 'utf8')
  assert.match(brief, /Draw the kitchen\./)
  assert.match(brief, /Where the last session on this case left off/)
  assert.match(brief, /island at 96 in/)
  assert.match(brief, /Saved kitchen v4 with the 96 in island/)
  assert.doesNotMatch(brief, /secret tool output|task-notification/, 'tool output and notices stay out')
  const st = readCases(root)[`design--${K}`]
  assert.equal(st.freshFrom, S1)
  assert.equal(st.sessionId, '00000000-0000-4000-8000-000000000002', 'the new conversation is the one kept now')
})

test('tidy: lists the leftovers and closes them only with --apply; a session mid-turn is never listed', () => {
  const root = office()
  const live = [{ pid: 60, name: 'desk-design--SO-261116-287', status: 'busy', sessionId: 'y' }]
  const t = term(live, { tabs: [{ handle: 'old', title: 'desk-design--SO-261015-156', agent: false, quietMs: 700 * 60_000 }] })
  const o = { live: () => live, terminal: t, procs: () => new Map(), now: () => Date.now(), dir: mkdtempSync(join(tmpdir(), 'oa-ccr-cl-')), kill: () => assert.fail('nothing mid-turn is stopped'), adapter: adapter() }
  const dry = tidy(root, o)
  assert.deepEqual(dry.map((x) => `${x.what}:${x.name}:${x.done ?? '-'}`), ['tab:desk-design--SO-261015-156:-'])
  assert.equal(t.closed.length, 0, 'a look changes nothing')
  const done = tidy(root, { ...o, apply: true })
  assert.equal(done[0].done, 'closed')
  assert.deepEqual(t.closed, [{ h: 'old', tab: true }])
})

test('the digest keeps the newest asks and answers within its size, oldest first, and nothing else', () => {
  const root = office(), dir = mkdtempSync(join(tmpdir(), 'oa-ccr-cl-'))
  let text = ''
  for (let i = 1; i <= 40; i++) text += line({ type: 'user', message: { content: `ask number ${i} ${'x'.repeat(80)}` } }) + line({ type: 'assistant', message: { content: [{ type: 'text', text: `answer number ${i}` }] } })
  const d = digestOf(conv(root, dir, S1, text), { maxChars: 600 })
  assert.ok(d.length <= 600)
  assert.match(d, /answer number 40$/)
  assert.doesNotMatch(d, /ask number 1 /)
  const lines = d.split('\n')
  assert.ok(lines.indexOf(lines.find((l) => /ask number 40/.test(l))) < lines.indexOf(lines.find((l) => /answer number 40/.test(l))), 'oldest first')
  const pc = perCaseOf({ name: 'design', session: 'desk-design', names: ['desk-design'], perCase: { kind: 'k', key: KEY } })
  assert.deepEqual(strayCaseTabs({ session: 'desk-design', names: ['desk-design'] }, pc, [{ handle: 'h', title: 'desk-design--not-a-key', agent: false, quietMs: 1e9 }], []), [], 'a title that is not one of its case keys is not its case')
})
