// SESSIONS CARRY THEIR DEPARTMENT (0.20.0). The owner, 2026-10-23: a desk's
// session is <dept prefix>-<id> (aics-web-design, erp-inventory), its cases
// <session>--<key>, buyer teammates aics-alibaba-<Buyer>; and four AICS desks
// were renamed, folders included (alibaba-customer-service -> alibaba).
// office.json departments.<id>.prefix, desk.json "formerly". Name -> desk has
// ONE owner (lib/desk.mjs deskOfSession, exact match on d.session / d.names),
// and the walker below fails on a hand-built "desk-" + x anywhere else.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { officeRoster, deskOfSession, deskShaped, DESK_NAME, sessionOf } from '../lib/desk.mjs'
import { whoIs, childOf } from '../lib/office.mjs'
import { departmentsOf, usageGroupOf, departmentOfSubject } from '../lib/departments.mjs'
import { targetsOf, launchCommand } from '../lib/start.mjs'
import { planStart, projectDirOf } from '../lib/conversation.mjs'
import { childName } from '../lib/cases.mjs'
import { officeHealth } from '../lib/health.mjs'
import { compileWall, judge } from '../lib/wall.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOOK = join(REPO, 'hooks', 'desk-wall.mjs')

// ⛔ THE GUARD THAT WALKS THE CODE. Every real desk was desk-<id>, so a site
// building or parsing that shape by hand passes every other test.
test('⛔ no file outside lib/desk.mjs builds or parses a desk session name by its shape', () => {
  const files = []
  const walk = (d) => { for (const e of readdirSync(d)) { if (e === 'node_modules' || e === 'ui' || e.startsWith('.')) continue; const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (/\.m?js$/.test(e)) files.push(p) } }
  for (const d of ['lib', 'hooks', 'board', 'checks', 'scripts']) walk(join(REPO, d))
  const BAD = [/'desk-' ?\+/, /"desk-" ?\+/, /`desk-\$\{/, /\/\^desk-/, /startsWith\('desk-'\)/, /\.slice\(5\)/, /['"`/^]cs-/]
  const hits = []
  for (const f of files) {
    if (relative(REPO, f) === join('lib', 'desk.mjs')) continue
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '')
      if (BAD.some((re) => re.test(code))) hits.push(`${relative(REPO, f)}:${i + 1}: ${line.trim().slice(0, 100)}`)
    })
  }
  assert.deepEqual(hits, [], 'build names with d.session / d.names, parse with deskOfSession')
  assert.ok(files.length > 30, 'the walk saw the code')
})

function desk(root, rel, j) { mkdirSync(join(root, rel, 'runtime'), { recursive: true }); writeFileSync(join(root, rel, 'desk.json'), JSON.stringify(j)) }
const CASE = '^SC-\\d{6}-\\d{3,}$'
function office({ wall = { failClosed: true }, extra = {}, prefixes = true } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'oa-names-')))
  desk(root, 'departments/aics/alibaba', { name: 'alibaba', kind: 'knowledge', port: 9601, formerly: ['alibaba-customer-service'] })
  desk(root, 'departments/aics/web', { name: 'web', kind: 'knowledge', port: 9602, formerly: ['web-customer-service'] })
  desk(root, 'departments/aics/web-design', { name: 'web-design', kind: 'knowledge', port: 9603, formerly: ['design'], perCase: { kind: 'design', key: CASE } })
  desk(root, 'departments/local-ops/inventory', { name: 'inventory', kind: 'knowledge', port: 9604 })
  desk(root, 'desks/billing', { name: 'billing', kind: 'knowledge', port: 9605 })
  mkdirSync(join(root, 'lib'))
  const departments = {
    aics: { lead: 'AICS', desks: ['alibaba', 'web', 'web-design'], ...(prefixes ? { prefix: 'aics' } : {}) },
    'local-ops': { lead: 'ERP', desks: ['inventory'], ...(prefixes ? { prefix: 'erp' } : {}) },
  }
  const cfg = { roleEnv: 'OFFICE_ROLE', departments, wall, ...extra }
  writeFileSync(join(root, 'office.json'), JSON.stringify(cfg))
  mkdirSync(join(root, '.office')); writeFileSync(join(root, '.office', 'local.json'), JSON.stringify({ departments: ['aics', 'local-ops'] }))
  return { root, cfg }
}

