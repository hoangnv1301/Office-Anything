// DEPARTMENTS (0.12.0). One office, a lead per department: Local Ops (ERP, one
// per person, machine and account) and Customer Service (AICS, the owner's Mac
// only). Every real office had no departments block when this shipped, so
// each path is driven here through three machines: one that runs Local Ops
// only, one that runs both, and one with no setting. And an office with no
// block, which must behave exactly as before.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { departmentsOf, machineOf, allLeads, machineLeads, leadsOfDesk, deskScope } from '../lib/departments.mjs'
import { readSwitch, deskOn, listDesks, setDesk, setDepartments, inDepartment, listDepartments } from '../lib/desks.mjs'
import { whoIs } from '../lib/office.mjs'
import { targetsOf } from '../lib/start.mjs'
import { officeHealth } from '../lib/health.mjs'
import { heal } from '../lib/heal.mjs'
import { compileWall, judge } from '../lib/wall.mjs'
import { decide } from '../hooks/desk-wall.mjs'
import { bootLines } from '../hooks/desk-boot.mjs'
import { chatRosterCheap } from '../board/serve.mjs'
import { report as departmentsCheck } from '../checks/departments.mjs'
import { rosterSafe } from '../lib/desk.mjs'

const NOW = Date.now()
const DEPTS = {
  'local-ops': { lead: 'ERP', desks: ['design', 'inventory'], instructions: 'desks/leads/ERP.md', start: 'echo ERP >> started.txt' },
  'customer-service': { lead: 'AICS', aliases: ['lead', '工厂ERP'], desks: ['customer', 'selene'], open: true, start: 'echo AICS >> started.txt', services: ['onetalk-reader\\.mjs'] },
}
function office({ machine, depts = DEPTS, cfg = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oa-dep-'))
  const home = mkdtempSync(join(tmpdir(), 'oa-dep-home-'))
  mkdirSync(join(home, '.claude', 'sessions'), { recursive: true })
  for (const [id, port] of [['design', 9601], ['inventory', 9602], ['customer', 9603], ['selene', 9604], ['shared', 9605]]) {
    mkdirSync(join(root, 'desks', id), { recursive: true })
    writeFileSync(join(root, 'desks', id, 'desk.json'), JSON.stringify({ name: id, kind: id === 'customer' || id === 'selene' ? 'channel' : 'knowledge', port }))
  }
  mkdirSync(join(root, 'desks', 'leads'), { recursive: true })
  writeFileSync(join(root, 'desks', 'leads', 'ERP.md'), '# ERP\n')
  const c = { roleEnv: 'OFFICE_ROLE', start: 'echo {desk} >> started.txt', ...(depts ? { departments: depts } : { lead: { session: 'lead', aliases: ['工厂ERP'] } }), wall: { lead: { open: true, bash: ['^git status$'] } }, ...cfg }
  writeFileSync(join(root, 'office.json'), JSON.stringify(c))
  if (machine !== undefined) { mkdirSync(join(root, '.office'), { recursive: true }); writeFileSync(join(root, '.office', 'local.json'), JSON.stringify(machine)) }
  const procs = new Map([[1, { pid: 1, ppid: 0, ageSec: 1e6, cmd: 'launchd' }]])
  const live = (name, cwd, pid) => {
    writeFileSync(join(home, '.claude', 'sessions', `${pid}.json`), JSON.stringify({ pid, name, cwd, sessionId: `00000000-0000-4000-8000-00000000${pid}`, status: 'idle', statusUpdatedAt: NOW, updatedAt: NOW, startedAt: NOW - 60_000 }))
    procs.set(pid, { pid, ppid: 1, ageSec: 60, cmd: `claude --name ${name}` })
  }
  const health = () => officeHealth(root, { home, procs, now: NOW, checks: false, cwd: () => null })
  const healIt = (h) => heal(root, h, { home, now: NOW, kill: () => {}, freshProcs: () => procs, cwd: () => null, terminal: { titles: () => [], close: () => {} } })
  const started = () => { try { return readFileSync(join(root, 'started.txt'), 'utf8').trim().split('\n') } catch { return [] } }
  return { root, home, procs, live, health, healIt, started, cfg: c }
}
const LOCAL = { departments: ['local-ops'] }
const BOTH = { departments: ['local-ops', 'customer-service'] }

test('⛔ no departments block: one lead, every desk, exactly as before', () => {
  const o = office({ depts: null })
  assert.deepEqual(allLeads(o.cfg).map((l) => [l.department, l.session, l.names]), [[null, 'lead', ['lead', '工厂ERP']]])
  assert.deepEqual(machineLeads(o.root, o.cfg).map((l) => l.session), ['lead'])
  assert.equal(deskScope(o.root, o.cfg, ['customer']), null)
  assert.equal(deskOn(readSwitch(o.root), 'customer').on, true)
  assert.deepEqual(targetsOf(o.root, o.cfg, 'lead').map((t) => [t.name, t.tag]), [['lead', 'lead']])
  assert.equal(whoIs(o.root, o.cfg, { name: '工厂ERP', env: {} }).kind, 'lead')
  assert.equal(departmentsCheck(o.root).applicable, false)
})

test('config: a desk in two departments, a lead name twice, an unknown local id are refused, never read as "all"', () => {
  const D = departmentsOf({ departments: { a: { lead: 'A', desks: ['x'] }, b: { lead: 'B', aliases: ['A'], desks: ['x'] } } })
  assert.ok(D.problems.some((p) => /desk x is in two departments/.test(p)))
  assert.ok(D.problems.some((p) => /lead name "A" belongs to two departments/.test(p)))
  const o = office({ machine: { departments: ['sales'] } })
  assert.match(machineOf(o.root, o.cfg).error, /does not declare: sales/)
  assert.match(readSwitch(o.root).error, /does not declare: sales/, 'a broken setting refuses starts')
  writeFileSync(join(o.root, 'office.json'), JSON.stringify({ ...o.cfg, departments: { ...DEPTS, x: { lead: 'X', desks: ['design', 'ghost'] } } }))
  const r = departmentsCheck(o.root)
  assert.equal(r.code, 4)
  assert.ok(r.findings.some((f) => /desk design is in two departments/.test(f.say)))
  assert.ok(r.findings.some((f) => /"ghost", which is no desk/.test(f.say)))
})

test('a Local Ops machine: Customer Service desks are OUTSIDE (not off), not started, not listed, not switchable', () => {
  const o = office({ machine: LOCAL })
  const sw = readSwitch(o.root)
  assert.deepEqual(deskOn(sw, 'customer'), { on: false, outside: true, source: 'department customer-service, which this machine does not run' })
  assert.equal(deskOn(sw, 'design').on, true)
  assert.equal(deskOn(sw, 'shared').on, true, 'a desk in no department is everyone\'s')
  assert.deepEqual(targetsOf(o.root, o.cfg, 'all').map((t) => t.name).sort(), ['design', 'inventory', 'shared'])
  assert.equal(targetsOf(o.root, o.cfg, 'customer')[0].outside, 'department customer-service, which this machine does not run')
  assert.match(listDesks(o.root).lines[0], /runs 3 of 3 desks; 2 belong to departments it does not run/)
  assert.equal(setDesk(o.root, 'customer', true).ok, false)
  assert.deepEqual(chatRosterCheap(o.root).map((r) => r.desk).filter((d) => d !== 'team-lead').sort(), ['design', 'inventory', 'shared'])
})

test('⛔ a Local Ops machine starts and heals ERP only; AICS is never started here, even by name', () => {
  const o = office({ machine: LOCAL })
  assert.deepEqual(targetsOf(o.root, o.cfg, 'lead').map((t) => t.tag), ['ERP'])
  assert.deepEqual(targetsOf(o.root, o.cfg, 'everything').filter((t) => t.isLead).map((t) => t.tag), ['ERP'])
  assert.throws(() => targetsOf(o.root, o.cfg, 'AICS'), /leads department customer-service, which this machine does not run/)
  const h = o.health()
  assert.deepEqual(h.leads.map((l) => l.name), ['ERP'])
  assert.doesNotMatch(h.line, /AICS/)
  o.healIt(h)
  assert.deepEqual(o.started().filter((x) => x === 'ERP' || x === 'AICS'), ['ERP'])
})

test('both departments on one machine: both leads, each on its own budget; one at the root is not the other misnamed', () => {
  const o = office({ machine: BOTH })
  o.live('AICS', o.root, 801)
  const h = o.health()
  assert.deepEqual(h.leads.map((l) => [l.name, !!l.session]), [['ERP', false], ['AICS', true]])
  assert.ok(!h.findings.some((f) => f.desk === 'ERP' && /runs as "AICS"/.test(f.say)), JSON.stringify(h.findings))
  o.healIt(h)
  assert.deepEqual(o.started().filter((x) => x === 'ERP' || x === 'AICS'), ['ERP'])
  assert.deepEqual(targetsOf(o.root, o.cfg, 'lead').map((t) => t.tag), ['ERP', 'AICS'])
})

test('⛔ a block and no machine setting: every desk as today, but no department lead is started, and health says so in red', () => {
  const o = office()
  assert.equal(deskOn(readSwitch(o.root), 'customer').on, true)
  assert.deepEqual(machineLeads(o.root, o.cfg), [])
  assert.throws(() => targetsOf(o.root, o.cfg, 'lead'), /names no department/)
  const h = o.health()
  assert.match(h.line, /this machine names no department/)
  o.healIt(h)
  assert.deepEqual(o.started().filter((x) => x === 'ERP' || x === 'AICS'), [])
  // identity still holds: a lead started by hand is a lead, and walled
  assert.equal(whoIs(o.root, o.cfg, { name: 'lead', env: {} }).department, 'customer-service')
})

test('wall: a desk reaches its own department\'s lead; a desk of a department this machine does not run is refused; leads reach each other', () => {
  const o = office({ machine: LOCAL })
  const scope = deskScope(o.root, o.cfg, rosterSafe(join(o.root, 'desks')).desks)
  const asDesk = (desk) => compileWall({ root: o.root, scope, leadSession: leadsOfDesk(o.cfg, desk)[0].session, leadAliases: leadsOfDesk(o.cfg, desk).flatMap((l) => l.names).slice(1) })
  const send = (W, desk, to) => judge({ tool_name: 'SendMessage', tool_input: { to, message: 'x' }, cwd: join(o.root, 'desks', desk) }, { kind: 'desk', desk, dir: join(o.root, 'desks', desk) }, o.root, W)
  assert.equal(send(asDesk('design'), 'design', 'ERP'), null)
  assert.ok(send(asDesk('design'), 'design', 'AICS'), 'not its lead')
  assert.equal(send(asDesk('design'), 'design', 'desk-inventory'), null)
  assert.match(send(asDesk('design'), 'design', 'desk-customer'), /belongs to a department this machine does not run/)
  // on a machine running both, customer ↔ design keeps working (the owner's Mac during the switch)
  const b = office({ machine: BOTH })
  const W2 = compileWall({ root: b.root, scope: deskScope(b.root, b.cfg, rosterSafe(join(b.root, 'desks')).desks), leadSession: 'AICS' })
  assert.equal(judge({ tool_name: 'SendMessage', tool_input: { to: 'desk-design', message: 'x' } }, { kind: 'desk', desk: 'customer', dir: join(b.root, 'desks', 'customer') }, b.root, W2), null)
})

test('⛔ wall.lead.open lifts only a department that says "open": AICS; ERP stays walled', async () => {
  const o = office({ machine: BOTH })
  const ask = (role) => decide(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' }, cwd: o.root }), { OFFICE_ROLE: role }, o.root)
  assert.equal((await ask('AICS')).code, 0, 'the owner\'s own lead: open')
  assert.equal((await ask('ERP')).code, 2, 'ERP: walled like the lead was')
  assert.equal((await ask('lead')).code, 0, 'an alias of AICS')
})

test('boot: a department lead is told who it is, its desks, and its own instructions', () => {
  const o = office({ machine: LOCAL })
  const lines = bootLines(o.root, whoIs(o.root, o.cfg, { name: 'ERP', env: {} }), o.cfg, o.root).join('\n')
  assert.match(lines, /You are ERP, the lead of department local-ops\. Your desks: desk-design, desk-inventory\./)
  assert.match(lines, /Read desks\/leads\/ERP\.md before anything else\./)
  const desk = bootLines(o.root, whoIs(o.root, o.cfg, { name: 'desk-design', env: {} }), o.cfg, join(o.root, 'desks', 'design')).join('\n')
  assert.doesNotMatch(desk, /desk-customer/, 'the roster lists only desks this machine runs')
})

test('⛔ buyer machinery on a machine that did not name customer-service is red, by pid; nothing is killed', () => {
  const o = office({ machine: LOCAL })
  o.procs.set(901, { pid: 901, ppid: 1, ageSec: 60, cmd: 'node scripts/onetalk-reader.mjs' })
  const h = o.health()
  assert.match(h.line, /customer-service service running here \(pid 901\)/)
  const b = office({ machine: BOTH })
  b.procs.set(901, { pid: 901, ppid: 1, ageSec: 60, cmd: 'node scripts/onetalk-reader.mjs' })
  assert.doesNotMatch(b.health().line, /service running here/)
})

test('the sweeps lease: held here is quiet, held elsewhere is red naming it, any other answer is UNKNOWN', () => {
  const run = (cmd) => {
    const o = office({ machine: { ...LOCAL, sweeps: true }, depts: { ...DEPTS, 'local-ops': { ...DEPTS['local-ops'], sweepsLease: cmd } } })
    return o.health().line
  }
  assert.doesNotMatch(run('exit 0'), /sweeps lease/)
  assert.match(run('echo mac-david; exit 3'), /sweeps lease held elsewhere \(mac-david\)/)
  assert.match(run('exit 9'), /local-ops sweeps lease UNKNOWN/)
  // no "sweeps": true, never asked
  const o = office({ machine: LOCAL, depts: { ...DEPTS, 'local-ops': { ...DEPTS['local-ops'], sweepsLease: 'exit 9' } } })
  assert.doesNotMatch(o.health().line, /sweeps lease/)
})

test('CLI: departments set writes only declared ids and keeps the switch; department <id> is yes only when named', () => {
  const o = office({ machine: { desks: { default: true, enabled: { inventory: false } } } })
  assert.equal(inDepartment(o.root, 'customer-service').ok, false, 'no setting is no')
  assert.equal(setDepartments(o.root, ['sales']).ok, false)
  const r = setDepartments(o.root, ['local-ops', 'customer-service'])
  assert.ok(r.ok, r.lines.join('\n'))
  const local = JSON.parse(readFileSync(join(o.root, '.office', 'local.json'), 'utf8'))
  assert.deepEqual(local, { desks: { default: true, enabled: { inventory: false } }, departments: ['local-ops', 'customer-service'] })
  assert.equal(inDepartment(o.root, 'customer-service').ok, true)
  assert.match(listDepartments(o.root).lines.join('\n'), /in no department \(every machine's\): desk-shared/)
})

test('the README says an office without a block is unchanged, and an unset machine starts no lead', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  assert.match(readme, /\*\*No `departments` block: nothing changes\.\*\*/)
  assert.match(readme, /\*\*A block and no machine setting starts no department lead\*\*/)
  assert.match(readme, /\| `departments` \|/)
})

test('services: a shell that only mentions the pattern, or a process in another office, is not this office\'s machinery', () => {
  const o = office({ machine: LOCAL })
  o.procs.set(902, { pid: 902, ppid: 1, ageSec: 60, cmd: '/bin/zsh -c grep onetalk-reader.mjs notes' })
  o.procs.set(903, { pid: 903, ppid: 1, ageSec: 60, cmd: 'node scripts/onetalk-reader.mjs' })
  const elsewhere = officeHealth(o.root, { home: o.home, procs: o.procs, now: NOW, checks: false, cwd: (pid) => (pid === 903 ? '/some/other/office' : null) })
  assert.doesNotMatch(elsewhere.line, /service running here/)
  const here = officeHealth(o.root, { home: o.home, procs: o.procs, now: NOW, checks: false, cwd: (pid) => (pid === 903 ? o.root : null) })
  assert.match(here.line, /service running here \(pid 903\)/)
  assert.doesNotMatch(here.line, /pid 902/)
})

test('⛔ a department lead never inherits office.json lead.start (it starts "lead", now an AICS alias); it starts by its own name', () => {
  const depts = { 'local-ops': { lead: 'ERP', desks: ['design'] }, 'customer-service': { lead: 'AICS', aliases: ['lead'], desks: ['customer'] } }
  const o = office({ machine: LOCAL, depts, cfg: { lead: { start: 'echo OLD-LEAD-LAUNCHER >> started.txt', wake: 'node bell.mjs' } } })
  const erp = allLeads(o.cfg).find((l) => l.session === 'ERP')
  assert.equal(erp.start, null)
  assert.equal(erp.wake, 'node bell.mjs', 'the doorbell is shared; its state is per lead (lead-bell)')
  const acts = o.healIt(o.health()).acts
  const r = acts.find((a) => a.act === 'restart' && a.desk === 'lead:ERP')
  assert.ok(r, JSON.stringify(acts))
  assert.ok(!o.started().includes('OLD-LEAD-LAUNCHER'), 'the old launcher was not run')
})

test('⛔ a half-written block does not let a lead out of the wall: a bad department id, and the old lead.session, are still leads', async () => {
  const o = office({ machine: LOCAL, depts: { 'Local Ops': { lead: 'ERP', desks: ['design'] } }, cfg: { lead: { session: 'old-lead' } } })
  assert.ok(departmentsCheck(o.root).findings.some((f) => /not a department id/.test(f.say)))
  for (const role of ['ERP', 'old-lead']) {
    assert.equal(whoIs(o.root, o.cfg, { name: role, env: {} }).kind, 'lead', role)
    const r = await decide(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' }, cwd: o.root }), { OFFICE_ROLE: role }, o.root)
    assert.equal(r.code, 2, `${role} is walled`)
  }
  // the old name is never started as a lead of its own
  assert.ok(!machineLeads(o.root, o.cfg).some((l) => l.session === 'old-lead'))
})

test('the lead bell keeps one state per lead when the office has departments', async () => {
  const { stateFile } = await import('../lib/lead-bell.mjs')
  assert.match(stateFile('/o'), /lead-bell-state\.json$/)
  assert.notEqual(stateFile('/o', 'ERP'), stateFile('/o', 'AICS'))
  assert.match(stateFile('/o', '工厂ERP'), /lead-bell-state-_[0-9a-f]+_[0-9a-f]+ERP\.json$/)
})

test('the board on a machine running both: its lead row is the owner\'s own (open) department lead, not key order', async () => {
  const { leadSessionName } = await import('../board/serve.mjs')
  const o = office({ machine: BOTH })
  assert.equal(leadSessionName(o.root), 'AICS')
  assert.equal(leadSessionName(office({ machine: LOCAL }).root), 'ERP')
})

test('⛔ the cutover order works: set the machine BEFORE office.json has a block; the ids are checked once it does', () => {
  const o = office({ depts: null })
  const r = setDepartments(o.root, ['local-ops', 'customer-service'])
  assert.ok(r.ok, r.lines.join('\n'))
  assert.match(r.lines.join('\n'), /declares no departments yet: this applies when office\.json adds them/)
  assert.equal(setDepartments(o.root, ['Local Ops']).ok, false, 'still a department id')
  // nothing changes before the block: one lead, every desk
  assert.deepEqual(machineLeads(o.root, o.cfg).map((l) => l.session), ['lead'])
  assert.equal(deskOn(readSwitch(o.root), 'customer').on, true)
  // and the buyer machinery's question is answered yes already, so it keeps running through the cutover
  assert.equal(inDepartment(o.root, 'customer-service').ok, true)
  assert.match(listDepartments(o.root).lines.join('\n'), /set for: local-ops, customer-service \(applies when/)
  // the block arrives: the setting is read; an id it does not declare is refused
  const withBlock = { ...o.cfg, departments: DEPTS }
  writeFileSync(join(o.root, 'office.json'), JSON.stringify(withBlock))
  assert.deepEqual(machineLeads(o.root, withBlock).map((l) => l.session), ['ERP', 'AICS'])
  writeFileSync(join(o.root, 'office.json'), JSON.stringify({ ...o.cfg, departments: { 'local-ops': DEPTS['local-ops'] } }))
  assert.match(readSwitch(o.root).error, /does not declare: customer-service/)
})

// local-cabinets-ops office.json on 2026-10-22 (#1472, the token benchmark),
// the shape that turned departments "on" with none in them
const BENCHMARK = { _note: 'Token usage benchmark: which group a Claude session\'s tokens count in.', order: ['AICS', 'ERP', 'CODING'], default: 'CODING', groups: { AICS: { sessions: ['^lead$', '^cs-'] }, ERP: { sessions: ['^desk-design-quotation(--|$)'] }, CODING: { sessions: ['^construction'] } } }

test('⛔ a "departments" block that names no lead is no departments: the lead keeps its restart, doorbell and open wall', () => {
  const o = office({ machine: BOTH, depts: null, cfg: { lead: { session: 'lead', aliases: ['工厂ERP'] }, departments: BENCHMARK } })
  const D = departmentsOf(o.cfg)
  assert.equal(D.on, false)
  assert.match(D.ignored, /names no department with a "lead" \(order, default, groups\)/)
  assert.deepEqual(machineLeads(o.root, o.cfg).map((l) => l.session), ['lead'], 'this machine runs its lead')
  assert.equal(allLeads(o.cfg)[0].open, true, 'wall.lead.open applies to it again')
  const h = o.health()
  assert.doesNotMatch(h.line, /department setting is broken/)
  assert.equal(h.leads.length, 1)
  assert.match(h.line, /read as no departments/)
  assert.equal(departmentsCheck(o.root).applicable, false)
  // a real department beside a note: the note is skipped, the department read
  const o2 = office({ machine: BOTH, depts: { _note: 'who runs what', ...DEPTS } })
  assert.deepEqual(departmentsOf(o2.cfg).list.map((d) => d.id), ['local-ops', 'customer-service'])
  assert.deepEqual(departmentsOf(o2.cfg).problems, [])
})

// 0.16.0: one schema for departments, the builders and the token page's groups
// (the lead, 2026-10-22: it replaces #1472's own "departments" shape)
const SCHEMA = {
  departments: {
    'customer-service': { label: 'AICS', dir: 'departments/aics', lead: 'AICS', aliases: ['lead', '工厂ERP'], desks: ['customer', 'selene'], open: true, sessions: ['^cs-', '^lead \\(\\d+\\)$'] },
    'local-ops': { label: 'ERP', dir: 'departments/local-ops', lead: 'ERP', desks: ['inventory'] },
  },
  construction: [{ name: 'construction', root: '.', model: 'opus', label: 'CODING' }],
  usage: { order: ['customer-service', 'local-ops', 'construction'], default: 'construction' },
}

test('the one schema: label, dir and sessions per department; builders are not leads', async () => {
  const { constructionOf } = await import('../lib/departments.mjs')
  const D = departmentsOf(SCHEMA)
  assert.deepEqual(D.list.map((d) => [d.id, d.label, d.dir, d.sessions.length]), [['customer-service', 'AICS', 'departments/aics', 2], ['local-ops', 'ERP', 'departments/local-ops', 0]])
  assert.deepEqual(D.problems, [])
  assert.deepEqual(constructionOf(SCHEMA), [{ name: 'construction', root: '.', model: 'opus', label: 'CODING', sessions: [] }])
  assert.deepEqual(allLeads(SCHEMA).map((l) => l.session), ['AICS', 'ERP'], '⛔ a builder gets no lead wall: the lead writes no file')
  assert.match(departmentsOf({ departments: { x: { lead: 'X', sessions: ['('] } } }).problems[0], /sessions pattern \( does not compile/)
})

test('usageGroupOf: by name in usage.order, then by folder, then the default', async () => {
  const { usageGroupOf } = await import('../lib/departments.mjs')
  const g = (name, cwd = null) => usageGroupOf(SCHEMA, { name, cwd }, { root: '/office' })?.label ?? null
  assert.deepEqual(['lead', 'lead (2)', '工厂ERP', 'AICS', 'cs-Eric-B', 'desk-selene', 'desk-selene--BT-261019-1'].map((n) => g(n)), Array(7).fill('AICS'))
  assert.deepEqual(['ERP', 'desk-inventory', 'desk-inventory--SC-1'].map((n) => g(n)), ['ERP', 'ERP', 'ERP'])
  assert.deepEqual(['construction', 'construction-2', 'alibaba-98'].map((n) => g(n)), ['CODING', 'CODING', 'CODING'])
  assert.equal(g('', '/office/departments/local-ops/inventory'), 'ERP', 'no name: its folder')
  assert.equal(g('desk-inventoryx'), 'CODING', 'a desk name is matched whole')
  assert.equal(g(''), null, 'no name and no folder: unknown')
  // a renamed desk: its session is its name now, and its id still counts
  assert.equal(usageGroupOf(SCHEMA, { name: 'desk-stock' }, { desks: [{ name: 'inventory', title: 'stock' }] }).label, 'ERP')
})

// 0.18.0: an alert is its department's, and each lead's bell hears its own
test('whose is an alert: said outright, else its desk, lead or sessions; anything else the office\'s', async () => {
  const { departmentOfSubject } = await import('../lib/departments.mjs')
  const c = { departments: { ...DEPTS, 'customer-service': { ...DEPTS['customer-service'], sessions: ['^cs-'] } } }
  assert.equal(departmentOfSubject(c, 'desk-customer'), 'customer-service')
  assert.equal(departmentOfSubject(c, 'selene'), 'customer-service', 'a desk id')
  assert.equal(departmentOfSubject(c, 'desk-design--SC-261019-1'), 'local-ops', 'a case session is its desk\'s')
  assert.equal(departmentOfSubject(c, 'ERP'), 'local-ops')
  assert.equal(departmentOfSubject(c, '工厂ERP'), 'customer-service', 'an alias')
  assert.equal(departmentOfSubject(c, 'cs-Eric-B'), 'customer-service')
  assert.equal(departmentOfSubject(c, 'alibaba-98@local-ops'), 'local-ops', 'said outright')
  assert.equal(departmentOfSubject(c, 'office-anything'), null)
  assert.equal(departmentOfSubject(c, 'x@nowhere'), null, 'an undeclared department is not one')
  assert.equal(departmentOfSubject({}, 'desk-customer'), null, 'no departments: everyone\'s')
})

test('⛔ each lead\'s bell hears its own department and the office\'s, never another department\'s', async () => {
  const { poll } = await import('../lib/lead-bell.mjs')
  const { writeAlert, alertsFile } = await import('../lib/alerts.mjs')
  const o = office({ machine: BOTH })
  const at = Date.now()
  writeAlert(o.root, o.cfg, { type: 'DESK-DEAD', subject: 'desk-customer', text: 'customer is down', now: at })
  writeAlert(o.root, o.cfg, { type: 'DESK-DEAD', subject: 'desk-inventory', text: 'inventory is down', now: at })
  writeAlert(o.root, o.cfg, { type: 'VERSION', subject: 'office-anything', text: 'unapproved plugin', now: at })
  writeAlert(o.root, o.cfg, { type: 'USAGE-LIMIT', subject: 'alibaba-98', department: 'local-ops', text: 'stuck on its limit', now: at })
  const ring = (lead) => poll(o.root, o.cfg, { now: at, lead, state: { offset: 0, file: alertsFile(o.root, o.cfg), files: {}, rung: {}, sent: [], held: 0 } }).lines.join('\n')
  const erp = ring('ERP'), aics = ring('AICS')
  assert.match(erp, /inventory is down/); assert.match(erp, /unapproved plugin/); assert.match(erp, /alibaba-98@local-ops/)
  assert.doesNotMatch(erp, /customer is down/)
  assert.match(aics, /customer is down/); assert.match(aics, /unapproved plugin/)
  assert.doesNotMatch(aics, /inventory is down|alibaba-98/)
  // an office with no departments: one bell, everything
  const one = office({ depts: null })
  writeAlert(one.root, one.cfg, { type: 'DESK-DEAD', subject: 'desk-customer', text: 'customer is down', now: at })
  assert.match(poll(one.root, one.cfg, { now: at, lead: 'lead', state: { offset: 0, file: alertsFile(one.root, one.cfg), files: {}, rung: {}, sent: [], held: 0 } }).lines.join('\n'), /customer is down/)
})

// 0.18.7: ERP's bell rang the buyers log and held buyer drafts, and pushed the owner on them
test('⛔ a bell file or ask is a department\'s too: by the desk folder holding the file, or by what it names', async () => {
  const { poll, fileRefusal } = await import('../lib/lead-bell.mjs')
  const { alertsFile } = await import('../lib/alerts.mjs')
  const bell = { files: [
    { name: 'buyers', path: 'desks/customer/runtime/lead-alerts.log', match: ' STALL ' },
    { name: 'stock', path: 'desks/inventory/runtime/lead-alerts.log', match: ' LOW ' },
    { name: 'office', path: 'desks/shared/runtime/lead-alerts.log', match: ' DOWN ' },
    { name: 'named', path: 'desks/shared/runtime/named.log', match: '.', department: 'customer-service' },
  ], asks: [
    { name: 'held', command: 'printf "HD-1\\tbuyer draft held\\n"', department: 'customer-service' },
    { name: 'inbox', command: 'printf "LM-1\\toffice message\\n"' },
    { name: 'typo', command: 'printf "X-1\\tsaid to nobody\\n"', department: 'custmer-service' },
  ] }
  const o = office({ machine: BOTH, cfg: { lead: { bell } } })
  const logs = { customer: 'x STALL BT-1 cs-martin waiting', inventory: 'x LOW oak 2 left', shared: 'x DOWN printer' }
  for (const [d, l] of Object.entries(logs)) { mkdirSync(join(o.root, 'desks', d, 'runtime'), { recursive: true }); writeFileSync(join(o.root, 'desks', d, 'runtime', 'lead-alerts.log'), '') }
  writeFileSync(join(o.root, 'desks', 'shared', 'runtime', 'named.log'), '')
  const at = Date.now()
  const ring = (lead, st) => poll(o.root, o.cfg, { now: at, lead, state: st })
  const fresh = () => ({ offset: 0, file: alertsFile(o.root, o.cfg), files: {}, rung: {}, sent: [], held: 0 })
  // first poll learns the files' ends; then each gets a line
  const e1 = ring('ERP', fresh()), a1 = ring('AICS', fresh())
  const erp = e1.state, aics = a1.state
  for (const [d, l] of Object.entries(logs)) writeFileSync(join(o.root, 'desks', d, 'runtime', 'lead-alerts.log'), l + '\n')
  writeFileSync(join(o.root, 'desks', 'shared', 'runtime', 'named.log'), 'x first-reply due\n')
  // asks ring on the first poll, file lines on the second
  const E = [...e1.lines, ...ring('ERP', { ...erp, sent: [] }).lines].join('\n'), A = [...a1.lines, ...ring('AICS', { ...aics, sent: [] }).lines].join('\n')
  assert.doesNotMatch(E, /cs-martin|first-reply|buyer draft held/, 'ERP hears no buyer line')
  assert.match(E, /oak 2 left/); assert.match(E, /printer/); assert.match(E, /office message/)
  assert.match(E, /said to nobody/, 'an undeclared department is the office\'s: heard, never lost')
  assert.match(A, /cs-martin/); assert.match(A, /first-reply/); assert.match(A, /buyer draft held/); assert.match(A, /printer/); assert.match(A, /office message/)
  assert.doesNotMatch(A, /oak 2 left/)
  assert.match(A, /said to nobody/, 'by both leads')
  // a moved desk: its folder is its department's
  const m = office({ machine: BOTH, depts: { ...DEPTS, 'local-ops': { ...DEPTS['local-ops'], dir: 'departments/local-ops', desks: ['design', 'inventory', 'moved'] } }, cfg: { lead: { bell: { files: [{ name: 'moved', path: 'departments/local-ops/moved/runtime/x.log', match: '.' }] } } } })
  mkdirSync(join(m.root, 'departments', 'local-ops', 'moved', 'runtime'), { recursive: true })
  writeFileSync(join(m.root, 'departments', 'local-ops', 'moved', 'desk.json'), JSON.stringify({ name: 'moved', kind: 'knowledge', port: 9610 }))
  writeFileSync(join(m.root, 'departments', 'local-ops', 'moved', 'runtime', 'x.log'), '')
  const f2 = () => ({ offset: 0, file: alertsFile(m.root, m.cfg), files: {}, rung: {}, sent: [], held: 0 })
  const me = poll(m.root, m.cfg, { now: at, lead: 'ERP', state: f2() }).state, ma = poll(m.root, m.cfg, { now: at, lead: 'AICS', state: f2() }).state
  writeFileSync(join(m.root, 'departments', 'local-ops', 'moved', 'runtime', 'x.log'), 'moved desk line\n')
  assert.match(poll(m.root, m.cfg, { now: at, lead: 'ERP', state: me }).lines.join('\n'), /moved desk line/)
  assert.doesNotMatch(poll(m.root, m.cfg, { now: at, lead: 'AICS', state: ma }).lines.join('\n'), /moved desk line/)
  // ⛔ a link into another desk is judged where it really is, and refused
  const L = office({ machine: BOTH, cfg: { lead: { bell: { files: [{ name: 'buyers', path: 'desks/customer/runtime/lead-alerts.log', match: '.' }] } } } })
  mkdirSync(join(L.root, 'desks', 'customer', 'runtime'), { recursive: true }); mkdirSync(join(L.root, 'desks', 'inventory', 'runtime'), { recursive: true })
  writeFileSync(join(L.root, 'desks', 'inventory', 'runtime', 'lead-alerts.log'), '')
  symlinkSync(join(L.root, 'desks', 'inventory', 'runtime', 'lead-alerts.log'), join(L.root, 'desks', 'customer', 'runtime', 'lead-alerts.log'))
  const fl = () => ({ offset: 0, file: alertsFile(L.root, L.cfg), files: {}, rung: {}, sent: [], held: 0 })
  const ls = poll(L.root, L.cfg, { now: at, lead: 'AICS', state: fl() }).state
  writeFileSync(join(L.root, 'desks', 'inventory', 'runtime', 'lead-alerts.log'), 'erp stock line\n')
  const lA = poll(L.root, L.cfg, { now: at, lead: 'AICS', state: ls }).lines.join('\n')
  assert.doesNotMatch(lA, /erp stock line/, 'AICS does not hear ERP through a link')
  assert.match(fileRefusal(L.root, 'desks/customer/runtime/lead-alerts.log'), /a link into the desk inventory, not the desk customer/)
  // a moved desk's old link lands in the same desk: allowed, and its department's
  const V = office({ machine: BOTH, depts: { ...DEPTS, 'customer-service': { ...DEPTS['customer-service'], dir: 'departments/aics' } } })
  mkdirSync(join(V.root, 'departments', 'aics'), { recursive: true })
  renameSync(join(V.root, 'desks', 'customer'), join(V.root, 'departments', 'aics', 'customer'))
  symlinkSync(join(V.root, 'departments', 'aics', 'customer'), join(V.root, 'desks', 'customer'))
  mkdirSync(join(V.root, 'departments', 'aics', 'customer', 'runtime'))
  writeFileSync(join(V.root, 'departments', 'aics', 'customer', 'runtime', 'lead-alerts.log'), '')
  assert.equal(fileRefusal(V.root, 'desks/customer/runtime/lead-alerts.log'), null)
  const vc = { ...V.cfg, lead: { bell: { files: [{ name: 'buyers', path: 'desks/customer/runtime/lead-alerts.log', match: '.' }] } } }
  const fv = () => ({ offset: 0, file: alertsFile(V.root, vc), files: {}, rung: {}, sent: [], held: 0 })
  const ve = poll(V.root, vc, { now: at, lead: 'ERP', state: fv() }).state, va = poll(V.root, vc, { now: at, lead: 'AICS', state: fv() }).state
  writeFileSync(join(V.root, 'departments', 'aics', 'customer', 'runtime', 'lead-alerts.log'), 'buyer via old link\n')
  assert.match(poll(V.root, vc, { now: at, lead: 'AICS', state: va }).lines.join('\n'), /buyer via old link/)
  assert.doesNotMatch(poll(V.root, vc, { now: at, lead: 'ERP', state: ve }).lines.join('\n'), /buyer via old link/)
  // no departments: one bell hears every file and ask
  const one = office({ depts: null, cfg: { lead: { session: 'lead', bell: { asks: bell.asks } } } })
  assert.match(poll(one.root, one.cfg, { now: at, lead: 'lead', state: fresh() }).lines.join('\n'), /buyer draft held/)
})

test('the roll-call per department: health says each department\'s count', () => {
  const o = office({ machine: BOTH, depts: { 'local-ops': { ...DEPTS['local-ops'], label: 'ERP' }, 'customer-service': { ...DEPTS['customer-service'], label: 'AICS' } } })
  o.live('desk-customer', join(o.root, 'desks', 'customer'), 801)
  const h = o.health()
  assert.match(h.summary ?? h.line, /desks up \(ERP 0\/2, AICS 1\/2\)/)
  assert.equal(h.desks.find((d) => d.name === 'customer').department, 'customer-service')
})
