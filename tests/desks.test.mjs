// WHICH DESKS RUN ON THIS MACHINE (.office/local.json). Every reader that
// starts, restarts, wakes or claims for a desk is asked, each with a fake
// world; nothing real is launched.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readSwitch, deskOn, setDesk, setDefault, listDesks, localFile } from '../lib/desks.mjs'
import { start, exitCodeOf } from '../lib/start.mjs'
import { officeHealth } from '../lib/health.mjs'
import { openCase, sweep, route } from '../lib/cases.mjs'
import { bootLines } from '../hooks/desk-boot.mjs'
import { watch } from '../lib/desk-watch.mjs'

const KEY = '^SC-\\d{6}-\\d{3,}$'
function office(local) {
  const root = mkdtempSync(join(tmpdir(), 'oa-desks-'))
  const desks = {
    design: { perCase: { kind: 'design-job', key: KEY, max: 3, adapter: 'node ../../adapter.mjs' }, wake: 'node bell.mjs' },
    customer: { perCase: { kind: 'design-job', key: '^CS-\\d+$', max: 3, adapter: 'node ../../adapter.mjs' }, wake: 'node bell.mjs' },
    inventory: {},
  }
  for (const [n, extra] of Object.entries(desks)) {
    mkdirSync(join(root, 'desks', n), { recursive: true })
    writeFileSync(join(root, 'desks', n, 'desk.json'), JSON.stringify({ name: n, kind: 'knowledge', port: 9700 + n.length, ...extra }))
  }
  writeFileSync(join(root, 'office.json'), JSON.stringify({ roleEnv: 'OFFICE_ROLE', lead: { session: 'Office Lead' }, boot: {} }))
  if (local !== undefined) { mkdirSync(join(root, '.office'), { recursive: true }); writeFileSync(localFile(root), typeof local === 'string' ? local : JSON.stringify(local)) }
  return root
}
function fakeTerm(live) {
  const made = []
  return { made, titles: () => [], screen: () => '', answerImports: () => {},
    create: ({ title }) => { made.push(title); live.push({ pid: 5000 + made.length, name: title, status: 'idle', sessionId: `00000000-0000-4000-8000-${String(made.length).padStart(12, '0')}` }); return 'term_' + made.length } }
}
const startOpts = (live, term) => ({ live: () => live, terminal: term, sleep: async () => {}, dir: mkdtempSync(join(tmpdir(), 'oa-dcl-')) })
function adapter(waiting = []) {
  const calls = []
  return { calls, fn: (d, pc, req) => { calls.push({ desk: d.name, ...req }); return req.op === 'open' ? { cases: d.name === 'customer' ? waiting : [] } : { ok: true, lost: [] } } }
}

test('no file: every desk is on, as before; a broken file is never read as "all on"', async () => {
  const root = office()
  assert.equal(readSwitch(root).exists, false)
  for (const d of ['design', 'customer', 'inventory']) assert.equal(deskOn(readSwitch(root), d).on, true)
  const live = [], term = fakeTerm(live)
  assert.deepEqual((await start(root, 'all', startOpts(live, term))).map((r) => r.state), ['up', 'up', 'up'])

  const broken = office('{"desks": {"enabled": {"customer": "no"}}}')
  assert.match(readSwitch(broken).error, /desks\.enabled\.customer/)
  const live2 = [], term2 = fakeTerm(live2)
  await assert.rejects(start(broken, 'all', startOpts(live2, term2)), /local\.json.*nothing is started/)
  assert.equal(term2.made.length, 0)
  // the lead still starts: it is the one who has to hear about it
  assert.equal((await start(broken, 'lead', startOpts(live2, term2)))[0].state, 'up')
})

test('off: all skips it and says so; naming it is refused; default false is an allowlist', async () => {
  const root = office({ desks: { enabled: { customer: false } } })
  const live = [], term = fakeTerm(live)
  const rows = await start(root, 'everything', startOpts(live, term))
  assert.deepEqual(rows.map((r) => `${r.target}:${r.state}`), ['lead:up', 'customer:off', 'design:up', 'inventory:up'])
  assert.equal(exitCodeOf(rows), 0)
  assert.ok(!term.made.includes('desk-customer'))
  const named = await start(root, 'customer', startOpts(live, term))
  assert.equal(named[0].state, 'refused')
  assert.match(named[0].why, /off on this machine.*desks\.mjs on customer/)
  assert.equal(exitCodeOf(named), 4)

  const david = office({ desks: { default: false, enabled: { design: true, inventory: true } } })
  const l2 = [], t2 = fakeTerm(l2)
  await start(david, 'all', startOpts(l2, t2))
  assert.deepEqual(t2.made.sort(), ['desk-design', 'desk-inventory'])
})

