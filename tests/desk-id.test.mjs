// ⛔ ID AND NAME ARE TWO THINGS (0.11.0). The owner, after a rename took ten
// minutes and "a ton of testing" and still did not work: a name lives in one
// place and nothing copies it. The id is the folder and never changes; the name
// is desk.json "name", the session name, and the one field a rename edits.
//
// Every desk an office had before this had id == name, so a site that still
// read the wrong one passed every other test. This office has a desk whose
// folder (dashboard) is not its name (ops-dashboard), and a per-case desk whose
// folder (rfq) is not its name (quotes), and drives each path through them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rosterSafe, deskOfSession, readDesk } from '../lib/desk.mjs'
import { whoIs, childOf } from '../lib/office.mjs'
import { targetsOf, start } from '../lib/start.mjs'
import { readSwitch, deskOn, setDesk, listDesks, deskWork } from '../lib/desks.mjs'
import { openCase, closeCase, route, readCases } from '../lib/cases.mjs'
import { compileWall, judge } from '../lib/wall.mjs'
import { officeHealth, sessionDuplicates } from '../lib/health.mjs'
import { heal } from '../lib/heal.mjs'
import { watch } from '../lib/desk-watch.mjs'
import { bootLines } from '../hooks/desk-boot.mjs'
import { projectDirOf } from '../lib/conversation.mjs'
import { hire } from '../lib/hire.mjs'

