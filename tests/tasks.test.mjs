// THE LEAD'S PERSISTENT TASK LIST (owner request 2026-10-18: a list the lead puts
// things down in, so a context reset cannot lose what the owner asked). Append-only
// events in .office/tasks.jsonl, folded on read; hooks put the open ones back in the
// lead's context; health and the watchdog say what went stale.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { addTask, updateTask, verifyTask, dropTask, readTasks, openTable, staleTasks, tasksFile } from '../lib/tasks.mjs'
import { officeHealth } from '../lib/health.mjs'
import { heal } from '../lib/heal.mjs'
import { compileWall, judge } from '../lib/wall.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'lib', 'tasks.mjs')
const BOOT = join(HERE, '..', 'hooks', 'tasks-boot.mjs')
const HOUR = 3600_000
const NOW = new Date(2026, 9, 18, 12, 0, 0).getTime()   // local time, 2026-10-18
const LEAD = { kind: 'lead' }, OWNER = { kind: 'owner' }
const desk = (n) => ({ kind: 'desk', desk: n })
function office() {
  const root = mkdtempSync(join(tmpdir(), 'oa-tasks-'))
  for (const n of ['design', 'billing']) { mkdirSync(join(root, 'desks', n), { recursive: true }); writeFileSync(join(root, 'desks', n, 'desk.json'), JSON.stringify({ name: n, kind: 'knowledge', port: 9600 + n.length })) }
  writeFileSync(join(root, 'office.json'), JSON.stringify({ roleEnv: 'OFFICE_ROLE', lead: { session: 'Lead' } }))
  return root
}
const add = (root, over = {}, by = LEAD, now = NOW) => addTask(root, { said: 'answer the two buyers today', title: 'Answer buyers', ...over }, { by, now })
const cli = (root, args, role, cwd = root) => {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'oa-tasks-cfg-')) }; delete env.OFFICE_ROLE; delete env.CLAUDE_PROJECT_DIR
  if (role) env.OFFICE_ROLE = role
  return spawnSync(process.execPath, [CLI, root, ...args], { encoding: 'utf8', env, cwd })
}

test('add: the owner\'s words are required and kept verbatim; ids run T-YYMMDD-n and restart each day', () => {
  const root = office()
  assert.throws(() => addTask(root, { title: 'x' }, { by: LEAD, now: NOW }), /said/)
  assert.throws(() => addTask(root, { said: 'x' }, { by: LEAD, now: NOW }), /title/)
  const said = '  Trả lời hai khách  "ngay" hôm nay — đừng quên  '
  const a = add(root, { said })
  const b = add(root, { title: 'second' })
  assert.equal(a.id, 'T-261018-1'); assert.equal(b.id, 'T-261018-2')
  assert.equal(add(root, {}, LEAD, NOW + 24 * HOUR).id, 'T-261019-1')
  const t = readTasks(root).find((x) => x.id === a.id)
  assert.equal(t.said, said, 'verbatim, not trimmed or rewritten')
  assert.equal(t.state, 'open'); assert.equal(t.assigned, 'lead'); assert.equal(t.source, 'chat')
  const lines = readFileSync(tasksFile(root), 'utf8').trim().split('\n')
  assert.equal(lines.length, 3); for (const l of lines) JSON.parse(l)
  assert.throws(() => add(root, { source: 'smoke-signal' }), /source/)
})

test('ids stay unique when several writers add at once', async () => {
  const root = office()
  const run = () => new Promise((res) => { const p = spawn(process.execPath, [CLI, root, 'add', '--said', 'x', '--title', 'y'], { env: { ...process.env, OFFICE_ROLE: '' } }); let out = ''; p.stdout.on('data', (d) => { out += d }); p.on('close', (c) => res({ c, out })) })
  const rs = await Promise.all(Array.from({ length: 8 }, run))
  assert.ok(rs.every((r) => r.c === 0), JSON.stringify(rs))
  const ids = readTasks(root).map((t) => t.id)
  assert.equal(new Set(ids).size, 8, ids.join(','))
  assert.equal(readFileSync(tasksFile(root), 'utf8').trim().split('\n').length, 8)
})

