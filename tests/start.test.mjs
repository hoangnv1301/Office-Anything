// START AND RECOVER (0.8.0). A fake world: a registry the test controls, real
// transcript files with the CLI's own name records, and a terminal adapter
// that records what it was asked to run. Nothing real is launched.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { start, recover, launchCommand, targetsOf, exitCodeOf } from '../lib/start.mjs'
import { ownConversation, projectDirOf, checkStarted } from '../lib/conversation.mjs'

const ID = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
const L = (o) => JSON.stringify(o) + '\n'

function world({ cfg = {}, desks = { quotes: {}, ledger: {} } } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oa-start-'))
  for (const [n, extra] of Object.entries(desks)) {
    mkdirSync(join(root, 'desks', n), { recursive: true })
    writeFileSync(join(root, 'desks', n, 'desk.json'), JSON.stringify({ name: n, kind: 'knowledge', port: 9600 + n.length, ...extra }))
  }
  writeFileSync(join(root, 'office.json'), JSON.stringify({ roleEnv: 'OFFICE_ROLE', lead: { session: 'Office Lead' }, ...cfg }))
  const dir = mkdtempSync(join(tmpdir(), 'oa-claude-'))
  return { root, dir }
}
// a transcript recording the names it ran under, oldest first; mtime sets "newest"
function convo(dir, cwd, id, names, ageSec) {
  const p = projectDirOf(cwd, dir)
  mkdirSync(p, { recursive: true })
  const f = join(p, id + '.jsonl')
  writeFileSync(f, names.map((n, i) => L(i % 2 ? { type: 'agent-name', agentName: n } : { type: 'custom-title', customTitle: n })).join('') + L({ type: 'user', message: { content: 'hi' } }))
  const t = new Date(Date.now() - ageSec * 1000); utimesSync(f, t, t)
}
// the terminal: create() registers an idle session named by the title, as the CLI would
function fakeTerm(live, { register = true, sessionIdOf = () => ID(99) } = {}) {
  const made = []
  return {
    made,
    titles: () => [],
    create: ({ title, command }) => { made.push({ title, command }); if (register) live.push({ pid: 5000 + made.length, name: title, status: 'idle', sessionId: (command.match(/--resume (\S+)/) ?? [])[1] ?? sessionIdOf(title), cwd: null }); return 'term_' + made.length },
    screen: () => '',
    answerImports: () => {},
  }
}
const opts = (w, live, term, extra = {}) => ({ live: () => live, terminal: term, sleep: async () => {}, dir: w.dir, ...extra })

test('⛔ a desk resumes its OWN conversation by id, never the newest one a case session left in its folder', async () => {
  const w = world()
  const cwd = join(w.root, 'desks', 'quotes')
  convo(w.dir, cwd, ID(1), ['desk-quotes'], 600)                           // its own, older
  convo(w.dir, cwd, ID(2), ['desk-quotes--J-100'], 60)                     // a case session's, newest
  convo(w.dir, cwd, ID(3), ['desk-quotes--J-100', 'desk-quotes'], 30)     // a case resumed under the parent's name
  const live = [], term = fakeTerm(live)
  const rows = await start(w.root, 'quotes', opts(w, live, term))
  assert.equal(rows[0].state, 'up')
  assert.equal(rows[0].resume, ID(1))
  assert.match(term.made[0].command, new RegExp(`--resume ${ID(1)}$`))
  assert.doesNotMatch(term.made[0].command, /--continue/)
})

test('no own conversation = a fresh one, and why; --fresh forces it', async () => {
  const w = world()
  convo(w.dir, join(w.root, 'desks', 'quotes'), ID(2), ['desk-quotes--J-100'], 60)
  let live = [], term = fakeTerm(live)
  let rows = await start(w.root, 'quotes', opts(w, live, term))
  assert.equal(rows[0].resume, null)
  assert.match(rows[0].why, /new conversation/)
  convo(w.dir, join(w.root, 'desks', 'ledger'), ID(4), ['desk-ledger'], 60)
  live = []; term = fakeTerm(live)
  rows = await start(w.root, 'ledger', opts(w, live, term, { fresh: true }))
  assert.equal(rows[0].resume, null)
  assert.doesNotMatch(term.made[0].command, /--resume/)
})

