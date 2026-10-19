// STANDING DESKS CLOSE WHEN IDLE AND WAKE ON WORK (0.10.4, the lead's ruling
// 2026-10-19). A desk listed in office.json "closeWhenIdle" is closed after its
// minutes with no work waiting, and restarted by heal's own restart when work
// arrives. Work is what office.json "openWork" prints naming desk-<name>, and
// the owner's open tasks assigned to it. ONE OWNER: health judges, heal acts,
// and every reader of "should this desk be running" asks lib/desks.mjs.
//
// ⛔ A CLOSED DESK HEARS ONLY WHAT openWork PRINTS. A message to its socket
// reaches nobody. So: no openWork declared = never closed; openWork failing =
// UNKNOWN = never closed, and a closed desk is woken.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { officeHealth } from '../lib/health.mjs'
import { heal } from '../lib/heal.mjs'
import { idledState, closeWhenIdleOf } from '../lib/desks.mjs'
import { projectDirOf } from '../lib/conversation.mjs'
import { watch } from '../lib/desk-watch.mjs'
import { start } from '../lib/start.mjs'

const NOW = Date.now()
const MIN = 60_000
function office({ cfg = {}, work = '' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oa-cwi-'))
  const home = mkdtempSync(join(tmpdir(), 'oa-cwi-home-'))
  mkdirSync(join(home, '.claude', 'sessions'), { recursive: true })
  for (const n of ['inventory', 'ledger']) {
    mkdirSync(join(root, 'desks', n), { recursive: true })
    writeFileSync(join(root, 'desks', n, 'desk.json'), JSON.stringify({ name: n, kind: 'knowledge', port: 9400 + n.length }))
  }
  writeFileSync(join(root, 'work.txt'), work)
  writeFileSync(join(root, 'office.json'), JSON.stringify({ roleEnv: 'OFFICE_ROLE', start: 'office:start', openWork: 'cat work.txt', closeWhenIdle: { inventory: 30 }, ...cfg }))
  // never empty: an empty table makes liveSessions ask the real machine about the pid
  const procs = new Map([[1, { pid: 1, ppid: 0, ageSec: 1e6, cmd: 'launchd' }]])
  // a live desk session, idle since idleMin ago, its transcript's last work workMin ago
  const live = (name, { pid = 700, idleMin = 40, workMin = idleMin, status = 'idle' } = {}) => {
    const cwd = join(root, 'desks', name)
    writeFileSync(join(home, '.claude', 'sessions', `${pid}.json`), JSON.stringify({ pid, name: 'desk-' + name, cwd, sessionId: `00000000-0000-4000-8000-00000000${pid}`, status, statusUpdatedAt: NOW - idleMin * MIN, startedAt: NOW - 7200_000 }))
    procs.set(pid, { pid, ppid: 1, ageSec: 7200, cmd: `claude --name desk-${name}` })
    transcript(name, `00000000-0000-4000-8000-00000000${pid}`, NOW - workMin * MIN)
  }
  const transcript = (name, sid, at) => {
    const p = projectDirOf(join(root, 'desks', name), join(home, '.claude'))
    mkdirSync(p, { recursive: true })
    const f = join(p, sid + '.jsonl')
    writeFileSync(f, JSON.stringify({ type: 'assistant', timestamp: new Date(at).toISOString(), message: { content: [{ type: 'tool_use', id: 'x', name: 'Read', input: {} }] } }) + '\n')
    utimesSync(f, new Date(at), new Date(at))
  }
  const health = () => officeHealth(root, { home, procs, now: NOW, checks: false, cwd: () => null })
  const row = (h, name) => h.desks.find((d) => d.name === name)
  return { root, home, procs, live, transcript, health, row }
}
const healOpts = (o, extra = {}) => ({ home: o.home, now: NOW, kill: () => {}, freshProcs: () => o.procs, cwd: () => null, terminal: { titles: () => [], close: () => {} }, ...extra })
const idled = (root) => { try { return JSON.parse(readFileSync(join(root, '.office', 'idled.json'), 'utf8')) } catch { return {} } }

test('config: minutes or true (30); a desk not listed is never judged; a listed name that is no desk is a finding', () => {
  assert.deepEqual([...closeWhenIdleOf({ closeWhenIdle: { a: 45, b: true, c: 0, d: 'x' } }, ['a', 'b', 'c', 'd']).minutes], [['a', 45], ['b', 30]])
  assert.deepEqual(closeWhenIdleOf({ closeWhenIdle: { a: 45, ghost: 30 } }, ['a']).unknown, ['ghost'])
  const o = office({ cfg: { closeWhenIdle: { inventory: 30, ghost: 30 } } })
  o.live('inventory'); o.live('ledger', { pid: 701 })
  const h = o.health()
  assert.equal(o.row(h, 'ledger').idle, undefined, 'not listed: never closed')
  assert.ok(h.findings.some((f) => /closeWhenIdle names "ghost"/.test(f.say)), JSON.stringify(h.findings))
})

test('health: idle past its minutes with nothing waiting is "close"; work, no openWork, a failing openWork, mid-turn or a tool call under 5 min keep it', () => {
  const verdict = (setup, cfg) => { const o = office(cfg); setup(o); return o.row(o.health(), 'inventory').idle }
  assert.equal(verdict((o) => o.live('inventory')).verdict, 'close')
  const w = verdict((o) => o.live('inventory'), { work: 'desk-inventory desk_inbox 7 since 2026-10-19T15:00Z\n' })
  assert.equal(w.verdict, 'keep'); assert.match(w.why, /desk_inbox 7/)
  assert.match(verdict((o) => o.live('inventory'), { cfg: { openWork: undefined } }).why, /no openWork/)
  assert.match(verdict((o) => o.live('inventory'), { cfg: { openWork: 'exit 3' } }).why, /UNKNOWN|exited 3/)
  assert.equal(verdict((o) => o.live('inventory', { idleMin: 20 })).verdict, 'keep', 'idle 20 of 30 min')
  assert.equal(verdict((o) => o.live('inventory', { status: 'busy' })).verdict, 'keep', 'mid-turn')
  assert.equal(verdict((o) => o.live('inventory', { idleMin: 40, workMin: 3 })).verdict, 'keep', 'a tool call 3 min ago')
  assert.equal(o_open_task_keeps(), 'keep')
})
function o_open_task_keeps() {
  const o = office()
  o.live('inventory')
  mkdirSync(join(o.root, '.office'), { recursive: true })
  writeFileSync(join(o.root, '.office', 'tasks.jsonl'), JSON.stringify({ at: NOW, by: 'owner', ev: 'add', id: 'T-1', said: 'count the hinges', title: 'count the hinges', assigned: 'desk-inventory' }) + '\n')
  return o.row(o.health(), 'inventory').idle.verdict
}

test('heal closes a "close" desk by its pid on a fresh look, closes its tab, and marks it idled', () => {
  const o = office()
  o.live('inventory')
  const killed = [], closedTabs = []
  const terminal = { titles: () => [{ handle: 'term_inv', title: 'desk-inventory', agent: true }], close: (h) => closedTabs.push(h) }
  const r = heal(o.root, o.health(), healOpts(o, { kill: (p) => killed.push(p), terminal }))
  assert.deepEqual(killed, [700])
  assert.deepEqual(closedTabs, ['term_inv'])
  assert.ok(r.acts.some((a) => a.act === 'idle-close' && a.desk === 'inventory' && a.ok))
  assert.equal(idled(o.root).inventory.pid, 700)
  // the fresh look disagrees (it just took a turn): nothing is killed
  const o2 = office(); o2.live('inventory')
  const h2 = o2.health()
  writeFileSync(join(o2.home, '.claude', 'sessions', '700.json'), JSON.stringify({ pid: 700, name: 'desk-inventory', cwd: join(o2.root, 'desks', 'inventory'), status: 'busy', statusUpdatedAt: NOW, startedAt: NOW - 7200_000 }))
  const k2 = []
  heal(o2.root, h2, healOpts(o2, { kill: (p) => k2.push(p) }))
  assert.deepEqual(k2, [])
})

test('an idled desk with nothing waiting is "idled", not dead: the office is not red, heal does not restart it, desk-watch does not call it dead', () => {
  const o = office()
  o.live('inventory'); o.live('ledger', { pid: 701, idleMin: 1 })
  heal(o.root, o.health(), healOpts(o))
  o.procs.delete(700)
  const h = o.health()
  assert.equal(o.row(h, 'inventory').session.state, 'idled', JSON.stringify(o.row(h, 'inventory')))
  assert.equal(h.code, 0, h.line)
  const r = heal(o.root, h, healOpts(o))
  assert.ok(!r.acts.some((a) => a.act === 'restart'), JSON.stringify(r.acts))
  const wv = watch(o.root, { configDir: join(o.home, '.claude'), sessions: [], now: NOW, runChecks: false })
  assert.ok(!wv.problems.some((p) => p.type === 'DESK-DEAD' && /inventory/.test(p.line)), JSON.stringify(wv.problems))
})

test('work arriving wakes it through heal\'s restart, on its own budget: no heal spent, no "down" alert', () => {
  const o = office()
  o.live('inventory')
  heal(o.root, o.health(), healOpts(o))
  o.procs.delete(700)
  writeFileSync(join(o.root, 'work.txt'), 'desk-inventory desk_inbox 9 since 2026-10-19T16:00Z\n')
  // a new command string: officeOpenWork caches one command's answer for 30 s
  writeFileSync(join(o.root, 'office.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(o.root, 'office.json'), 'utf8')), openWork: 'cat work.txt # 2' }))
  const h = o.health()
  const row = o.row(h, 'inventory')
  assert.equal(row.session.state, 'dead')
  assert.match(row.session.wake, /desk_inbox 9/)
  writeFileSync(join(o.root, 'office.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(o.root, 'office.json'), 'utf8')), start: 'echo started {desk} >> started.txt' }))
  const r = heal(o.root, h, healOpts(o))
  const a = r.acts.find((x) => x.act === 'wake')
  assert.ok(a && a.ok, JSON.stringify(r.acts))
  assert.match(readFileSync(join(o.root, 'started.txt'), 'utf8'), /started inventory/)
  const st = JSON.parse(readFileSync(join(o.root, '.office', 'heal-state.json'), 'utf8'))
  assert.equal((st.heals['desk:inventory'] ?? []).length, 0, 'a wake is not a heal')
  assert.equal(st.down.inventory, undefined, 'a woken desk was never "down"')
  // a failing openWork wakes it too: a closed desk must not go deaf on UNKNOWN
  writeFileSync(join(o.root, 'office.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(o.root, 'office.json'), 'utf8')), openWork: 'exit 1' }))
  assert.match(o.row(o.health(), 'inventory').session.wake, /UNKNOWN|exited 1/)
})

test('⛔ the marker never hides a crash: once the desk ran again (a newer transcript), a dead desk is dead', () => {
  const o = office()
  o.live('inventory')
  heal(o.root, o.health(), healOpts(o))
  o.procs.delete(700)
  assert.equal(idledState(o.root, JSON.parse(readFileSync(join(o.root, 'office.json'), 'utf8')), 'inventory', { configDir: join(o.home, '.claude'), sessions: [] }).state, 'idled')
  // a person started it, it worked, and it crashed
  o.transcript('inventory', '00000000-0000-4000-8000-000000000999', NOW + 5 * MIN)
  const h = officeHealth(o.root, { home: o.home, procs: o.procs, now: NOW + 6 * MIN, checks: false, cwd: () => null })
  assert.equal(o.row(h, 'inventory').session.state, 'dead')
  assert.equal(o.row(h, 'inventory').session.wake, undefined, 'a crash, not a wake: heal spends a heal on it')
})

test('start all leaves an idled desk closed; naming it starts it', async () => {
  const o = office()
  o.live('inventory')
  heal(o.root, o.health(), healOpts(o))
  const made = []
  const term = { titles: () => [], create: ({ title }) => { made.push(title); return 't' + made.length }, screen: () => '', answerImports: () => {} }
  const live = []
  const base = { live: () => live, terminal: term, sleep: async () => {}, dir: join(o.home, '.claude'), cfg: { ...JSON.parse(readFileSync(join(o.root, 'office.json'), 'utf8')), launch: { waitSec: 0 } }, procs: () => new Map() }
  const rows = await start(o.root, 'all', base)
  assert.equal(rows.find((r) => r.target === 'inventory').state, 'idled')
  assert.ok(!made.includes('desk-inventory'))
  await start(o.root, 'inventory', base)
  assert.ok(made.includes('desk-inventory'), 'named: started')
})

test('a case session working in the same folder does not void the parent\'s mark', () => {
  const o = office()
  o.live('inventory')
  heal(o.root, o.health(), healOpts(o))
  o.procs.delete(700)
  const p = projectDirOf(join(o.root, 'desks', 'inventory'), join(o.home, '.claude'))
  const f = join(p, '00000000-0000-4000-8000-000000000777.jsonl')
  writeFileSync(f, JSON.stringify({ type: 'custom-title', customTitle: 'desk-inventory--PO-1' }) + '\n')
  utimesSync(f, new Date(NOW + 10 * MIN), new Date(NOW + 10 * MIN))
  const cfg = JSON.parse(readFileSync(join(o.root, 'office.json'), 'utf8'))
  assert.equal(idledState(o.root, cfg, 'inventory', { configDir: join(o.home, '.claude'), sessions: [] }).state, 'idled')
  writeFileSync(f, JSON.stringify({ type: 'custom-title', customTitle: 'desk-inventory' }) + '\n')
  utimesSync(f, new Date(NOW + 10 * MIN), new Date(NOW + 10 * MIN))
  assert.equal(idledState(o.root, cfg, 'inventory', { configDir: join(o.home, '.claude'), sessions: [] }), null, 'its own conversation ran: void')
})
