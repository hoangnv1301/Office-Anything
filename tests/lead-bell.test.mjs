// THE LEAD'S DOORBELL (lead's request, 2026-10-20): one line per new thing,
// never per poll; restart-safe; rate-limited; a failing ask said once. And
// the Monitor tool, which ran outside the wall, is judged now.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { poll, loadState } from '../lib/lead-bell.mjs'
import { bootLines } from '../hooks/desk-boot.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = join(HERE, '..')
const T0 = Date.parse('2026-10-20T08:00:00Z')
const MIN = 60_000
function office(bell = {}, extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oa-bell-'))
  mkdirSync(join(root, 'desks', 'design'), { recursive: true })
  writeFileSync(join(root, 'desks', 'design', 'desk.json'), JSON.stringify({ name: 'design', kind: 'knowledge', port: 9431, wake: 'node ../../bell.mjs design' }))
  mkdirSync(join(root, '.office'), { recursive: true })
  writeFileSync(join(root, '.office', 'alerts.log'), '2026-10-19T00:00:00.000Z HELD-LEAD - old an alert from yesterday\n')
  const cfg = { roleEnv: 'OFFICE_ROLE', lead: { session: 'lead', wake: 'node {plugin}/lib/lead-bell.mjs', bell }, ...extra }
  writeFileSync(join(root, 'office.json'), JSON.stringify(cfg))
  return { root, cfg }
}
const alert = (root, type, text) => appendFileSync(join(root, '.office', 'alerts.log'), `2026-10-20T08:00:00.000Z ${type} - subj ${text}\n`)
// a fake shell: each ask's stdout comes from `out[name]`
const fakeRun = (out) => (sh, args) => { const name = /ask-(\w+)/.exec(args[1])?.[1]; const v = out[name]; return v instanceof Error ? { status: 3, stdout: '' } : { status: 0, stdout: v ?? '' } }
const asks = [{ name: 'inbox', command: 'ask-inbox' }, { name: 'held', command: 'ask-held' }]

test('first run starts at the END of the alert log; a new alert of a listed type rings once, others never', () => {
  const { root, cfg } = office({ asks: [] })
  let r = poll(root, cfg, { now: T0, state: null })
  assert.deepEqual(r.lines, [], 'yesterday\'s alerts are not replayed')
  alert(root, 'HELD-LEAD', 'draft d1 held 6 min (Kiran)')
  alert(root, 'SOMETHING-ELSE', 'not for the bell')
  r = poll(root, cfg, { now: T0 + 15_000, state: r.state })
  assert.deepEqual(r.lines, ['alert HELD-LEAD subj: draft d1 held 6 min (Kiran)'])
  r = poll(root, cfg, { now: T0 + 30_000, state: r.state })
  assert.deepEqual(r.lines, [], 'the same line does not ring twice')
})

test('asks: an open item rings when it appears, again after repeatMinutes while open, and again if it closes and comes back', () => {
  const { root, cfg } = office({ asks, repeatMinutes: 30 })
  const out = { inbox: 'LM-1\tfrom ops-construction: escalation on PR #870\n', held: '' }
  let r = poll(root, cfg, { now: T0, state: null, run: fakeRun(out) })
  assert.deepEqual(r.lines, ['inbox: from ops-construction: escalation on PR #870'])
  r = poll(root, cfg, { now: T0 + 10 * MIN, state: r.state, run: fakeRun(out) })
  assert.deepEqual(r.lines, [])
  r = poll(root, cfg, { now: T0 + 31 * MIN, state: r.state, run: fakeRun(out) })
  assert.equal(r.lines.length, 1, 'still open after 30 min: rings again')
  r = poll(root, cfg, { now: T0 + 32 * MIN, state: r.state, run: fakeRun({ inbox: '' }) })
  r = poll(root, cfg, { now: T0 + 33 * MIN, state: r.state, run: fakeRun(out) })
  assert.equal(r.lines.length, 1, 'closed and back: rings again')
})

test('a failing ask is said once (and its last items stay open), never read as "nothing open"', () => {
  const { root, cfg } = office({ asks })
  let r = poll(root, cfg, { now: T0, state: null, run: fakeRun({ inbox: 'LM-1\tx', held: '' }) })
  r = poll(root, cfg, { now: T0 + MIN, state: r.state, run: fakeRun({ inbox: new Error('down'), held: '' }) })
  assert.deepEqual(r.lines, ['bell: the inbox ask is failing (exit 3); its items are not being watched'])
  r = poll(root, cfg, { now: T0 + 2 * MIN, state: r.state, run: fakeRun({ inbox: new Error('down'), held: '' }) })
  assert.deepEqual(r.lines, [])
  r = poll(root, cfg, { now: T0 + 3 * MIN, state: r.state, run: fakeRun({ inbox: 'LM-1\tx', held: '' }) })
  assert.deepEqual(r.lines, [], 'LM-1 rang before the failure and is still the same open item')
})