test('verify needs evidence AND a one-line proof, drop needs a reason, and both are final', () => {
  const root = office()
  const t = add(root)
  assert.throws(() => verifyTask(root, t.id, { proof: 'sent' }, { by: LEAD, now: NOW }), /evidence/)
  assert.throws(() => verifyTask(root, t.id, { evidence: 'msg.txt' }, { by: LEAD, now: NOW }), /proof/)
  assert.throws(() => verifyTask(root, t.id, { evidence: 'msg.txt', proof: 'a\nb' }, { by: LEAD, now: NOW }), /one line/)
  assert.throws(() => dropTask(root, t.id, { reason: 'no' }, { by: LEAD, now: NOW }), /reason/)
  assert.throws(() => updateTask(root, t.id, { state: 'verified' }, { by: LEAD, now: NOW }), /verify/)
  assert.throws(() => updateTask(root, t.id, { state: 'dropped' }, { by: LEAD, now: NOW }), /drop/)
  verifyTask(root, t.id, { evidence: 'sent-2026-10-18.txt', proof: 'both buyers replied to' }, { by: LEAD, now: NOW + HOUR })
  const v = readTasks(root).find((x) => x.id === t.id)
  assert.equal(v.state, 'verified'); assert.equal(v.evidence.length, 1); assert.match(v.evidence[0].proof, /both buyers/)
  assert.throws(() => updateTask(root, t.id, { state: 'open' }, { by: LEAD, now: NOW }), /final/)
  assert.throws(() => dropTask(root, t.id, { reason: 'changed my mind, really' }, { by: LEAD, now: NOW }), /final/)
  const d = add(root, { title: 'other' })
  dropTask(root, d.id, { reason: 'the owner cancelled it in chat' }, { by: LEAD, now: NOW })
  assert.equal(readTasks(root).find((x) => x.id === d.id).state, 'dropped')
  assert.throws(() => updateTask(root, 'T-000000-9', { state: 'done' }, { by: LEAD, now: NOW }), /no task/)
})

test('a desk may add a task for the lead and work its own, never verify or drop, never touch another desk\'s', () => {
  const root = office()
  const mine = add(root, { assigned: 'desk-design' }, desk('design'))
  assert.equal(add(root, {}, desk('design')).assigned, 'lead', 'a desk\'s task is for the lead unless it names a desk')
  updateTask(root, add(root, { assigned: 'desk-design' }, LEAD).id, { state: 'working', note: 'on it' }, { by: desk('design'), now: NOW })
  const other = add(root, { assigned: 'desk-billing' }, LEAD)
  assert.throws(() => updateTask(root, other.id, { state: 'done' }, { by: desk('design'), now: NOW }), /not assigned to/)
  assert.throws(() => verifyTask(root, mine.id, { evidence: 'e', proof: 'p' }, { by: desk('design'), now: NOW }), /only the lead/)
  assert.throws(() => dropTask(root, mine.id, { reason: 'because I say so' }, { by: desk('design'), now: NOW }), /only the lead/)
  assert.throws(() => updateTask(root, mine.id, { state: 'done', assigned: 'lead' }, { by: desk('design'), now: NOW }), /reassign/)
  updateTask(root, mine.id, { state: 'done' }, { by: desk('design'), now: NOW })
  assert.equal(readTasks(root).find((x) => x.id === mine.id).state, 'done', 'done, not verified')
  // identity comes from the session, not a flag: the CLI as a desk
  const r = cli(root, ['verify', mine.id, '--evidence', 'e', '--proof', 'p'], 'desk-design')
  assert.notEqual(r.status, 0); assert.match(r.stderr, /only the lead/)
  assert.equal(cli(root, ['verify', mine.id, '--evidence', 'e', '--proof', 'p'], 'Lead').status, 0)
  assert.notEqual(cli(root, ['list'], 'desk-ghost').status, 0, 'a role naming a desk this office lacks is refused')
})

