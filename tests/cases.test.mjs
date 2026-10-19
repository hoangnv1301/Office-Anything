// PER-CASE CHILD SESSIONS (0.9.0). A fake office: a desk declaring perCase,
// a fake adapter that answers as the frozen contract says, a registry the test
// controls and a terminal that records what it was asked to run.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openCase, closeCase, forceRelease, sweep, route, list, perCaseOf, childName } from '../lib/cases.mjs'

const KEY = '^SC-\\d{6}-\\d{3,}$'
function office({ max = 3, idleCloseMinutes = 60 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oa-cases-'))
  mkdirSync(join(root, 'desks', 'design'), { recursive: true })
  writeFileSync(join(root, 'desks', 'design', 'desk.json'), JSON.stringify({ name: 'design', kind: 'knowledge', port: 9801, perCase: { kind: 'design-job', key: KEY, max, idleCloseMinutes, adapter: 'node ../../adapter.mjs' } }))
  mkdirSync(join(root, 'desks', 'ledger'), { recursive: true })
  writeFileSync(join(root, 'desks', 'ledger', 'desk.json'), JSON.stringify({ name: 'ledger', kind: 'knowledge', port: 9802 }))
  writeFileSync(join(root, 'office.json'), JSON.stringify({ roleEnv: 'OFFICE_ROLE', lead: { session: 'Office Lead' }, launch: { model: 'haiku' } }))
  return root
}
// the book: who holds which case
function fakeAdapter({ held = {}, waiting = [], fail = new Set() } = {}) {
  const calls = []
  const fn = (desk, pc, req) => {
    calls.push(req)
    if (fail.has(req.op)) throw new Error(`the design-job adapter failed on ${req.op}; that is UNKNOWN, not a grant`)
    if (req.op === 'claim') { if (held[req.key] && held[req.key] !== req.session) return { ok: false, status: 409, holder: held[req.key] }; held[req.key] = req.session; return { ok: true } }
    if (req.op === 'release') { if (held[req.key] === req.session) delete held[req.key]; return { ok: true } }
    if (req.op === 'heartbeat') return { lost: req.claims.filter((c) => held[c.key] !== c.session).map((c) => ({ key: c.key, holder: held[c.key] ?? null })) }
    if (req.op === 'forceRelease') { if (!req.said) return { ok: false, status: 400 }; const was = held[req.key] ?? null; delete held[req.key]; return { ok: true, was } }
    if (req.op === 'open') return { cases: waiting }
    throw new Error('unknown op')
  }
  return { fn, calls, held }
}
function fakeTerm(live, { register = true } = {}) {
  const made = []
  return {
    made, titles: () => [], screen: () => '', answerImports: () => {},
    create: ({ title, command }) => { made.push({ title, command }); if (register) live.push({ pid: 7000 + made.length, name: title, status: 'idle', sessionId: `00000000-0000-4000-8000-${String(made.length).padStart(12, '0')}`, statusUpdatedAt: Date.now() }); return 'term_' + made.length },
  }
}
const run = (root, live, extra = {}) => ({ live: () => live, terminal: fakeTerm(live), sleep: async () => {}, dir: mkdtempSync(join(tmpdir(), 'oa-cl-')), kill: () => {}, ...extra })

test('a case opens as desk-<parent>--<key>: claimed first, in the parent\'s folder, under the parent\'s role, with its brief', async () => {
  const root = office(); const live = []; const a = fakeAdapter({ waiting: [{ key: 'SC-261009-137', title: 'West kitchen', brief: 'Order SC-261009-137 for West: mirror the island, keep the pantry.' }] })
  const o = run(root, live, { adapter: a.fn })
  const r = await openCase(root, 'design', 'SC-261009-137', o)
  assert.equal(r.state, 'up')
  assert.equal(r.tag, 'desk-design--SC-261009-137')
  assert.equal(a.held['SC-261009-137'], 'desk-design--SC-261009-137', 'the book holds the claim for the child')
  assert.equal(a.calls[0].op, 'claim', 'the claim comes before anything opens')
  const cmd = o.terminal.made[0].command
  assert.match(cmd, new RegExp(`^cd '${join(root, 'desks', 'design')}' && OFFICE_ROLE='desk-design' claude --name 'desk-design--SC-261009-137' --model haiku`), 'parent folder, parent role, child name')
  assert.match(cmd, /'Read your case brief at .*design--SC-261009-137\.md and start on case SC-261009-137\.'$/)
  const brief = readFileSync(join(root, '.office', 'cases', 'design--SC-261009-137.md'), 'utf8')
  assert.match(brief, /mirror the island/)
  assert.match(brief, /anything else goes to desk-design/)
})

test('a case another session holds is refused with its holder, and nothing opens', async () => {
  const root = office(); const live = []; const a = fakeAdapter({ held: { 'SC-261009-137': 'desk-design--SC-261009-137-old' } })
  const o = run(root, live, { adapter: a.fn })
  const r = await openCase(root, 'design', 'SC-261009-137', o)
  assert.equal(r.state, 'refused')
  assert.match(r.why, /held by desk-design--SC-261009-137-old/)
  assert.equal(o.terminal.made.length, 0)
})

test('an adapter that fails is UNKNOWN, never a grant', async () => {
  const root = office(); const live = []; const a = fakeAdapter({ fail: new Set(['claim']) })
  const o = run(root, live, { adapter: a.fn })
  const r = await openCase(root, 'design', 'SC-261009-137', o)
  assert.equal(r.state, 'unknown')
  assert.equal(o.terminal.made.length, 0)
})

test('the duplicate guard is per (parent, key); the cap holds; a bad key or a desk without perCase is refused', async () => {
  const root = office({ max: 2 })
  const live = [{ pid: 1, name: 'desk-design--SC-261009-001', status: 'idle' }, { pid: 2, name: 'desk-design--SC-261009-001', status: 'idle' }]
  const a = fakeAdapter()
  assert.equal((await openCase(root, 'design', 'SC-261009-001', run(root, live, { adapter: a.fn }))).state, 'clash')
  live.pop(); live.push({ pid: 3, name: 'desk-design--SC-261009-002', status: 'idle' })
  const r = await openCase(root, 'design', 'SC-261009-003', run(root, live, { adapter: a.fn }))
  assert.equal(r.state, 'cap')
  assert.match(r.why, /2 case session\(s\) of 2/)
  assert.equal(a.calls.length, 0, 'over the cap nothing is claimed')
  assert.equal((await openCase(root, 'design', 'SC-1', run(root, [], { adapter: a.fn }))).state, 'refused')
  assert.equal((await openCase(root, 'design', 'SC-261009-001--x', run(root, [], { adapter: a.fn }))).state, 'refused')
  assert.equal((await openCase(root, 'ledger', 'SC-261009-001', run(root, [], { adapter: a.fn }))).state, 'refused')
})

test('a session that never comes up gives its claim back', async () => {
  const root = office(); writeFileSync(join(root, 'office.json'), JSON.stringify({ roleEnv: 'OFFICE_ROLE', launch: { waitSec: 2 } }))
  const live = []; const a = fakeAdapter(); let clock = 0
  const o = run(root, live, { adapter: a.fn, terminal: fakeTerm(live, { register: false }), now: () => (clock += 1000), procs: () => new Map() })
  const r = await openCase(root, 'design', 'SC-261009-137', o)
  assert.equal(r.state, 'failed')
  assert.equal(a.held['SC-261009-137'], undefined, 'released')
})

test('close stops the session and releases; force-release needs the human\'s words', async () => {
  const root = office(); const live = [{ pid: 4242, name: 'desk-design--SC-261009-137', status: 'idle' }]
  const a = fakeAdapter({ held: { 'SC-261009-137': 'desk-design--SC-261009-137' } }); const killed = []
  const r = closeCase(root, 'design', 'SC-261009-137', 'done', run(root, live, { adapter: a.fn, kill: (p) => killed.push(p) }))
  assert.deepEqual(killed, [4242])
  assert.equal(a.held['SC-261009-137'], undefined)
  assert.match(r.why, /stopped pid 4242/)
  a.held['SC-261009-200'] = 'desk-design--SC-261009-200'
  assert.equal(forceRelease(root, 'design', 'SC-261009-200', { by: 'lead' }, run(root, [], { adapter: a.fn })).state, 'refused')
  assert.equal(forceRelease(root, 'design', 'SC-261009-200', { by: 'lead', said: 'the owner: take it back' }, run(root, [], { adapter: a.fn })).state, 'released')
})

test('the sweep: a lost claim closes its session, the idle close, waiting cases open up to the cap', async () => {
  const root = office({ max: 2, idleCloseMinutes: 60 })
  const now = Date.now()
  const live = [
    { pid: 11, name: 'desk-design--SC-261009-001', status: 'busy', statusUpdatedAt: now },
    { pid: 12, name: 'desk-design--SC-261009-002', status: 'idle', statusUpdatedAt: now - 61 * 60_000 },
  ]
  const a = fakeAdapter({ held: { 'SC-261009-001': 'someone-else', 'SC-261009-002': 'desk-design--SC-261009-002' }, waiting: [{ key: 'SC-261009-010', brief: 'b10' }, { key: 'SC-261009-011', brief: 'b11' }, { key: 'SC-261009-012', brief: 'b12' }] })
  const killed = []
  const o = run(root, live, { adapter: a.fn, kill: (p) => { killed.push(p); const i = live.findIndex((s) => s.pid === p); if (i >= 0) live.splice(i, 1) }, now: () => now })
  const acts = await sweep(root, o)
  const by = (act) => acts.filter((x) => x.act === act).map((x) => x.key)
  assert.deepEqual(by('lost'), ['SC-261009-001'])
  assert.deepEqual(by('idle-close'), ['SC-261009-002'])
  assert.deepEqual(killed.sort(), [11, 12])
  assert.deepEqual(by('open'), ['SC-261009-010', 'SC-261009-011'])
  assert.deepEqual(by('queued'), ['SC-261009-012'], 'over the cap the case stays with the parent')
})

test('route: a message naming a case goes to its live session, else to the parent; a case-less one stays put', () => {
  const root = office()
  const live = [{ pid: 1, name: 'desk-design--SC-261009-137', status: 'idle' }]
  assert.equal(route(root, 'update on SC-261009-137: the customer wants oak', run(root, live)).to, 'desk-design--SC-261009-137')
  assert.equal(route(root, 'SC-261009-136 is waiting', run(root, live)).to, 'desk-design')
  assert.equal(route(root, 'how is the week looking?', run(root, live)).to, null)
  assert.deepEqual(list(root, run(root, live))[0].children.map((c) => c.name), ['desk-design--SC-261009-137'])
})

test('perCase is checked at load: a key that could nest or walk out is refused', () => {
  const d = (key) => ({ name: 'x', perCase: { kind: 'k', key, adapter: 'a' } })
  assert.throws(() => perCaseOf(d('.*')), /must not match/)
  assert.throws(() => perCaseOf(d('[a-z/]+')), /must not match "a\/b"/)
  assert.throws(() => perCaseOf(d('(')), /does not compile/)
  assert.equal(perCaseOf(d(KEY)).max, 3)
  assert.equal(childName('design', 'SC-1'), 'desk-design--SC-1')
})

test('a case session boots knowing its case and its brief; the parent boots as before', async () => {
  const { bootLines } = await import('../hooks/desk-boot.mjs')
  const root = office()
  const who = { kind: 'desk', desk: 'design', dir: join(root, 'desks', 'design') }
  const parent = bootLines(root, who, { boot: {} }, who.dir)
  assert.ok(!parent.some((l) => /case session/.test(l)))
  const child = bootLines(root, { ...who, caseKey: 'SC-261009-137' }, { boot: {} }, who.dir)
  assert.match(child[1], /case session for SC-261009-137\. Your brief: \.office\/cases\/design--SC-261009-137\.md/)
  assert.match(child[1], /goes to desk-design by SendMessage/)
})

test('perCase without an adapter is naming only: the office runs those sessions itself, and core leaves them alone', async () => {
  const root = office()
  mkdirSync(join(root, 'desks', 'support'), { recursive: true })
  writeFileSync(join(root, 'desks', 'support', 'desk.json'), JSON.stringify({ name: 'support', kind: 'knowledge', port: 9803, perCase: { kind: 'thread', key: '^BT-\\d{6}-\\d{3,}$' } }))
  const rows = list(root, run(root, [{ pid: 9, name: 'desk-support--BT-261002-384', status: 'idle' }]))
  const s = rows.find((r) => r.desk === 'support')
  assert.equal(s.error, undefined, 'not an error')
  assert.equal(s.managed, 'office')
  assert.deepEqual(s.children.map((c) => c.name), ['desk-support--BT-261002-384'])
  const r = await openCase(root, 'support', 'BT-261002-384', run(root, [], { adapter: () => { throw new Error('must not be called') } }))
  assert.equal(r.state, 'refused')
  assert.match(r.why, /no adapter.*office runs these sessions itself/)
  const acts = await sweep(root, run(root, [], { adapter: (d) => { if (d.name === 'support') throw new Error('must not be called'); return { lost: [], cases: [] } } }))
  assert.ok(!acts.some((a) => a.desk === 'support'))
})

// ⛔ TWO WRITERS ON ONE CASE (2026-10-19: two live copies of one buyer thread).
// openCase refused to add a third, but nothing ever closed the second: the
// sweep keeps the most recently active and stops the others by their own pid,
// never by name (a name kill takes the one it meant to keep with it). The
// claim stays: the kept session carries the same name and holds it.
test('the sweep closes a duplicate case session by pid, keeps the most recently active, and keeps the claim', async () => {
  const root = office()
  const now = Date.now()
  const live = [
    { pid: 21, name: 'desk-design--SC-261009-001', status: 'idle', statusUpdatedAt: now - 5 * 60_000, updatedAt: now - 5 * 60_000 },
    { pid: 22, name: 'desk-design--SC-261009-001', status: 'busy', statusUpdatedAt: now, updatedAt: now },
  ]
  const a = fakeAdapter({ held: { 'SC-261009-001': 'desk-design--SC-261009-001' } })
  const killed = []
  const o = run(root, live, { adapter: a.fn, kill: (p) => { killed.push(p); const i = live.findIndex((s) => s.pid === p); if (i >= 0) live.splice(i, 1) }, now: () => now })
  const acts = await sweep(root, o)
  const d = acts.filter((x) => x.act === 'duplicate-close')
  assert.equal(d.length, 1)
  assert.equal(d[0].key, 'SC-261009-001')
  assert.match(d[0].why, /stopped pid 21.*kept pid 22/)
  assert.deepEqual(killed, [21], 'only the extra one, by its pid')
  assert.equal(a.held['SC-261009-001'], 'desk-design--SC-261009-001', 'the claim stays with the kept session')
  assert.ok(!a.calls.some((c) => c.op === 'release'), 'nothing is released')
})

// ⛔ A DOORBELL IS IDLE (2026-10-19). A session parked in a foreground doorbell
// reads "shell" in the registry, never "idle", and statusUpdatedAt restarts on
// every re-arm: ~14 buyer sessions sat open for an hour and more. Parked =
// "idle", or "shell" with the process tree proving the shell is the desk's own
// doorbell. Its clock is the transcript's last work: a prompt, or a tool call
// that is not the doorbell. Anything it cannot prove stays open.
function bellOffice() {
  const root = office({ idleCloseMinutes: 60 })
  const dj = join(root, 'desks', 'design', 'desk.json')
  writeFileSync(dj, JSON.stringify({ ...JSON.parse(readFileSync(dj, 'utf8')), wake: 'node ../../bell.mjs' }))
  return root
}
const bellCall = (id, ts) => [
  { type: 'assistant', timestamp: new Date(ts).toISOString(), message: { content: [{ type: 'text', text: 'nothing new; re-arming' }, { type: 'tool_use', id, name: 'Bash', input: { command: 'node ../../bell.mjs --t 300' } }] } },
  { type: 'user', timestamp: new Date(ts + 1000).toISOString(), message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'timeout' }] } },
]
function transcript(dir, root, sessionId, entries) {
  const p = join(dir, 'projects', join(root, 'desks', 'design').replace(/[^A-Za-z0-9]/g, '-'))
  mkdirSync(p, { recursive: true })
  writeFileSync(join(p, sessionId + '.jsonl'), entries.map((e) => JSON.stringify(e)).join('\n') + '\n')
}
async function parked({ workAgo, bell = true, write = true }) {
  const root = bellOffice()
  const now = Date.now()
  const sid = '00000000-0000-4000-8000-0000000000aa'
  const live = [{ pid: 31, name: 'desk-design--SC-261009-031', status: 'shell', statusUpdatedAt: now - 60_000, sessionId: sid, cwd: join(root, 'desks', 'design') }]
  const procs = new Map([[31, { pid: 31, ppid: 1, ageSec: 7200, cmd: 'claude --name desk-design--SC-261009-031' }], [32, { pid: 32, ppid: 31, ageSec: 60, cmd: '/bin/zsh -c node ../../bell.mjs --t 300' }]])
  if (bell) procs.set(33, { pid: 33, ppid: 32, ageSec: 60, cmd: 'node ../../bell.mjs --t 300' })
  else procs.set(33, { pid: 33, ppid: 32, ageSec: 60, cmd: 'node render-kitchen.mjs' })
  const a = fakeAdapter({ held: { 'SC-261009-031': 'desk-design--SC-261009-031' } })
  const o = run(root, live, { adapter: a.fn, procs: () => procs, now: () => now, kill: (p) => { const i = live.findIndex((s) => s.pid === p); if (i >= 0) live.splice(i, 1) } })
  if (write) transcript(o.dir, root, sid, [
    { type: 'user', timestamp: new Date(now - workAgo - 5000).toISOString(), message: { content: 'Read your case brief and start on case SC-261009-031.' } },
    { type: 'assistant', timestamp: new Date(now - workAgo).toISOString(), message: { content: [{ type: 'tool_use', id: 'w1', name: 'Write', input: { file_path: 'x' } }] } },
    ...bellCall('b1', now - 30 * 60_000), ...bellCall('b2', now - 5 * 60_000), ...bellCall('b3', now - 60_000),
  ])
  return (await sweep(root, o)).filter((x) => x.act === 'idle-close')
}

test('a session parked in its doorbell, with no work for idleCloseMinutes, is idle-closed', async () => {
  const c = await parked({ workAgo: 70 * 60_000 })
  assert.equal(c.length, 1, 'shell + its own doorbell + 70 min since the last work')
  assert.match(c[0].why, /idle 70 min/)
})

test('a doorbell session with recent work, a shell that is not the doorbell, or no transcript stays open', async () => {
  assert.equal((await parked({ workAgo: 20 * 60_000 })).length, 0, 'worked 20 min ago; the re-arms after it are not work')
  assert.equal((await parked({ workAgo: 70 * 60_000, bell: false })).length, 0, 'a long command in the shell is work')
  assert.equal((await parked({ workAgo: 70 * 60_000, write: false })).length, 0, 'no transcript: cannot prove idle')
})