test('rate limit: over maxPerMinute, the last free line counts the rest; a full minute carries the count over', () => {
  const { root, cfg } = office({ asks, maxPerMinute: 3 })
  const many = Array.from({ length: 7 }, (_, i) => `D-${i}\theld draft ${i}`).join('\n')
  let r = poll(root, cfg, { now: T0, state: null, run: fakeRun({ held: many }) })
  assert.equal(r.lines.length, 3)
  assert.match(r.lines[2], /^\+5 more \(rate limit 3\/min\)/)
  alert(root, 'DESK-DEAD', 'desk-customer: no live session')
  r = poll(root, cfg, { now: T0 + 20_000, state: r.state, run: fakeRun({ held: many }) })
  assert.deepEqual(r.lines, [], 'the minute is used up')
  r = poll(root, cfg, { now: T0 + 61_000, state: r.state, run: fakeRun({ held: many }) })
  assert.deepEqual(r.lines, ['+1 more (rate limit 3/min): run the office\'s asks to see them all'])
})

test('restart-safe: the CLI keeps its state in .office/lead-bell-state.json and does not replay', () => {
  const { root } = office({ asks: [] })
  const once = () => spawnSync(process.execPath, [join(PLUGIN, 'lib', 'lead-bell.mjs'), root, '--once'], { encoding: 'utf8' }).stdout
  assert.equal(once(), '')
  alert(root, 'USAGE-LIMIT', 'weekly usage at 91%')
  assert.equal(once(), 'alert USAGE-LIMIT subj: weekly usage at 91%\n')
  assert.equal(once(), '', 'a restart resumes; nothing is replayed')
  assert.ok(loadState(root).offset > 0)
})

test('the lead\'s boot text arms the bell with {plugin} filled in', () => {
  const { root, cfg } = office()
  const lines = bootLines(root, { kind: 'lead' }, cfg, root).join('\n')
  assert.ok(lines.includes(`\`node ${PLUGIN}/lib/lead-bell.mjs\``), lines)
  assert.doesNotMatch(lines, /\{plugin\}/)
})

test('⛔ Monitor is judged: a session\'s own doorbell runs, anything else is judged as the Bash it is', () => {
  const { root } = office({}, { wall: { failClosed: true, lead: { bash: ['^ls( [A-Za-z0-9_./-]+)*$'] } } })
  const HOOK = join(PLUGIN, 'hooks', 'desk-wall.mjs')
  const gate = (role, command) => {
    const cwd = role === 'lead' ? root : join(root, 'desks', role.slice(5))
    const env = { ...process.env, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'oa-bell-cfg-')), OFFICE_ROLE: role }
    return spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name: 'Monitor', tool_input: { command, description: 'x' }, cwd }), encoding: 'utf8', env, cwd }).status
  }
  assert.equal(gate('lead', `node ${PLUGIN}/lib/lead-bell.mjs`), 0, 'the lead\'s own bell')
  assert.equal(gate('lead', 'ls desks'), 0, 'a listed command')
  assert.equal(gate('lead', 'tail -f /etc/hosts'), 2, 'the lead\'s Bash list holds for Monitor too')
  assert.equal(gate('desk-design', 'node ../../bell.mjs design'), 0, 'a desk\'s own doorbell')
  assert.equal(gate('desk-design', 'cp x ../customer/x'), 2, 'a desk\'s Monitor writing outside its folder')
  assert.equal(JSON.parse(readFileSync(join(PLUGIN, 'hooks', 'hooks.json'), 'utf8')).hooks.PreToolUse.some((h) => h.matcher.split('|').includes('Monitor') && h.hooks.some((x) => x.command.includes('desk-wall.mjs'))), true, 'the wall hook is registered for Monitor')
})

test('files: a new matching line in an office-named log rings; a new file starts at its end; wall.lead.monitor lets the office allow more', () => {
  const { root, cfg } = office({ files: [{ name: 'buyers', path: 'desks/design/runtime/lead-alerts.log', match: ' (DRAFT|STALL) ' }] })
  mkdirSync(join(root, 'desks', 'design', 'runtime'), { recursive: true })
  const log = join(root, 'desks', 'design', 'runtime', 'lead-alerts.log')
  writeFileSync(log, 'old DRAFT line\n')
  let r = poll(root, cfg, { now: T0, state: null })
  assert.deepEqual(r.lines, [])
  appendFileSync(log, 't1 DRAFT d9 for Kiran waiting\nt2 NOTE ignored\n')
  r = poll(root, cfg, { now: T0 + 15_000, state: r.state })
  assert.deepEqual(r.lines, ['buyers: t1 DRAFT d9 for Kiran waiting'])
  const HOOK = join(PLUGIN, 'hooks', 'desk-wall.mjs')
  const o2 = office({}, { wall: { failClosed: true, lead: { bash: ['^ls$'], monitor: ['^node scripts/desk/ops\\.mjs alerts --follow$'] } } })
  // an entry naming a script must name a real one (the same rule as wall.lead.bash)
  mkdirSync(join(o2.root, 'scripts', 'desk'), { recursive: true }); writeFileSync(join(o2.root, 'scripts', 'desk', 'ops.mjs'), '')
  const env = { ...process.env, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'oa-bell-cfg-')), OFFICE_ROLE: 'lead' }
  const gate = (command) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name: 'Monitor', tool_input: { command }, cwd: o2.root }), encoding: 'utf8', env, cwd: o2.root }).status
  assert.equal(gate('node scripts/desk/ops.mjs alerts --follow'), 0)
  assert.equal(gate('node scripts/desk/ops.mjs alerts --follow; rm -rf x'), 2, 'anchored at both ends')
})