test('the table: open work only, oldest first, with the way to add and update', () => {
  const root = office()
  const a = add(root, { title: 'Answer buyers', assigned: 'desk-design' }, LEAD, NOW - 50 * HOUR)
  const b = add(root, { title: 'Reply to Cheng' }, LEAD, NOW - 20 * 60_000)
  const c = add(root, { title: 'finished one' }, LEAD, NOW - 3 * HOUR)
  verifyTask(root, c.id, { evidence: 'x', proof: 'checked' }, { by: LEAD, now: NOW })
  updateTask(root, b.id, { state: 'waiting' }, { by: LEAD, now: NOW - 10 * 60_000 })
  const t = openTable(root, { now: NOW })
  const rows = t.split('\n').filter((l) => /^T-/.test(l))
  assert.equal(rows.length, 2)
  assert.match(rows[0], /^T-261016-1\s+2d\s+open\s+desk-design\s+Answer buyers/)
  assert.match(rows[1], /^T-261018-1\s+20m\s+waiting\s+lead\s+Reply to Cheng/)
  assert.ok(!t.includes('finished one'))
  assert.match(t, /tasks\.mjs.* (add|update|verify)/, 'it says how to put something down')
  assert.equal(openTable(office(), { now: NOW }), '', 'nothing open: nothing printed')
})

test('the SessionStart hook puts the open tasks back in the lead\'s context, after a compact, and only the lead\'s', () => {
  const root = office()
  add(root, { title: 'Answer buyers' }, LEAD, Date.now() - 5 * HOUR)
  const run = (role, source = 'compact', cwd = root, input = null) => {
    const env = { ...process.env, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'oa-tasks-cfg-')) }; delete env.OFFICE_ROLE
    if (role) env.OFFICE_ROLE = role
    return spawnSync(process.execPath, [BOOT], { input: input ?? JSON.stringify({ hook_event_name: 'SessionStart', source, cwd }), encoding: 'utf8', env, cwd })
  }
  for (const source of ['startup', 'resume', 'clear', 'compact']) {
    const r = run('Lead', source)
    assert.equal(r.status, 0); assert.match(r.stdout, /OPEN TASKS/); assert.match(r.stdout, /T-\d{6}-1\s+5h\s+open\s+lead\s+Answer buyers/)
  }
  assert.equal(run('desk-design').stdout, '', 'a desk does not get the lead\'s list')
  assert.equal(run('Lead', 'compact', mkdtempSync(join(tmpdir(), 'oa-notoffice-'))).stdout, '', 'not an office: inert')
  assert.equal(run('Lead', 'x', root, 'not json').status, 0, 'garbage in: exit 0')
  assert.equal(run('Lead', 'startup', office()).stdout, '', 'nothing open: nothing printed')
  // the hook is registered for every way a session starts
  const hooks = JSON.parse(readFileSync(join(HERE, '..', 'hooks', 'hooks.json'), 'utf8'))
  assert.ok(JSON.stringify(hooks.hooks.SessionStart).includes('tasks-boot.mjs'))
})

