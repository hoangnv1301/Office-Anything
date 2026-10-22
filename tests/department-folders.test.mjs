// DEPARTMENT FOLDERS (0.16.0). A department's desks may live in its own folder,
// departments/<dept>/<desk> (office.json departments.<id>.dir). Every real
// office had all its desks in desks/ when this shipped, so each path is driven
// here through an office with NO desks/ at all: a site that still builds
// desks/<id> by hand finds nothing, and reads as fine.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { officeRoster, rosterSafe, deskDir, deskAt, deskRoots, hasDesks, sessionOf } from '../lib/desk.mjs'
import { findOffice, whoIs, readOfficeConfig } from '../lib/office.mjs'
import { officeHealth } from '../lib/health.mjs'
import { formOf } from '../lib/procs.mjs'
import { report as readable } from '../checks/desk-readable.mjs'
import { report as departmentsCheck } from '../checks/departments.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const WALL = join(HERE, '..', 'hooks', 'desk-wall.mjs')
const GATE = join(HERE, '..', 'hooks', 'send-wall-gate.mjs')
const DEPTS = {
  'customer-service': { label: 'AICS', dir: 'departments/aics', lead: 'AICS', aliases: ['lead'], desks: ['customer'], open: true },
  'local-ops': { label: 'ERP', dir: 'departments/local-ops', lead: 'ERP', desks: ['inventory'] },
}
const desk = (root, rel, json) => { mkdirSync(join(root, rel, 'runtime'), { recursive: true }); writeFileSync(join(root, rel, 'desk.json'), JSON.stringify(json)); writeFileSync(join(root, rel, 'runtime', 'token.json'), '{"t":"secret"}') }
function office({ moved = true, extra = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oa-dfold-'))
  const at = (id) => (moved ? join('departments', id === 'customer' ? 'aics' : 'local-ops', id) : join('desks', id))
  desk(root, at('customer'), { name: 'customer', kind: 'channel', port: 9801, wake: 'node scripts/wake.mjs' })
  desk(root, at('inventory'), { name: 'inventory', kind: 'knowledge', port: 9802 })
  // the department's own files beside its desks: not a desk
  mkdirSync(join(root, 'departments', 'aics', 'docs'), { recursive: true })
  writeFileSync(join(root, 'departments', 'aics', 'CLAUDE.md'), '# AICS\n')
  writeFileSync(join(root, 'office.json'), JSON.stringify({ roleEnv: 'OFFICE_ROLE', departments: DEPTS, wall: { failClosed: true }, ...extra }))
  return { root, dir: (id) => join(root, at(id)) }
}

test('⛔ no desk moved: the roster is exactly what desks/ alone gave', () => {
  const o = office({ moved: false })
  const before = rosterSafe(join(o.root, 'desks'))
  const now = officeRoster(o.root)
  assert.deepEqual(now.desks.map((d) => [d.name, d.dir, d.department]), before.desks.map((d) => [d.name, d.dir, null]))
  assert.deepEqual(now.broken, before.broken)
  assert.equal(deskDir(o.root, 'inventory'), join(o.root, 'desks', 'inventory'))
  assert.equal(deskDir(o.root, 'nobody'), join(o.root, 'desks', 'nobody'), 'a new desk goes to desks/')
})

test('moved: found from a desk folder, read with its department, and the department\'s own folders are not desks', () => {
  const o = office()
  assert.equal(hasDesks(o.root), true)
  assert.equal(findOffice(o.dir('customer')), o.root, 'no desks/ and still an office')
  const r = officeRoster(o.root)
  assert.deepEqual(r.desks.map((d) => [d.name, d.department, relative(o.root, d.dir)]), [['customer', 'customer-service', 'departments/aics/customer'], ['inventory', 'local-ops', 'departments/local-ops/inventory']])
  assert.deepEqual(r.broken, [])
  assert.deepEqual(deskRoots(o.root).map((x) => relative(o.root, x.dir)), ['desks', 'departments/aics', 'departments/local-ops'])
  assert.equal(deskDir(o.root, 'inventory'), o.dir('inventory'))
  assert.equal(sessionOf(o.root, 'customer'), 'desk-customer')
  assert.equal(deskAt(o.root, join(o.root, 'departments', 'aics', 'docs')), null)
  assert.equal(deskAt(o.root, join(o.root, 'departments', 'aics')), null)
  assert.deepEqual(deskAt(o.root, join(o.dir('customer'), 'runtime')), { id: 'customer', dir: o.dir('customer'), department: 'customer-service' })
})

test('moved: who is who by folder; the department lead\'s folder is not a desk', () => {
  const o = office()
  const cfg = readOfficeConfig(o.root)
  assert.deepEqual(whoIs(o.root, cfg, { cwd: o.dir('customer'), env: {}, name: '' }), { kind: 'desk', desk: 'customer', dir: o.dir('customer'), role: 'desk-customer' })
  assert.equal(whoIs(o.root, cfg, { cwd: join(o.root, 'departments', 'aics'), env: {}, name: '' }), null)
  assert.equal(whoIs(o.root, cfg, { cwd: join(o.root, 'departments', 'aics'), env: {}, name: 'AICS' }).kind, 'lead')
  assert.equal(whoIs(o.root, cfg, { cwd: o.root, env: {}, name: 'desk-inventory' }).dir, o.dir('inventory'))
})

test('⛔ moved: the checks still look, and health still sees the desks', () => {
  const o = office()
  const c = readable(o.root)
  assert.equal(c.applicable, true, 'not "not applicable": there are desks, in department folders')
  assert.equal(c.code, 0)
  const h = officeHealth(o.root, { home: mkdtempSync(join(tmpdir(), 'oa-dfold-h-')), procs: new Map([[1, { pid: 1, ppid: 0, ageSec: 1e6, cmd: 'launchd' }]]), checks: false, cwd: () => null })
  assert.notEqual(h.code, 7, h.line)
  assert.deepEqual(h.desks.map((d) => d.name), ['customer', 'inventory'])
})

test('⛔ one id, one folder; a desk in the wrong department\'s folder is red', () => {
  const o = office()
  desk(o.root, join('desks', 'inventory'), { name: 'inventory', kind: 'knowledge', port: 9803 })
  const r = officeRoster(o.root)
  assert.deepEqual(r.desks.map((d) => d.name), ['customer'])
  assert.match(r.broken.find((b) => b.desk === 'inventory').why, /desk inventory is in two folders \(desks\/inventory and departments\/local-ops\/inventory\)/)
  const o2 = office()
  desk(o2.root, join('departments', 'aics', 'stray'), { name: 'stray', kind: 'knowledge', port: 9804 })
  writeFileSync(join(o2.root, 'office.json'), JSON.stringify({ departments: { ...DEPTS, 'local-ops': { ...DEPTS['local-ops'], desks: ['inventory', 'stray'] } } }))
  const c = departmentsCheck(o2.root)
  assert.equal(c.code, 4)
  assert.match(c.findings.map((f) => f.say).join('\n'), /sits in customer-service's folder but office\.json lists it under local-ops/)
})

// the wall, through its real entrypoint, a desk identified by where it stands
const run = (o, at, tool_name, tool_input) => {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'oa-dfold-cfg-')) }
  delete env.OFFICE_ROLE
  delete env.CLAUDE_PROJECT_DIR
  return spawnSync(process.execPath, [WALL], { input: JSON.stringify({ tool_name, tool_input, cwd: at }), encoding: 'utf8', env, cwd: at }).status
}