test('the roster: <prefix>-<id> per department, desk-<id> outside one, and every old name a desk answers to', () => {
  const { root } = office()
  const by = Object.fromEntries(officeRoster(root).desks.map((d) => [d.name, d]))
  assert.deepEqual(Object.fromEntries(Object.entries(by).map(([k, d]) => [k, d.session])), { alibaba: 'aics-alibaba', billing: 'desk-billing', inventory: 'erp-inventory', web: 'aics-web', 'web-design': 'aics-web-design' })
  assert.deepEqual(by.alibaba.names, ['aics-alibaba', 'desk-alibaba', 'aics-alibaba-customer-service', 'desk-alibaba-customer-service'])
  assert.deepEqual(by.inventory.names, ['erp-inventory', 'desk-inventory'])
  assert.equal(sessionOf(root, 'web-design'), 'aics-web-design')
  assert.equal(officeRoster(root).broken.length, 0, JSON.stringify(officeRoster(root).broken))
})

test('⛔ name -> desk is an exact match: aics-web-design is web-design, not web\'s teammate; a buyer teammate is no desk', () => {
  const { root } = office()
  const ds = officeRoster(root).desks
  const of = (n) => { const h = deskOfSession(ds, n); return h ? [h.desk.name, h.key, h.stale] : null }
  assert.deepEqual(of('aics-web-design'), ['web-design', null, false])
  assert.deepEqual(of('aics-web'), ['web', null, false])
  assert.deepEqual(of('aics-web-design--SC-261022-191'), ['web-design', 'SC-261022-191', false])
  assert.deepEqual(of('desk-alibaba-customer-service'), ['alibaba', null, true], 'its session before the rename')
  assert.deepEqual(of('desk-design--SC-261022-191'), ['web-design', 'SC-261022-191', true], 'a case opened before it')
  assert.deepEqual(of('desk-inventory'), ['inventory', null, true])
  for (const n of ['aics-alibaba-Keisha', 'aics-web-designer', 'aics-', 'aics-web--', 'erp-alibaba', 'web']) assert.equal(of(n), null, n)
  assert.equal(deskShaped(root, 'aics-anything'), true)
  assert.equal(deskShaped(root, 'erp-x'), true)
  assert.equal(deskShaped(root, 'AICS'), false)
  assert.equal(childName(ds.find((d) => d.name === 'web-design'), 'SC-261022-191'), 'aics-web-design--SC-261022-191')
  assert.deepEqual(childOf(root, 'aics-web-design--SC-261022-191')?.parent, 'web-design')
  assert.equal(childOf(root, 'aics-web-design--SC-1'), null, 'a key its regex does not match')
})

test('identity (whoIs): a prefixed desk, its case, an old name; a prefixed name that is no desk claims one', () => {
  const { root, cfg } = office()
  const who = (name) => whoIs(root, cfg, { cwd: root, env: {}, name })
  assert.deepEqual([who('aics-web-design').kind, who('aics-web-design').desk], ['desk', 'web-design'])
  assert.equal(who('aics-web-design--SC-261022-191').caseKey, 'SC-261022-191')
  assert.equal(who('desk-alibaba-customer-service').desk, 'alibaba')
  assert.equal(who('desk-alibaba-customer-service').stale, true)
  assert.equal(who('erp-inventory').desk, 'inventory')
  assert.equal(who('aics-nobody').kind, 'unknown')
  assert.equal(who('aics-alibaba-Keisha').kind, 'unknown', 'never resolved by its name: the office module maps it, or it is refused')
  assert.equal(who('AICS').kind, 'lead')
  assert.equal(who('repo-dev-1'), null, 'a developer')
})

// the hook, as the CLI runs it: a session registered under this test's pid
function as(root, name, tool_name, tool_input, { cwd = root } = {}) {
  const cfg = mkdtempSync(join(tmpdir(), 'oa-names-cfg-'))
  mkdirSync(join(cfg, 'sessions'))
  if (name) writeFileSync(join(cfg, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, name }))
  const env = { ...process.env, CLAUDE_CONFIG_DIR: cfg }; delete env.OFFICE_ROLE; delete env.CLAUDE_PROJECT_DIR
  return spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name, tool_input, cwd }), encoding: 'utf8', env, cwd, timeout: 15000 }).status
}