test('⛔ health reads an off desk as "off", never "dead": dead is what the watchdog restarts', () => {
  const root = office({ desks: { enabled: { customer: false } } })
  const h = officeHealth(root, { home: mkdtempSync(join(tmpdir(), 'oa-dh-')), procs: new Map(), checks: false })
  const state = Object.fromEntries(h.desks.map((d) => [d.name, d.session.state]))
  assert.deepEqual(state, { customer: 'off', design: 'dead', inventory: 'dead' })
})

test('cases: an off desk claims nothing, its waiting cases stay in the book, the lead is alerted, route does not point at it', async () => {
  const root = office({ desks: { enabled: { customer: false } } })
  const a = adapter([{ key: 'CS-1', brief: 'hi' }])
  const live = []
  const o = { live: () => live, terminal: fakeTerm(live), sleep: async () => {}, dir: mkdtempSync(join(tmpdir(), 'oa-dcl-')), kill: () => {}, adapter: a.fn }
  const r = await openCase(root, 'customer', 'CS-1', o)
  assert.equal(r.state, 'refused')
  assert.match(r.why, /off on this machine/)
  const acts = await sweep(root, o)
  assert.ok(acts.some((x) => x.desk === 'customer' && x.act === 'off' && /1 open item/.test(x.why)))
  assert.ok(!a.calls.some((c) => c.desk === 'customer' && c.op === 'claim'), 'no claim for an off desk')
  assert.ok(!acts.some((x) => x.desk === 'customer' && x.act === 'open'))
  assert.match(readFileSync(join(root, '.office', 'alerts.log'), 'utf8'), /DESK-OFF - desk-customer .*CS-1 is waiting in the book/)
  assert.equal(route(root, 'about CS-1 please', o).to, null)
  assert.equal(route(root, 'about SC-260101-001', o).to, 'desk-design')
})

test('boot: an off desk is not told to start its doorbell, and is told it is off', () => {
  const root = office({ desks: { enabled: { customer: false } } })
  const who = (d) => ({ kind: 'desk', desk: d, dir: join(root, 'desks', d) })
  const off = bootLines(root, who('customer'), {}, join(root, 'desks', 'customer')).join('\n')
  assert.doesNotMatch(off, /doorbell with Monitor/)
  assert.match(off, /OFF on this machine/)
  assert.match(bootLines(root, who('design'), {}, join(root, 'desks', 'design')).join('\n'), /doorbell with Monitor/)
})

test('desk-watch: an off desk is not DESK-DEAD; one that still holds a claim is DESK-OFF', () => {
  const root = office({ desks: { enabled: { inventory: false } } })
  const run = () => watch(root, { cfg: {}, configDir: mkdtempSync(join(tmpdir(), 'oa-dw-')), sessions: [], now: Date.now() }).problems.map((p) => p.key)
  assert.ok(!run().some((k) => k.includes('desk-inventory')))
  writeFileSync(join(root, '.office', 'cases.json'), JSON.stringify({ 'inventory--X-1': { claimedAt: 'x', openedAt: 'x' } }))
  assert.ok(run().includes('DESK-OFF:desk-inventory:open'))
})