test('⛔ moved: a desk in one department reads no other desk\'s runtime/, by any tool', () => {
  const o = office()
  const me = o.dir('customer'), other = join(o.dir('inventory'), 'runtime', 'token.json')
  assert.equal(run(o, me, 'Read', { file_path: other }), 2, 'Read')
  assert.equal(run(o, me, 'Bash', { command: `cat ${other}` }), 2, 'Bash cat')
  assert.equal(run(o, me, 'Bash', { command: 'grep -r secret ../../local-ops' }), 2, 'Bash grep -r')
  assert.equal(run(o, me, 'Grep', { pattern: 'secret', path: join(o.root, 'departments') }), 2, 'Grep above the departments')
  assert.equal(run(o, me, 'Bash', { command: `cd ${o.dir('inventory')} && ls` }), 2, 'cd into another desk')
  // its own runtime/, and the office's code, are its to read
  assert.equal(run(o, me, 'Read', { file_path: join(me, 'runtime', 'token.json') }), 0)
  assert.equal(run(o, me, 'Read', { file_path: join(o.root, 'office.json') }), 0)
  assert.equal(run(o, me, 'Write', { file_path: join(me, 'facts.md'), content: 'x' }), 0)
  assert.equal(run(o, me, 'Write', { file_path: join(o.dir('inventory'), 'facts.md'), content: 'x' }), 2, 'writes stay in its own folder')
})