test('⛔ the wall hook: a prefixed desk is walled, an unknown prefixed name refused, a mapped teammate is its desk, an unmapped one refused', () => {
  const MOD = 'export function alias(n) { return /^aics-alibaba-[A-Z]/.test(n) ? "aics-alibaba" : null }'
  const { root } = office({ wall: { failClosed: true, module: 'lib/extra.mjs', aliasNames: ['^aics-alibaba-[A-Z]'] } })
  writeFileSync(join(root, 'lib', 'extra.mjs'), MOD)
  const ls = { command: 'ls' }, write = { file_path: join(root, 'lib', 'x.mjs'), content: 'x' }
  assert.equal(as(root, 'aics-web', 'Bash', ls), 0)
  assert.equal(as(root, 'aics-web', 'Write', write), 2, 'walled as desk web')
  assert.equal(as(root, 'aics-nobody', 'Bash', ls), 2, 'shaped like a desk, and none answers to it')
  assert.equal(as(root, 'erp-nobody', 'Bash', ls), 2)
  assert.equal(as(root, 'aics-alibaba-Keisha', 'Bash', ls), 0, 'the module maps the teammate to its desk')
  assert.equal(as(root, 'aics-alibaba-Keisha', 'Write', write), 2, 'and the desk\'s wall holds it')
  assert.equal(as(root, 'aics-alibaba-keisha', 'Bash', ls), 2, 'a name no pattern maps is refused, not waved through')
  assert.equal(as(root, 'desk-alibaba-customer-service', 'Write', write), 2, 'its old name: still that desk, still walled')
  assert.equal(as(root, 'repo-dev-12', 'Write', write), 0, 'a developer at the root')
})

test('⛔ SendMessage: to a desk by its session; an old name is refused with the new one', () => {
  const { root, cfg } = office({ wall: { failClosed: true, messages: true } })
  const W = compileWall({ ...cfg.wall, root, leadSession: 'AICS' })
  const me = officeRoster(root).desks.find((d) => d.name === 'web')
  const send = (to) => judge({ tool_name: 'SendMessage', tool_input: { to, message: 'x' }, cwd: me.dir }, { kind: 'desk', desk: 'web', dir: me.dir }, root, W)
  assert.equal(send('aics-web-design'), null)
  assert.equal(send('erp-inventory'), null)
  assert.match(send('desk-alibaba-customer-service'), /renamed: it is aics-alibaba now/)
  assert.match(send('aics-nobody'), /messages go to the lead/)
})

test('⛔ a renamed folder keeps its conversation: found under its old id\'s folder, started as desk-<old id>, carried over', () => {
  const { root, cfg } = office()
  const dir = mkdtempSync(join(tmpdir(), 'oa-names-cc-'))
  const old = join(root, 'departments', 'aics', 'alibaba-customer-service')
  const p = projectDirOf(old, dir)
  mkdirSync(p, { recursive: true })
  const id = '11111111-1111-4111-8111-111111111111'
  writeFileSync(join(p, id + '.jsonl'), JSON.stringify({ type: 'custom-title', customTitle: 'desk-alibaba-customer-service' }) + '\n' + JSON.stringify({ type: 'user', message: { content: 'hi' } }) + '\n')
  const t = targetsOf(root, cfg, 'alibaba')[0]
  assert.equal(t.tag, 'aics-alibaba')
  assert.ok(t.before.includes(old), JSON.stringify(t.before))
  const plan = planStart({ tag: t.tag, cwd: t.dir, before: t.before, also: t.own, live: [], dir })
  assert.equal(plan.resume, id, plan.why)
  assert.match(plan.why, /carried over/)
  // another desk's old conversation there is never this one's
  writeFileSync(join(p, id + '.jsonl'), JSON.stringify({ type: 'custom-title', customTitle: 'desk-web-customer-service' }) + '\n')
  assert.equal(planStart({ tag: t.tag, cwd: t.dir, before: t.before, also: t.own, live: [], dir }).resume, null)
})

test('health: a desk still running under its old name is its row, renamed, and restarts under the new one', () => {
  const { root } = office()
  const home = mkdtempSync(join(tmpdir(), 'oa-names-h-'))
  mkdirSync(join(home, '.claude', 'sessions'), { recursive: true })
  const inv = join(root, 'departments', 'local-ops', 'inventory')
  writeFileSync(join(home, '.claude', 'sessions', '8801.json'), JSON.stringify({ pid: 8801, name: 'desk-inventory', cwd: inv, sessionId: '00000000-0000-4000-8000-000000008801', status: 'idle', updatedAt: Date.now(), startedAt: Date.now() - 60000 }))
  const procs = new Map([[1, { pid: 1, ppid: 0, ageSec: 1e6, cmd: 'launchd' }], [8801, { pid: 8801, ppid: 1, ageSec: 60, cmd: 'claude --name desk-inventory' }]])
  const h = officeHealth(root, { home, procs, checks: false, cwd: () => null })
  const row = h.desks.find((r) => r.name === 'inventory')
  assert.equal(row.tag, 'erp-inventory')
  assert.equal(row.session.state, 'alive')
  assert.equal(row.session.renamed, 'desk-inventory')
  assert.match(h.line, /desk-inventory → erp-inventory/)
})