test('stale: open with no update for 24 h, done but not verified for 6 h; health says so and the watchdog tells the lead', () => {
  const root = office()
  const old = add(root, { title: 'forgotten' }, LEAD, NOW - 30 * HOUR)
  const fresh = add(root, { title: 'fresh' }, LEAD, NOW - 2 * HOUR)
  const kept = add(root, { title: 'touched' }, LEAD, NOW - 30 * HOUR)
  updateTask(root, kept.id, { note: 'still on it' }, { by: LEAD, now: NOW - HOUR })
  const done = add(root, { title: 'unchecked' }, LEAD, NOW - 10 * HOUR)
  updateTask(root, done.id, { state: 'done' }, { by: LEAD, now: NOW - 7 * HOUR })
  const justDone = add(root, { title: 'just done' }, LEAD, NOW - 10 * HOUR)
  updateTask(root, justDone.id, { state: 'done' }, { by: LEAD, now: NOW - 2 * HOUR })
  const s = staleTasks(root, { now: NOW })
  assert.deepEqual(s.map((x) => x.id).sort(), [old.id, done.id].sort())
  assert.match(s.find((x) => x.id === old.id).why, /open 30h with no update/)
  assert.match(s.find((x) => x.id === done.id).why, /done 7h ago and not verified/)
  const h = officeHealth(root, { home: mkdtempSync(join(tmpdir(), 'oa-tasks-home-')), procs: new Map(), checks: false, now: NOW })
  const f = h.findings.filter((x) => x.desk === 'tasks')
  assert.equal(f.length, 2, JSON.stringify(h.findings)); assert.equal(h.code, 4)
  const r = heal(root, { code: 4, desks: [], checks: [], orphans: [], lead: null }, { now: NOW, home: mkdtempSync(join(tmpdir(), 'oa-tasks-home-')), kill: () => { throw new Error('no') }, freshProcs: () => new Map(), cwd: () => null })
  const alerts = readFileSync(join(root, '.office', 'alerts.log'), 'utf8')
  assert.match(alerts, /task:T-261017-1|T-261017-1/); assert.match(alerts, /forgotten/)
  assert.ok(r.acts.some((a) => a.act === 'notify'))
  // verified and dropped are never stale
  verifyTask(root, old.id, { evidence: 'e', proof: 'p' }, { by: LEAD, now: NOW })
  dropTask(root, done.id, { reason: 'no longer wanted by owner' }, { by: LEAD, now: NOW })
  assert.deepEqual(staleTasks(root, { now: NOW }), [])
})

test('wall: {plugin} in a lead.bash entry means this plugin\'s own folder, one real file in it', () => {
  const root = office()
  const pluginRoot = mkdtempSync(join(tmpdir(), 'oa-plugin-'))
  mkdirSync(join(pluginRoot, 'lib')); writeFileSync(join(pluginRoot, 'lib', 'tasks.mjs'), '')
  const ARG = `(?:'[^']*'|"[^"$\`\\\\]*"|[A-Za-z0-9_.:/=@#+-]+)`
  const good = `^node {plugin}/lib/tasks\\.mjs (add|update|list|verify|drop)( ${ARG})*$`
  const W = compileWall({ lead: { bash: [good] }, root }, { pluginRoot })
  assert.deepEqual(W.leadBashProblems, [])
  const run = (c) => judge({ tool_name: 'Bash', tool_input: { command: c }, cwd: root }, { kind: 'lead' }, root, W)
  assert.equal(run(`node ${pluginRoot}/lib/tasks.mjs add --said 'both buyers; answer today' --title Buyers`), null)
  assert.equal(run(`node ${pluginRoot}/lib/tasks.mjs list`), null)
  assert.match(run(`node ${pluginRoot}/lib/tasks.mjs shell`), /limited/)
  assert.match(run(`node ${pluginRoot}/lib/other.mjs list`), /limited/)
  assert.match(run('node /tmp/evil/lib/tasks.mjs list'), /limited/)
  for (const bad of ['^node {plugin}/lib/tasks\\.mjs {plugin}/lib/tasks\\.mjs$', '^echo hi | node {plugin}/lib/tasks\\.mjs list$', '^node {plugin}/lib/tasks\\.mjs$|^rm$', '^node {plugin}/lib/../tasks\\.mjs$', '^node {plugin}/lib/tasks\\.mjs$ {plugin}', '^bash {plugin}/lib/tasks\\.mjs$', '^node {plugin}/lib/missing\\.mjs$', '^node {plugin}/\\.\\./x\\.mjs$', '^cat {plugin}/lib/tasks\\.mjs$', '^node /x/{plugin}/lib/tasks\\.mjs$']) {
    assert.equal(compileWall({ lead: { bash: [bad] }, root }, { pluginRoot }).leadBashProblems.length, 1, bad)
  }
  // the default is the plugin this wall belongs to
  const own = compileWall({ lead: { bash: ['^node {plugin}/lib/tasks\\.mjs list$'] }, root })
  assert.deepEqual(own.leadBashProblems, [])
})