test('⛔ moved: office.json unreadable, a session standing in a department desk is still refused', () => {
  const o = office()
  writeFileSync(join(o.root, 'office.json'), '{ broken')
  assert.equal(run(o, o.dir('customer'), 'Read', { file_path: join(o.root, 'README.md') }), 2)
})

test('⛔ moved: the send wall gate still stops a sender for a knowledge desk', () => {
  const o = office()
  const gate = (file_path) => spawnSync(process.execPath, [GATE], { input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path } }), encoding: 'utf8' })
  const r = gate(join(o.dir('inventory'), 'runtime', 'send', 'send.mjs'))
  assert.equal(r.status, 2, r.stderr)
  assert.match(r.stderr, /inventory is a KNOWLEDGE desk/)
  assert.equal(gate(join(o.dir('customer'), 'runtime', 'send', 'send.mjs')).status, 2, 'a dark channel desk: not before it is live')
})

test('moved: a doorbell is proven this office\'s by the desk\'s real folder', () => {
  const o = office()
  const d = officeRoster(o.root).desks.find((x) => x.name === 'customer')
  const abs = join(o.dir('customer'), 'scripts', 'wake.mjs')
  assert.equal(formOf({ cmd: `node ${abs}` }, d, o.root), 'absolute')
})

// ⛔ ONE OWNER FOR THE PATH. 87 sites built desks/<id> by hand; the next one
// added is the one a review misses. Only lib/desk.mjs may.
test('⛔ no hand-built desk path outside lib/desk.mjs', () => {
  const bad = []
  const walk = (d) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) { if (!['node_modules', 'ui', 'dist'].includes(e)) walk(p) } else if (/\.mjs$/.test(e)) bad.push(...scan(p)) } }
  const scan = (p) => readFileSync(p, 'utf8').split('\n').flatMap((l, i) => (/join\([^)]*'desks'\s*,|rosterSafe\(join\(/.test(l) && !/^\s*\/\//.test(l) ? [`${relative(join(HERE, '..'), p)}:${i + 1}: ${l.trim().slice(0, 100)}`] : []))
  for (const d of ['lib', 'hooks', 'checks', 'board']) walk(join(HERE, '..', d))
  assert.deepEqual(bad.filter((x) => !x.startsWith('lib/desk.mjs:')), [])
})

test('⛔ moved: start resumes the desk\'s own conversation from under its old folder, copied, never moved', async () => {
  const { planStart, carryOver, projectDirOf } = await import('../lib/conversation.mjs')
  const o = office()
  const dir = mkdtempSync(join(tmpdir(), 'oa-dfold-claude-'))
  const id = '11111111-2222-4333-8444-555555555555'
  const old = projectDirOf(join(o.root, 'desks', 'inventory'), dir)
  mkdirSync(old, { recursive: true })
  writeFileSync(join(old, id + '.jsonl'), JSON.stringify({ type: 'custom-title', customTitle: 'desk-inventory' }) + '\n')
  const plan = planStart({ tag: 'desk-inventory', cwd: o.dir('inventory'), before: join(o.root, 'desks', 'inventory'), dir })
  assert.equal(plan.resume, id)
  assert.match(plan.why, /before the move/)
  assert.equal(carryOver(plan, o.dir('inventory'), dir), null)
  assert.ok(statSync(join(projectDirOf(o.dir('inventory'), dir), id + '.jsonl')).isFile())
  assert.ok(statSync(join(old, id + '.jsonl')).isFile(), 'the original stays')
  // not moved: nothing is looked up twice
  assert.equal(planStart({ tag: 'desk-x', cwd: o.dir('inventory'), dir: mkdtempSync(join(tmpdir(), 'oa-dfold-c2-')) }).resume, null)
})

test('⛔ a move\'s symlink desks/x -> departments/<dept>/x is one desk, the department\'s; two real folders stay broken', async () => {
  const { symlinkSync, rmSync } = await import('node:fs')
  const o = office()
  mkdirSync(join(o.root, 'desks'), { recursive: true })
  symlinkSync(o.dir('inventory'), join(o.root, 'desks', 'inventory'))
  const r = officeRoster(o.root)
  assert.deepEqual(r.broken, [])
  assert.deepEqual(r.desks.map((d) => [d.name, d.department]), [['customer', 'customer-service'], ['inventory', 'local-ops']])
  assert.equal(deskDir(o.root, 'inventory'), o.dir('inventory'), 'the real folder, not the link')
  // a session still standing in the old path is that desk
  assert.equal(whoIs(o.root, readOfficeConfig(o.root), { cwd: join(o.root, 'desks', 'inventory'), env: {}, name: '' }).desk, 'inventory')
  rmSync(join(o.root, 'desks', 'inventory'))
})

test('⛔ through the old symlink path, another desk\'s runtime/ is still not read', async () => {
  const { symlinkSync } = await import('node:fs')
  const o = office()
  mkdirSync(join(o.root, 'desks'), { recursive: true })
  symlinkSync(o.dir('inventory'), join(o.root, 'desks', 'inventory'))
  const me = o.dir('customer')
  assert.equal(run(o, me, 'Read', { file_path: join(o.root, 'desks', 'inventory', 'runtime', 'token.json') }), 2)
  assert.equal(run(o, me, 'Bash', { command: `cat ${join(o.root, 'desks', 'inventory', 'runtime', 'token.json')}` }), 2)
})

test('⛔ the lead\'s Bash list is matched by what a command runs, from any depth; a desk\'s refusals hold one level deeper', () => {
  const o = office({ extra: { wall: { failClosed: true, lead: { bash: ['^node scripts/desk/ops\\.mjs ask '] }, deny: [{ pattern: '^node scripts/desk/ops\\.mjs\\s+approve', why: 'approving is the lead\'s' }] } } })
  mkdirSync(join(o.root, 'scripts', 'desk'), { recursive: true })
  writeFileSync(join(o.root, 'scripts', 'desk', 'ops.mjs'), '')
  const as = (at, role, command) => {
    const env = { ...process.env, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'oa-dfold-cfg-')), OFFICE_ROLE: role }
    delete env.CLAUDE_PROJECT_DIR
    return spawnSync(process.execPath, [WALL], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: at }), encoding: 'utf8', env, cwd: at }).status
  }
  const aics = join(o.root, 'departments', 'aics')
  assert.equal(as(aics, 'AICS', 'node ../../scripts/desk/ops.mjs ask items'), 0, 'from the department: the root script')
  assert.equal(as(o.root, 'AICS', 'node scripts/desk/ops.mjs ask items'), 0, 'from the root, as before')
  assert.equal(as(aics, 'AICS', 'node scripts/desk/ops.mjs ask items'), 2, '⛔ typed bare in the department it is departments/aics/scripts/…, not the listed one')
  assert.equal(as(aics, 'AICS', 'node ../../scripts/desk/ops.mjs approve 1'), 2, 'unlisted stays refused')
  // a desk one level deeper than desks/<x> still meets the office's refusals
  assert.equal(as(o.dir('customer'), 'desk-customer', 'node ../../../scripts/desk/ops.mjs approve 1'), 2)
  assert.equal(as(o.dir('customer'), 'desk-customer', 'node ../../../scripts/desk/ops.mjs ask items'), 0)
})