test('usage and alerts: every <prefix>-* name is its department\'s, cases and teammates included', () => {
  const { root, cfg } = office()
  const desks = officeRoster(root).desks
  const g = (name) => usageGroupOf(cfg, { name }, { root, desks })?.id ?? null
  assert.deepEqual(['aics-web', 'aics-web-design--SC-261022-191', 'aics-alibaba-Keisha', 'desk-alibaba-customer-service', 'AICS'].map(g), Array(5).fill('aics'))
  assert.deepEqual(['erp-inventory', 'desk-inventory--SC-1', 'ERP'].map(g), Array(3).fill('local-ops'))
  assert.equal(g('desk-billing'), null, 'a desk in no department')
  assert.equal(departmentOfSubject(cfg, 'aics-alibaba-Keisha', desks), 'aics')
  assert.equal(departmentOfSubject(cfg, 'erp-inventory--SC-1', desks), 'local-ops')
  assert.equal(departmentOfSubject(cfg, 'desk-design', desks), 'aics', 'an old name of a renamed desk')
})

test('⛔ a prefix that would make one name mean two things is refused; so is an old id that is another desk\'s', () => {
  const pr = (prefix, extra = {}) => departmentsOf({ departments: { a: { lead: 'A', desks: [], prefix }, b: { lead: 'B', desks: [], ...extra } } })
  assert.match(pr('desk').problems.join(), /reserved/)
  assert.match(pr('cs').problems.join(), /reserved/)
  assert.match(pr('Aics').problems.join(), /not a session prefix/)
  assert.match(pr('ops', { lead: 'ops' }).problems.join(), /is a lead's or a builder's name/)
  assert.equal(pr('aics', {}).problems.length, 0, 'aics is not the lead AICS')
  assert.match(departmentsOf({ construction: { name: 'full' }, departments: { a: { lead: 'A', desks: [], prefix: 'full' } } }).problems.join(), /builder's name/)
  const twice = pr('ops', { prefix: 'ops' })
  assert.match(twice.problems.join(), /belongs to two departments/)
  assert.deepEqual(twice.list.map((d) => d.prefix), [null, null], 'neither has it')
  assert.match(departmentsOf({ departments: { a: { lead: 'aics-lead', desks: [], prefix: 'aics' } } }).problems.join(), /looks like a desk session/)
  // an old id that is another desk's id: both broken, neither quietly the one a message reaches
  const { root } = office()
  writeFileSync(join(root, 'departments', 'aics', 'web', 'desk.json'), JSON.stringify({ name: 'web', kind: 'knowledge', port: 9602, formerly: ['alibaba'] }))
  const r = officeRoster(root)
  assert.deepEqual(r.broken.map((b) => b.desk).sort(), ['alibaba', 'web'])
  assert.ok(!r.desks.some((d) => d.name === 'web' || d.name === 'alibaba'))
  // a desk name or folder with "--" is a case session's shape
  assert.equal(DESK_NAME.test('web--design'), false)
  assert.equal(DESK_NAME.test('web-design'), true)
})

test('no prefix: exactly as before, desk-<id> everywhere', () => {
  const { root, cfg } = office({ prefixes: false })
  assert.deepEqual(officeRoster(root).desks.map((d) => d.session).sort(), ['desk-alibaba', 'desk-billing', 'desk-inventory', 'desk-web', 'desk-web-design'])
  assert.equal(deskShaped(root, 'aics-web'), false)
  assert.equal(whoIs(root, cfg, { cwd: root, env: {}, name: 'aics-web' }), null, 'not a desk name in this office: a developer')
  assert.equal(whoIs(root, cfg, { cwd: root, env: {}, name: 'desk-web-design--SC-261022-191' }).caseKey, 'SC-261022-191')
})

test('⛔ the leads\' own model: departments.<id>.model, else launch.lead.model; desks keep launch.model', () => {
  const { root, cfg } = office({ extra: { launch: { model: 'sonnet', lead: { model: 'opus' } } } })
  const c2 = { ...cfg, departments: { ...cfg.departments, 'local-ops': { ...cfg.departments['local-ops'], model: 'fable' } } }
  writeFileSync(join(root, 'office.json'), JSON.stringify(c2))
  const t = Object.fromEntries(targetsOf(root, c2, 'everything').map((x) => [x.tag, x]))
  assert.match(launchCommand({ cfg: c2, target: t.AICS }), /--name 'AICS' --model opus(\s|$)/)
  assert.match(launchCommand({ cfg: c2, target: t.ERP }), /--name 'ERP' --model fable(\s|$)/)
  assert.match(launchCommand({ cfg: c2, target: targetsOf(root, c2, 'web')[0] }), /--name 'aics-web' --model sonnet/)
  assert.match(departmentsOf({ departments: { a: { lead: 'A', desks: [], model: 'op us' } } }).problems.join(), /not a model name/)
})
