// DEPARTMENTS (0.12.0). One office, a lead per department: Local Ops (ERP, one
// per person, machine and account) and Customer Service (AICS, the owner's Mac
// only). Every real office had no departments block when this shipped, so
// each path is driven here through three machines: one that runs Local Ops
// only, one that runs both, and one with no setting. And an office with no
// block, which must behave exactly as before.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
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