test('the table shows 60 characters of the title, an OVERDUE marker, and works for dev sessions as assignees', () => {
  const root = office()
  const long = 'Reply to the Cheng Family about the Pawcatuck order and the revised delivery date'
  add(root, { title: long, assigned: 'ops-construction', due: '2026-10-17' }, LEAD, NOW - 30 * HOUR)
  add(root, { title: 'not yet due', assigned: 'office-anything-construction', due: '2026-10-19' }, LEAD, NOW - HOUR)
  const rows = openTable(root, { now: NOW }).split('\n').filter((l) => /^T-/.test(l))
  assert.ok(rows[0].includes(`ops-construction  ${long.slice(0, 60)}…  OVERDUE (due 2026-10-17)`), rows[0])
  assert.ok(!rows[1].includes('OVERDUE'))
  assert.match(rows[1], /office-anything-construction/)
  // done is still open work until it is checked; verified and dropped leave the table
  assert.equal(openTable(root, { now: NOW }).split('\n').filter((l) => /^T-/.test(l)).length, 2)
})

test('list --json for tooling, and --all shows what is closed', () => {
  const root = office()
  const a = add(root), b = add(root, { title: 'closed' })
  dropTask(root, b.id, { reason: 'no longer wanted by owner' }, { by: LEAD, now: NOW })
  const open = JSON.parse(cli(root, ['list', '--json'], 'Lead').stdout)
  assert.deepEqual(open.map((t) => t.id), [a.id])
  assert.ok(['id', 'said', 'title', 'source', 'assigned', 'state', 'evidence', 'notes', 'created', 'updated'].every((k) => k in open[0]))
  assert.deepEqual(JSON.parse(cli(root, ['list', '--json', '--all'], 'Lead').stdout).map((t) => t.state), ['open', 'dropped'])
  assert.equal(cli(office(), ['list'], 'Lead').stdout.trim(), 'no open tasks')
})

test('a daily snapshot, written by the script on the first write or inject of the day, keeps 14', () => {
  const root = office()
  const DAY = 24 * HOUR
  add(root, {}, LEAD, NOW)
  const dir = join(root, '.office', 'tasks-snapshots')
  const names = () => readdirSync(dir).sort()
  add(root, { title: 'second' }, LEAD, NOW + 1000)
  assert.equal(names().length, 1, 'one snapshot a day, however many writes')
  assert.equal(readFileSync(join(dir, names()[0]), 'utf8').trim().split('\n').length, 1, 'it holds the day\'s FIRST state')
  for (let d = 1; d <= 16; d++) add(root, { title: 'day ' + d }, LEAD, NOW + d * DAY)
  const kept = names()
  assert.equal(kept.length, 14); assert.equal(kept.at(-1), 'tasks-20261103.jsonl'); assert.ok(!kept.includes('tasks-20261018.jsonl'))
})

test('README and the recover command say it', () => {
  const src = (f) => readFileSync(join(HERE, '..', f), 'utf8')
  assert.match(src('README.md'), /\.office\/tasks\.jsonl/)
  assert.match(src('README.md'), /tasks\.mjs verify/)
  assert.match(src('README.md'), /tasks-snapshots/)
  assert.match(src('README.md'), /\{plugin\}/)
  assert.match(src('commands/desk-recover.md'), /tasks\.mjs list/)
  assert.ok(existsSync(join(HERE, '..', 'hooks', 'tasks-boot.mjs')))
})
