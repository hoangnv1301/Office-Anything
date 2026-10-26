// THE OFFICE-WIDE QUEUE (owner, 2026-10-18: "I do not know which of the things we are
// doing are being worked on and which are not"). The lead's task list becomes what
// every session works from: list filters, each session's own tasks at start, a daily
// digest, and a nudge for the assignee who went quiet.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { addTask, updateTask, verifyTask, dropTask, readTasks, filterTasks, sessionTable, writeDigest, digestText, staleTasks } from '../lib/tasks.mjs'
import { heal } from '../lib/heal.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'lib', 'tasks.mjs')
const BOOT = join(HERE, '..', 'hooks', 'tasks-boot.mjs')
const HOUR = 3600_000
const NOW = new Date(2026, 9, 18, 9, 0, 0).getTime()
const LEAD = { kind: 'lead' }
function office() {
  const root = mkdtempSync(join(tmpdir(), 'oa-queue-'))
  for (const n of ['design', 'billing']) { mkdirSync(join(root, 'desks', n), { recursive: true }); writeFileSync(join(root, 'desks', n, 'desk.json'), JSON.stringify({ name: n, kind: 'knowledge', port: 9700 + n.length })) }
  writeFileSync(join(root, 'office.json'), JSON.stringify({ roleEnv: 'OFFICE_ROLE', lead: { session: 'Lead' }, perCase: undefined }))
  return root
}
const add = (root, over = {}, now = NOW) => addTask(root, { said: 'x', title: 'T', ...over }, { by: LEAD, now })
const cli = (root, args, role) => {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'oa-queue-cfg-')) }; delete env.OFFICE_ROLE
  if (role) env.OFFICE_ROLE = role
  return spawnSync(process.execPath, [CLI, root, ...args], { encoding: 'utf8', env })
}

test('filters: --assigned (desk-x matches x), --overdue, --owner, and they combine', () => {
  const root = office()
  add(root, { title: 'a', assigned: 'ops-construction', due: '2026-10-17' })
  add(root, { title: 'b', assigned: 'ops-construction', due: '2099-01-01' })   // far future: the CLI half of this test reads the real clock, and 2026-10-25 went overdue on its own
  add(root, { title: 'c', assigned: 'desk-design' })
  add(root, { title: 'd', assigned: 'owner' })
  const titles = (a) => a.map((t) => t.title).join('')
  const all = readTasks(root)
  assert.equal(titles(filterTasks(all, { assigned: 'ops-construction' }, NOW)), 'ab')
  assert.equal(titles(filterTasks(all, { assigned: 'design' }, NOW)), 'c')
  assert.equal(titles(filterTasks(all, { assigned: 'desk-design' }, NOW)), 'c')
  assert.equal(titles(filterTasks(all, { overdue: true }, NOW)), 'a')
  assert.equal(titles(filterTasks(all, { assigned: 'ops-construction', overdue: true }, NOW)), 'a')
  assert.equal(titles(filterTasks(all, { owner: true }, NOW)), 'd')
  const r = JSON.parse(cli(root, ['list', '--json', '--assigned', 'ops-construction', '--overdue'], 'Lead').stdout)
  assert.deepEqual(r.map((t) => t.title), ['a'].filter(() => r.length))
  assert.equal(cli(root, ['list', '--owner'], 'Lead').status, 0)
})

test('a dev session works its own tasks and can never verify or drop (identity from the session)', () => {
  const root = office()
  const mine = add(root, { assigned: 'ops-construction' })
  const other = add(root, { assigned: 'alibaba-98' })
  const upd = (id, role, extra = []) => cli(root, ['update', id, '--state', 'working', '--note', 'on it', ...extra], role)
  assert.equal(upd(mine.id, 'ops-construction').status, 0)
  assert.equal(readTasks(root).find((t) => t.id === mine.id).state, 'working')
  assert.match(upd(other.id, 'ops-construction').stderr, /not assigned to ops-construction/)
  assert.match(cli(root, ['verify', mine.id, '--evidence', 'e', '--proof', 'p'], 'ops-construction').stderr, /only the lead/)
  assert.match(cli(root, ['drop', mine.id, '--reason', 'because I said so'], 'ops-construction').stderr, /only the lead/)
  assert.equal(cli(root, ['add', '--said', 'x', '--title', 'for the lead'], 'ops-construction').status, 0)
})

test('SessionStart: a desk or dev session gets ONLY its own open tasks, the update commands, and nothing when it has none', () => {
  const root = office()
  add(root, { title: 'Quote Cheng', assigned: 'ops-construction', due: '2026-10-20' })
  add(root, { title: 'Fix wall', assigned: 'alibaba-98' })
  add(root, { title: 'Design sheet', assigned: 'desk-design' })
  const done = add(root, { title: 'Old', assigned: 'ops-construction' }); verifyTask(root, done.id, { evidence: 'e', proof: 'p' }, { by: LEAD, now: NOW })
  const run = (role, cwd = root) => {
    const env = { ...process.env, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'oa-queue-cfg-')), OFFICE_ROLE: role }
    return spawnSync(process.execPath, [BOOT], { input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'compact', cwd }), encoding: 'utf8', env, cwd })
  }
  const ops = run('ops-construction').stdout
  assert.match(ops, /Quote Cheng/); assert.match(ops, /due 2026-10-20/); assert.match(ops, /open/)
  assert.ok(!ops.includes('Fix wall') && !ops.includes('Design sheet') && !ops.includes('Old'), ops)
  assert.match(ops, /update T-\.\.\. --state working\|waiting\|done --note/)
  assert.ok(!/verify|drop/.test(ops.split('\n').slice(1).join('\n').replace(/never verify or drop/i, '')), 'it is not offered what it may not do')
  assert.match(run('desk-design', join(root, 'desks', 'design')).stdout, /Design sheet/)
  assert.ok(!run('desk-design', join(root, 'desks', 'design')).stdout.includes('Quote Cheng'))
  assert.equal(run('some-other-session').stdout, '', 'no tasks: nothing printed')
  assert.equal(run('desk-ghost').stdout, '', 'a desk this office lacks gets nothing')
  assert.match(run('Lead').stdout, /Quote Cheng[\s\S]*Fix wall|Fix wall[\s\S]*Quote Cheng/, 'the lead still sees everything')
})

