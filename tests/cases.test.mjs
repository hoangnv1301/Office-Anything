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