test('boot text: {up} is the way to the office root from where the session stands, {lead} its own lead', async () => {
  const { bootLines } = await import('../hooks/desk-boot.mjs')
  const o = office({ extra: { boot: { text: { outro: 'Run node {up}scripts/desk/ops.mjs; ask {lead}.' }, lead: ['You are {lead}; the scripts are at {up}scripts/.'] } } })
  const cfg = readOfficeConfig(o.root)
  const desk = bootLines(o.root, { kind: 'desk', desk: 'customer', dir: o.dir('customer'), role: 'desk-customer' }, cfg, o.dir('customer'))
  assert.equal(desk.at(-1), 'Run node ../../../scripts/desk/ops.mjs; ask AICS.')
  const lead = bootLines(o.root, { kind: 'lead', role: 'ERP' }, cfg, join(o.root, 'departments', 'local-ops'))
  assert.equal(lead[0], 'You are ERP; the scripts are at ../../scripts/.')
  const atRoot = office({ moved: false, extra: { boot: { text: { outro: 'node {up}scripts/x' } } } })
  assert.equal(bootLines(atRoot.root, { kind: 'desk', desk: 'inventory', dir: atRoot.dir('inventory'), role: 'desk-inventory' }, readOfficeConfig(atRoot.root), atRoot.dir('inventory')).at(-1), 'node ../../scripts/x')
})