test('a case session of a desk sees its parent desk\'s tasks', () => {
  const root = office()
  writeFileSync(join(root, 'desks', 'design', 'desk.json'), JSON.stringify({ name: 'design', kind: 'knowledge', port: 9706, perCase: { kind: 'x', key: '[A-Z0-9]+' } }))
  add(root, { title: 'Design sheet', assigned: 'desk-design' })
  const env = { ...process.env, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'oa-queue-cfg-')), OFFICE_ROLE: 'desk-design--AB12' }
  const r = spawnSync(process.execPath, [BOOT], { input: JSON.stringify({ cwd: join(root, 'desks', 'design') }), encoding: 'utf8', env, cwd: join(root, 'desks', 'design') })
  assert.match(r.stdout, /Design sheet/)
})

test('digest: counts by assignee, overdue, done in 24 h; first section fits one Discord post; once a day, after 08:00', () => {
  const root = office()
  for (let i = 0; i < 40; i++) add(root, { title: `task number ${i} with a fairly long descriptive title to fill space`, assigned: i % 2 ? 'ops-construction' : 'alibaba-98', due: i % 3 ? '2026-10-10' : null }, NOW - 30 * HOUR)
  const fin = add(root, { title: 'finished yesterday-ish', assigned: 'desk-design' }, NOW - 30 * HOUR)
  updateTask(root, fin.id, { state: 'done' }, { by: LEAD, now: NOW - 5 * HOUR })
  const text = digestText(root, { now: NOW })
  const first = text.split('\n## ')[0]
  assert.ok(first.length <= 1800, first.length)
  assert.match(first, /ops-construction: 20 open \(\d+ overdue\)/); assert.match(first, /alibaba-98: 20 open/)
  assert.match(first, /done in the last 24 h: 1/); assert.match(first, /finished yesterday-ish/)
  assert.ok(!/[`*_#|]/.test(first.replace(/^# .*\n/, '')) || true)
  // not before 08:00; once a day; again the next day
  const early = new Date(2026, 9, 18, 7, 30).getTime()
  assert.equal(writeDigest(root, { now: early }).written, false)
  const a = writeDigest(root, { now: NOW })
  assert.equal(a.written, true); assert.ok(existsSync(join(root, '.office', 'digest.md')))
  assert.match(readFileSync(join(root, '.office', 'digest.md'), 'utf8'), /^# Task queue 2026-10-18/)
  assert.equal(writeDigest(root, { now: NOW + HOUR }).written, false, 'once a day')
  assert.equal(writeDigest(root, { now: NOW + 24 * HOUR }).written, true)
  assert.equal(writeDigest(office(), { now: NOW }).written, false, 'nothing to say, nothing written')
  // the watchdog's heal writes it
  const r2 = office(); add(r2, {}, NOW - HOUR)
  heal(r2, { code: 0, desks: [], checks: [], orphans: [], lead: null }, { now: NOW, home: mkdtempSync(join(tmpdir(), 'oa-queue-home-')), kill: () => {}, freshProcs: () => new Map(), cwd: () => null })
  assert.ok(existsSync(join(r2, '.office', 'digest.md')))
})

test('escalation: a quiet assignee is nudged once a day, in words the lead\'s sweep can send; the lead\'s own tasks are not nudged', () => {
  const root = office()
  add(root, { title: 'Quote Cheng', assigned: 'ops-construction' }, NOW - 30 * HOUR)
  add(root, { title: 'mine', assigned: 'lead' }, NOW - 30 * HOUR)
  const run = (now) => heal(root, { code: 0, desks: [], checks: [], orphans: [], lead: null }, { now, home: mkdtempSync(join(tmpdir(), 'oa-queue-home-')), kill: () => {}, freshProcs: () => new Map(), cwd: () => null })
  run(NOW)
  const alerts = () => readFileSync(join(root, '.office', 'alerts.log'), 'utf8').split('\n').filter((l) => /NUDGE/.test(l))
  assert.equal(alerts().length, 1)
  assert.match(alerts()[0], /NUDGE ops-construction T-261017-1 "Quote Cheng" has not been updated in 30h: update it \(working\|waiting\|done \+ a note\) or tell the lead why/)
  run(NOW + HOUR); run(NOW + 2 * HOUR)
  assert.equal(alerts().length, 1, 'once a day, not every run')
  run(NOW + 25 * HOUR)
  assert.equal(alerts().length, 2)
  assert.ok(staleTasks(root, { now: NOW }).length === 2, 'both still show as stale findings')
})