test('the duplicate guard: two live sessions under one name open nothing and fail', async () => {
  const w = world()
  const live = [{ pid: 1, name: 'desk-quotes', status: 'idle' }, { pid: 2, name: 'desk-quotes', status: 'idle' }]
  const term = fakeTerm(live)
  const rows = await start(w.root, 'quotes', opts(w, live, term))
  assert.equal(rows[0].state, 'clash')
  assert.equal(term.made.length, 0)
  assert.equal(exitCodeOf(rows), 4)
  assert.equal(checkStarted({ tag: 'desk-quotes', live }).state, 'clash')
})

test('a live desk is reported, not restarted: degraded at the wrong folder, foreign when running another\'s conversation', async () => {
  const w = world()
  convo(w.dir, w.root, ID(7), ['desk-quotes--J-1', 'desk-quotes'], 10)
  const live = [
    { pid: 3, name: 'desk-quotes', status: 'idle', cwd: w.root, sessionId: ID(8) },
    { pid: 4, name: 'desk-ledger', status: 'idle', cwd: w.root, sessionId: ID(7) },
  ]
  const term = fakeTerm(live)
  const rows = await start(w.root, 'all', opts(w, live, term))
  const by = Object.fromEntries(rows.map((r) => [r.target, r]))
  assert.equal(by.quotes.state, 'degraded')
  assert.equal(by.ledger.state, 'foreign')
  assert.equal(term.made.length, 0, 'a live desk is never closed or doubled by a start')
})

test('all skips autostart:false; everything starts the lead first, at the root, with its own flags', async () => {
  const w = world({ desks: { quotes: {}, shadow: { autostart: false } }, cfg: { launch: { flags: ['--dangerously-skip-permissions'], model: 'sonnet', lead: { flags: ['--remote-control'] } } } })
  assert.deepEqual(targetsOf(w.root, { lead: { session: 'Office Lead' } }, 'all').map((t) => t.name), ['quotes'])
  const live = [], term = fakeTerm(live)
  await recover(w.root, opts(w, live, term))
  assert.deepEqual(term.made.map((m) => m.title), ['Office Lead', 'desk-quotes'], 'the lead first, then the desks')
  assert.equal(term.made[0].command, "OFFICE_ROLE='Office Lead' claude --name 'Office Lead' --model sonnet --dangerously-skip-permissions --remote-control")
  assert.equal(term.made[1].command, "cd 'desks/quotes' && OFFICE_ROLE='desk-quotes' claude --name 'desk-quotes' --model sonnet --dangerously-skip-permissions")
})

test('a start that never registers, or registers but never idles, is reported as such and fails', async () => {
  const w = world({ cfg: { launch: { waitSec: 3 } } })
  let clock = 0
  const live = [], term = fakeTerm(live, { register: false })
  const rows = await start(w.root, 'quotes', opts(w, live, term, { now: () => (clock += 1000) }))
  assert.equal(rows[0].state, 'failed')
  assert.match(rows[0].why, /no session named desk-quotes registered within 3s/)
})

test('launch settings are checked: no shell in a flag, a model or a session id', () => {
  const t = { name: 'quotes', tag: 'desk-quotes', isLead: false }
  assert.throws(() => launchCommand({ cfg: { launch: { flags: ['--x; rm -rf ~'] } }, target: t }), /not a plain --flag/)
  assert.throws(() => launchCommand({ cfg: { launch: { model: 'sonnet && curl x' } }, target: t }), /not a model name/)
  assert.throws(() => launchCommand({ cfg: {}, target: t, resume: '../x' }), /bad session id/)
})

test('ownConversation skips one a live session has open', () => {
  const w = world()
  const cwd = join(w.root, 'desks', 'quotes')
  convo(w.dir, cwd, ID(1), ['desk-quotes'], 600)
  convo(w.dir, cwd, ID(2), ['desk-quotes'], 60)
  const o = ownConversation({ tag: 'desk-quotes', cwd, dir: w.dir, liveIds: new Set([ID(2)]) })
  assert.equal(o.id, ID(1))
  assert.match(o.skipped[0].why, /open in a live session/)
})