const NOW = Date.now()
const MIN = 60_000
const KEY = '^RFQ-\\d+$'
function office({ cfg = {}, work = '' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oa-id-'))
  const home = mkdtempSync(join(tmpdir(), 'oa-id-home-'))
  mkdirSync(join(home, '.claude', 'sessions'), { recursive: true })
  const desk = (id, j) => { mkdirSync(join(root, 'desks', id), { recursive: true }); writeFileSync(join(root, 'desks', id, 'desk.json'), JSON.stringify(j)) }
  desk('dashboard', { name: 'ops-dashboard', kind: 'knowledge', port: 9501, description: 'Dashboard desk: the three numbers' })
  desk('inventory', { name: 'inventory', kind: 'knowledge', port: 9502 })
  desk('rfq', { name: 'quotes', kind: 'knowledge', port: 9503, autostart: false, perCase: { kind: 'rfq', key: KEY, max: 2, adapter: 'true' } })
  writeFileSync(join(root, 'work.txt'), work)
  writeFileSync(join(root, 'office.json'), JSON.stringify({ roleEnv: 'OFFICE_ROLE', start: 'echo {desk} >> started.txt', openWork: 'cat work.txt', closeWhenIdle: { dashboard: 30 }, lead: { session: 'Office Lead' }, boot: {}, ...cfg }))
  const procs = new Map([[1, { pid: 1, ppid: 0, ageSec: 1e6, cmd: 'launchd' }]])
  const sessions = []
  const live = (id, name, { pid = 700, idleMin = 40, status = 'idle' } = {}) => {
    const cwd = join(root, 'desks', id)
    const s = { pid, name, cwd, sessionId: `00000000-0000-4000-8000-00000000${pid}`, status, statusUpdatedAt: NOW - idleMin * MIN, startedAt: NOW - 7200_000 }
    writeFileSync(join(home, '.claude', 'sessions', `${pid}.json`), JSON.stringify(s))
    procs.set(pid, { pid, ppid: 1, ageSec: 7200, cmd: `claude --name ${name}` })
    transcript(id, s.sessionId, name, NOW - idleMin * MIN)
    sessions.push(s)
    return s
  }
  const transcript = (id, sid, name, at) => {
    const p = projectDirOf(join(root, 'desks', id), join(home, '.claude'))
    mkdirSync(p, { recursive: true })
    const f = join(p, sid + '.jsonl')
    writeFileSync(f, [{ type: 'custom-title', customTitle: name, sessionId: sid }, { type: 'assistant', timestamp: new Date(at).toISOString(), message: { content: [{ type: 'tool_use', id: 'x', name: 'Read', input: {} }] } }].map((x) => JSON.stringify(x)).join('\n') + '\n')
    utimesSync(f, new Date(at), new Date(at))
  }
  const health = () => officeHealth(root, { home, procs, now: NOW, checks: false, cwd: () => null })
  return { root, home, procs, live, sessions, transcript, health, cfg: JSON.parse(readFileSync(join(root, 'office.json'), 'utf8')) }
}

test('readDesk: the folder is the id, desk.json "name" is the session name', () => {
  const o = office()
  const d = readDesk(join(o.root, 'desks', 'dashboard'))
  assert.equal(d.name, 'dashboard')
  assert.equal(d.title, 'ops-dashboard')
  assert.equal(d.session, 'desk-ops-dashboard')
  // an "id" that disagrees with the folder is broken: the id is the folder and never changes
  writeFileSync(join(o.root, 'desks', 'inventory', 'desk.json'), JSON.stringify({ id: 'stock', name: 'inventory', kind: 'knowledge', port: 9502 }))
  assert.match(rosterSafe(join(o.root, 'desks')).broken[0].why, /"id" says "stock".*folder called "inventory"/)
})

test('⛔ desk-<x> names one folder: a name equal to another desk\'s name or id breaks both', () => {
  const o = office()
  writeFileSync(join(o.root, 'desks', 'inventory', 'desk.json'), JSON.stringify({ name: 'dashboard', kind: 'knowledge', port: 9502 }))
  const r = rosterSafe(join(o.root, 'desks'))
  assert.deepEqual(r.broken.map((b) => b.desk).sort(), ['dashboard', 'inventory'])
  assert.deepEqual(r.desks.map((d) => d.name), ['rfq'])
  // and hire will not take a name another desk answers to
  const p = mkdtempSync(join(tmpdir(), 'oa-id-h-'))
  mkdirSync(join(p, 'desks', 'dashboard'), { recursive: true })
  writeFileSync(join(p, 'desks', 'dashboard', 'desk.json'), JSON.stringify({ name: 'ops-dashboard', kind: 'knowledge', port: 9501 }))
  assert.throws(() => hire(p, { name: 'ops-dashboard', kind: 'knowledge' }), /ops-dashboard/)
})

test('whoIs: the session under its name, under its id (started before a rename), and its case sessions are that folder', () => {
  const o = office()
  const now = whoIs(o.root, o.cfg, { name: 'desk-ops-dashboard', env: {} })
  assert.equal(now.kind, 'desk'); assert.equal(now.desk, 'dashboard'); assert.equal(now.dir, join(o.root, 'desks', 'dashboard'))
  const old = whoIs(o.root, o.cfg, { name: 'desk-dashboard', env: {} })
  assert.equal(old.desk, 'dashboard'); assert.equal(old.stale, true)
  const kid = whoIs(o.root, o.cfg, { name: 'desk-quotes--RFQ-7', env: {} })
  assert.equal(kid.desk, 'rfq'); assert.equal(kid.caseKey, 'RFQ-7')
  assert.deepEqual(childOf(o.root, 'desk-quotes--RFQ-7'), { parent: 'rfq', key: 'RFQ-7', dir: join(o.root, 'desks', 'rfq') })
  assert.equal(whoIs(o.root, o.cfg, { name: 'desk-nobody', env: {} }).kind, 'unknown')
  assert.deepEqual(deskOfSession(rosterSafe(join(o.root, 'desks')).desks, 'desk-ops-dashboard').desk.name, 'dashboard')
})

test('start: the tag is the name now; a session still under the id is this desk (already), never a second one', async () => {
  const o = office()
  const t = targetsOf(o.root, o.cfg, 'all').find((x) => x.name === 'dashboard')
  assert.equal(t.tag, 'desk-ops-dashboard')
  assert.equal(t.dir, join(o.root, 'desks', 'dashboard'))
  // by id or by name
  assert.equal(targetsOf(o.root, o.cfg, 'ops-dashboard')[0].name, 'dashboard')
  assert.equal(targetsOf(o.root, o.cfg, 'dashboard')[0].tag, 'desk-ops-dashboard')
  o.live('dashboard', 'desk-dashboard')
  const made = []
  const rows = await start(o.root, 'dashboard', { live: () => o.sessions, terminal: { titles: () => [], create: (x) => made.push(x), close: () => {} }, dir: join(o.home, '.claude'), sleep: async () => {} })
  assert.equal(rows[0].state, 'already', JSON.stringify(rows))
  assert.match(rows[0].why, /as "desk-dashboard", its name before a rename/)
  assert.equal(made.length, 0)
})

test('start resumes the desk\'s own conversation started under its id, after the rename', async () => {
  const o = office()
  o.transcript('dashboard', '00000000-0000-4000-8000-000000000042', 'desk-dashboard', NOW - 60 * MIN)
  const made = []
  const live = []
  const term = { titles: () => [], close: () => {}, screen: () => '', answerImports: () => {}, create: ({ title, command }) => { made.push({ title, command }); live.push({ pid: 9001, name: title, status: 'idle', sessionId: '00000000-0000-4000-8000-000000000042', cwd: join(o.root, 'desks', 'dashboard') }); return { handle: 'h1' } } }
  const rows = await start(o.root, 'dashboard', { live: () => live, terminal: term, dir: join(o.home, '.claude'), sleep: async () => {}, procs: () => o.procs })
  assert.equal(made[0].title, 'desk-ops-dashboard')
  assert.match(made[0].command, /--resume 00000000-0000-4000-8000-000000000042/, JSON.stringify(rows))
})

test('the switch, closeWhenIdle and open work are keyed by id; the CLI takes either', () => {
  const o = office({ work: 'promise owed by desk-ops-dashboard: the numbers\nold line for desk-dashboard\n' })
  mkdirSync(join(o.root, '.office'), { recursive: true })
  const r = setDesk(o.root, 'ops-dashboard', false)
  assert.ok(r.ok)
  assert.deepEqual(JSON.parse(readFileSync(join(o.root, '.office', 'local.json'), 'utf8')).desks.enabled, { dashboard: false })
  assert.equal(deskOn(readSwitch(o.root), rosterSafe(join(o.root, 'desks')).desks.find((d) => d.name === 'dashboard')).on, false)
  assert.match(listDesks(o.root).lines.join('\n'), /OFF  desk-ops-dashboard \(id dashboard\)/)
  assert.equal(deskWork(o.root, o.cfg, 'dashboard').items.length, 2)
})

test('cases: the session is named after the desk\'s name, the claim and brief are kept under its id', async () => {
  const o = office()
  const live = []
  const held = {}
  const adapter = (desk, pc, req) => (req.op === 'claim' ? ((held[req.key] = req.session), { ok: true }) : req.op === 'open' ? { cases: [] } : { ok: true })
  const term = { titles: () => [], screen: () => '', answerImports: () => {}, close: () => {}, create: ({ title }) => { live.push({ pid: 8001, name: title, status: 'idle', cwd: join(o.root, 'desks', 'rfq') }); return { handle: 'h' } } }
  const r = await openCase(o.root, 'quotes', 'RFQ-7', { live: () => live, adapter, terminal: term, sleep: async () => {}, dir: join(o.home, '.claude'), kill: () => {} })
  assert.equal(r.tag, 'desk-quotes--RFQ-7')
  assert.equal(r.state, 'up', JSON.stringify(r))
  assert.equal(held['RFQ-7'], 'desk-quotes--RFQ-7')
  assert.ok(readCases(o.root)['rfq--RFQ-7']?.openedAt)
  assert.match(readFileSync(join(o.root, '.office', 'cases', 'rfq--RFQ-7.md'), 'utf8'), /goes to desk-quotes by SendMessage/)
  assert.equal(route(o.root, 'about RFQ-7', { live: () => live }).to, 'desk-quotes--RFQ-7')
  assert.equal(route(o.root, 'about RFQ-9', { live: () => live }).to, 'desk-quotes')
  const killed = []
  closeCase(o.root, 'rfq', 'RFQ-7', 'done', { live: () => live, adapter, kill: (p) => killed.push(p), terminal: term })
  assert.deepEqual(killed, [8001])
})

test('wall: a message to the name passes; to the old id it is refused with the name now', () => {
  const o = office()
  const W = compileWall({ root: o.root, leadSession: 'Office Lead' })
  const who = { kind: 'desk', desk: 'inventory', dir: join(o.root, 'desks', 'inventory') }
  const send = (to) => judge({ tool_name: 'SendMessage', tool_input: { to, message: 'x' }, cwd: who.dir }, who, o.root, W)
  assert.equal(send('desk-ops-dashboard'), null)
  assert.equal(send('desk-quotes--RFQ-7'), null)
  assert.match(send('desk-dashboard'), /desk-dashboard was renamed: it is desk-ops-dashboard now/)
})

test('⛔ health: a session still under its id is alive (renamed), never dead plus a second writer; heal restarts it once idle', () => {
  const o = office()
  o.live('dashboard', 'desk-dashboard', { pid: 711, status: 'idle', idleMin: 3 })
  o.live('inventory', 'desk-inventory', { pid: 712 })
  const h = o.health()
  const row = h.desks.find((d) => d.name === 'dashboard')
  assert.equal(row.tag, 'desk-ops-dashboard')
  assert.equal(row.session.state, 'alive')
  assert.equal(row.session.renamed, 'desk-dashboard')
  assert.doesNotMatch(h.line, /dashboard is not running/)
  assert.match(h.line, /renamed, restarts under the new name when idle: desk-dashboard → desk-ops-dashboard/)
  assert.deepEqual(sessionDuplicates(o.root, o.cfg, o.sessions), [])
  // heal: idle on a fresh look → that pid is closed, then started under the name
  const killed = []
  const r = heal(o.root, h, { home: o.home, now: NOW, kill: (p) => { killed.push(p); o.procs.delete(p) }, freshProcs: () => o.procs, cwd: () => null, terminal: { titles: () => [], close: () => {} } })
  const a = r.acts.find((x) => x.act === 'rename-restart')
  assert.deepEqual(killed, [711])
  assert.equal(a.desk, 'dashboard')
  assert.equal(a.ok, true, JSON.stringify(a))
  assert.equal(a.why, 'desk-dashboard → desk-ops-dashboard')
  assert.equal(readFileSync(join(o.root, 'started.txt'), 'utf8'), 'dashboard\n', 'started by id')
})

test('⛔ heal never cuts a busy renamed desk off mid-work', () => {
  const o = office()
  o.live('dashboard', 'desk-dashboard', { pid: 721, status: 'busy', idleMin: 0 })
  const h = o.health()
  const killed = []
  const r = heal(o.root, h, { home: o.home, now: NOW, kill: (p) => killed.push(p), freshProcs: () => o.procs, cwd: () => null, terminal: { titles: () => [], close: () => {} } })
  assert.deepEqual(killed, [])
  assert.match(r.acts.find((x) => x.act === 'rename-restart').why, /busy: left running until it is idle/)
})

test('desk-watch and boot speak the name now; boot prints the roster', () => {
  const o = office()
  const w = watch(o.root, { cfg: o.cfg, configDir: join(o.home, '.claude'), sessions: [], now: NOW, runChecks: false })
  assert.ok(w.rows.some((r) => r.label === 'desk-ops-dashboard' && r.desk === 'dashboard'))
  const who = whoIs(o.root, o.cfg, { name: 'desk-inventory', env: {} })
  const lines = bootLines(o.root, who, o.cfg, who.dir).join('\n')
  assert.match(lines, /desk-ops-dashboard \(knowledge: Dashboard desk/)
  assert.match(lines, /desk-quotes \(knowledge\)/)
  const me = bootLines(o.root, whoIs(o.root, o.cfg, { name: 'desk-ops-dashboard', env: {} }), o.cfg, join(o.root, 'desks', 'dashboard')).join('\n')
  assert.match(me, /^You are desk-ops-dashboard \(desks\/dashboard\)/)
})

test('the README says a rename is one edit, and the id is the folder', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  assert.match(readme, /To rename a desk, edit `"name"` in `desks\/<id>\/desk\.json`\. Nothing else\./)
  assert.match(readme, /The id is its folder, `desks\/<id>\/`, and never changes/)
})