test('the switch: on/off writes only .office/local.json (ignored by .office/.gitignore), refuses unknown names and the lead, list flags a typo', () => {
  const root = office()
  mkdirSync(join(root, 'desks', 'boss'), { recursive: true })
  writeFileSync(join(root, 'desks', 'boss', 'desk.json'), JSON.stringify({ name: 'boss', kind: 'lead', port: 9900 }))
  assert.equal(setDesk(root, 'custmer', false).ok, false)
  assert.equal(setDesk(root, 'boss', false).ok, false)
  assert.equal(existsSync(localFile(root)), false, 'a refused switch writes nothing')
  mkdirSync(join(root, '.office'), { recursive: true })
  writeFileSync(join(root, '.office', 'cases.json'), JSON.stringify({ 'customer--CS-9': { claimedAt: 'x', openedAt: 'x' } }))
  const r = setDesk(root, 'customer', false, { cfg: {}, live: [{ name: 'desk-customer', pid: 41, cwd: '/elsewhere/desks/customer' }, { name: 'desk-customer', pid: 42, cwd: join(root, 'desks', 'customer') }], adapter: () => ({ cases: [] }) })
  assert.equal(r.ok, true)
  assert.match(r.lines.join('\n'), /still running \(pid 42\): nothing was closed/)
  assert.match(r.lines.join('\n'), /open: case CS-9 is claimed by this machine/)
  assert.match(readFileSync(join(root, '.office', 'alerts.log'), 'utf8'), /DESK-OFF/)
  assert.equal(readFileSync(join(root, '.office', '.gitignore'), 'utf8').trim().split('\n').pop(), '*')
  assert.deepEqual(JSON.parse(readFileSync(localFile(root), 'utf8')), { desks: { default: true, enabled: { customer: false } } })
  assert.equal(readFileSync(join(root, 'office.json'), 'utf8').includes('enabled'), false, 'office.json is never written')
  assert.equal(setDefault(root, false).ok, true)
  const l = listDesks(root)
  assert.match(l.lines[0], /runs 0 of 3 desks \(3 off\)/)
  writeFileSync(localFile(root), JSON.stringify({ desks: { enabled: { custmer: false } } }))
  const typo = listDesks(root)
  assert.equal(typo.ok, false)
  assert.match(typo.lines.join('\n'), /"custmer" in \.office\/local\.json is not a desk here/)
})

test('⛔ a desk cannot flip the switch: writing .office/local.json is outside its wall', () => {
  const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'desk-wall.mjs')
  const root = office()
  writeFileSync(join(root, 'office.json'), JSON.stringify({ roleEnv: 'OFFICE_ROLE', lead: { session: 'Office Lead' }, wall: { failClosed: true } }))
  const env = { ...process.env, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'oa-dcfg-')), OFFICE_ROLE: 'desk-customer' }
  const cwd = join(root, 'desks', 'customer')
  const gate = (tool_name, tool_input) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name, tool_input, cwd }), encoding: 'utf8', env, cwd }).status
  assert.equal(gate('Write', { file_path: localFile(root), content: '{}' }), 2)
  assert.equal(gate('Bash', { command: `node ../../lib/desks.mjs on customer > ${localFile(root)}` }), 2)
  assert.equal(gate('Write', { file_path: join(cwd, 'notes.md'), content: 'x' }), 0)
})

test('office.json openWork: lines naming desk-<name> (or its cases) are what it owes; a failing command is UNKNOWN, not "nothing"', async () => {
  const { openWork } = await import('../lib/desks.mjs')
  const root = office({ desks: { enabled: { customer: false } } })
  writeFileSync(join(root, 'promises.sh'), 'echo "DRY due 2h: desk-customer BT-77 promise"\necho "DRY due 1h: desk-customer2 BT-9 waiting"\necho "DRY due 5h: desk-design--SC-260101-001 waiting"\n')
  const cfg = { openWork: 'sh promises.sh' }
  const d = (n) => ({ name: n, perCase: null })
  assert.deepEqual(openWork(root, d('customer'), { cfg, adapter: () => ({ cases: [] }) }).items, ['DRY due 2h: desk-customer BT-77 promise'])
  assert.deepEqual(openWork(root, d('design'), { cfg }).items, ['DRY due 5h: desk-design--SC-260101-001 waiting'])
  assert.deepEqual(openWork(root, d('inventory'), { cfg }).items, [])
  const bad = openWork(root, d('customer'), { cfg: { openWork: 'exit 3' } })
  assert.deepEqual(bad.items, [])
  assert.match(bad.unknown[0], /openWork exited 3/)
  // and it reaches the lead through the sweep
  const live = []
  await sweep(root, { cfg, live: () => live, terminal: fakeTerm(live), sleep: async () => {}, dir: mkdtempSync(join(tmpdir(), 'oa-dcl-')), kill: () => {}, adapter: adapter().fn })
  assert.match(readFileSync(join(root, '.office', 'alerts.log'), 'utf8'), /DESK-OFF - desk-customer .*BT-77/)
})