test('⛔ a path that climbs back out through a folder is never rewritten: the shell follows links, path.resolve does not', async () => {
  const { symlinkSync } = await import('node:fs')
  const o = office({ extra: { wall: { failClosed: true, lead: { bash: ['^node scripts/desk/ops\\.mjs ask '] } } } })
  mkdirSync(join(o.root, 'scripts', 'desk'), { recursive: true })
  writeFileSync(join(o.root, 'scripts', 'desk', 'ops.mjs'), '')
  mkdirSync(join(o.root, 'desks'), { recursive: true })
  symlinkSync(o.dir('inventory'), join(o.root, 'desks', 'inventory'))
  const as = (at, command) => {
    const env = { ...process.env, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'oa-dfold-cfg-')), OFFICE_ROLE: 'AICS' }
    delete env.CLAUDE_PROJECT_DIR
    return spawnSync(process.execPath, [WALL], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: at }), encoding: 'utf8', env, cwd: at }).status
  }
  const aics = join(o.root, 'departments', 'aics')
  // lexically scripts/desk/ops.mjs; the shell reads departments/scripts/desk/ops.mjs
  assert.equal(as(aics, 'node ../../desks/inventory/../../scripts/desk/ops.mjs ask items'), 2)
  assert.equal(as(aics, 'node ../../scripts/desk/ops.mjs ask items'), 0, 'a plain climb to the root still matches')
  // standing IN the link: ../../ climbs from departments/local-ops/inventory (the kernel's view) to departments/
  const link = join(o.root, 'desks', 'inventory')
  mkdirSync(join(o.root, 'departments', 'scripts', 'desk'), { recursive: true })
  assert.equal(as(link, 'node ../../scripts/desk/ops.mjs ask items'), 2, 'from the link it is departments/scripts/…, not the listed one')
})
