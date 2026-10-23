// PARKED JOBS (0.20.1). The owner: prepared work starts with one easy command,
// by whoever opens a session, coworkers included. A parked job has no time; it
// waits for /office-job run <id>, every session that may run it is told at its
// start, and "needs" holds it back until it can work. Run makes it due and the
// watchdog hands it, so nothing is handed twice. Nothing real is launched.
// Also here: the two commit-review fixes of 0.20.0 (the wall's last-known
// prefixes when office.json breaks, and the board's exact tab-title match).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { addJob, runJob, runDue, readJobs, cancelJob, pluginGate, pluginVersion } from '../lib/schedule.mjs'
import { jobLines } from '../hooks/desk-boot.mjs'
import { useRoster, normalizeTitle, terminalFor } from '../board/send.mjs'
import { officeRoster } from '../lib/desk.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const NOW = Date.parse('2026-10-24T02:00:00Z')
const BRIEF = '# Rename the AICS desks\nStop, rename, restart, check, report.\n'
function office() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'oa-park-')))
  mkdirSync(join(root, 'desks', 'x'), { recursive: true })
  writeFileSync(join(root, 'desks', 'x', 'desk.json'), JSON.stringify({ name: 'x', kind: 'knowledge', port: 9921 }))
  const cfg = {
    roleEnv: 'OFFICE_ROLE',
    departments: { 'customer-service': { dir: 'departments/aics', lead: 'AICS', desks: [] }, 'local-ops': { lead: 'ERP', desks: [] } },
    construction: [{ name: 'construction', root: '.' }],
    profiles: { construction: { cwd: '.' }, full: { cwd: '.' }, aics: { department: 'customer-service' }, erp: { department: 'local-ops' } },
  }
  writeFileSync(join(root, 'office.json'), JSON.stringify(cfg))
  mkdirSync(join(root, '.office'), { recursive: true })
  writeFileSync(join(root, '.office', 'local.json'), JSON.stringify({ departments: ['customer-service'] }))
  return { root, cfg }
}
const park = (o, x = {}) => addJob(o.root, { id: 'rename-and-tidy', role: 'full', text: BRIEF, parked: true, by: 'construction', ...x }, { cfg: o.cfg, now: NOW })

test('a parked job has no time and waits; one with a time and --parked is refused; so is a bad gate', () => {
  const o = office()
  const r = park(o, { needs: { plugin: '>=0.20.0' } })
  assert.ok(r.job, r.why)
  assert.deepEqual([r.job.state, r.job.at, r.job.until, r.job.needs], ['parked', null, null, { plugin: '>=0.20.0' }])
  assert.match(park(o, { id: 'other', at: '2026-10-24T05:00:00Z' }).why, /a parked job has no time/)
  for (const [needs, why] of [[{ plugin: '0.20' }, /write ">=0.20.0"/], [{ when: 'x' }, /not a gate/], [{ command: 'a\nb' }, /one line/]]) assert.match(park(o, { id: 'bad-gate', needs }).why, why)
  // the watchdog never hands a parked job
  const acts = []
  runDue(o.root, { cfg: o.cfg, now: NOW + 86400_000, open: () => { throw new Error('opened a parked job') }, act: (a) => acts.push(a) })
  assert.equal(readJobs(o.root)[0].state, 'parked')
  assert.equal(acts.length, 0)
})

test('⛔ run makes it due now and the watchdog hands it, once; not parked, a desk, or another department\'s role is refused', () => {
  const o = office()
  park(o)
  assert.match(runJob(o.root, 'rename-and-tidy', { cfg: o.cfg, now: NOW, caller: { kind: 'desk', desk: 'x' } }).why, /a desk does not run/)
  const r = runJob(o.root, 'rename-and-tidy', { cfg: o.cfg, now: NOW, by: 'a coworker' })
  assert.ok(r.job, r.why)
  assert.deepEqual([r.job.state, r.job.at, r.job.runBy], ['pending', new Date(NOW).toISOString(), 'a coworker'])
  assert.match(runJob(o.root, 'rename-and-tidy', { cfg: o.cfg, now: NOW }).why, /is pending, not parked: it is due already/)
  const opened = []
  runDue(o.root, { cfg: o.cfg, now: NOW + 60_000, open: (root, role, x) => { opened.push({ role, prompt: x.prompt }); return { state: 'opened', why: 'stub' } } })
  runDue(o.root, { cfg: o.cfg, now: NOW + 180_000, open: (root, role, x) => { opened.push({ role }); return { state: 'opened', why: 'stub' } } })
  assert.equal(opened.length, 1, 'handed once')
  assert.match(opened[0].prompt, /Scheduled office job rename-and-tidy is due/)
  assert.equal(readJobs(o.root)[0].state, 'handed')
  // another department's role: never parked here, where it would never run (.office is this machine's)
  assert.match(park(o, { id: 'erp-only', role: 'erp' }).why, /belongs to a department this machine does not run/)
  park(o, { id: 'second', role: 'construction' })
  assert.ok(cancelJob(o.root, 'second', 'the owner moved this to the ERP machine').job, 'a parked job can be cancelled')
})

test('⛔ "needs" holds it: an older plugin, or a command that does not exit 0; the watchdog re-checks the plugin', () => {
  const o = office()
  park(o, { needs: { plugin: '>=0.20.0' } })
  assert.match(runJob(o.root, 'rename-and-tidy', { cfg: o.cfg, now: NOW, version: '0.19.7' }).why, /needs office-anything >=0.20.0; this is 0.19.7/)
  assert.equal(pluginGate({ needs: { plugin: '>=0.20.0' } }, '0.20.0'), null, 'equal is enough')
  assert.equal(pluginGate({ needs: { plugin: '>=0.20.0' } }, '0.21.3'), null)
  assert.equal(readJobs(o.root)[0].state, 'parked', 'still parked')
  park(o, { id: 'needs-file', needs: { command: 'test -f ready.flag' } })
  const said = []
  assert.match(runJob(o.root, 'needs-file', { cfg: o.cfg, now: NOW, say: (t) => said.push(t) }).why, /needs `test -f ready\.flag` to exit 0, and it exited 1/)
  assert.deepEqual(said, ['checking: test -f ready.flag'], 'the command is printed before it runs')
  writeFileSync(join(o.root, 'ready.flag'), '')
  assert.ok(runJob(o.root, 'needs-file', { cfg: o.cfg, now: NOW }).job)
  // a watchdog older than the run holds it too, and says so
  const j = readJobs(o.root)
  j.find((x) => x.id === 'rename-and-tidy').state = 'pending'
  Object.assign(j.find((x) => x.id === 'rename-and-tidy'), { at: new Date(NOW).toISOString(), until: new Date(NOW + 3600_000).toISOString(), needs: { plugin: '>=99.0.0' } })
  writeFileSync(join(o.root, '.office', 'schedule.json'), JSON.stringify({ jobs: j }))
  const acts = []
  runDue(o.root, { cfg: o.cfg, now: NOW + 60_000, open: () => ({ state: 'opened', why: 'stub' }), act: (a) => acts.push(a) })
  assert.match(acts.find((a) => a.job === 'rename-and-tidy').why, /needs office-anything >=99\.0\.0/)
  assert.equal(readJobs(o.root).find((x) => x.id === 'rename-and-tidy').state, 'pending')
  assert.ok(pluginVersion(), 'this plugin knows its version')
})

test('at session start: a role sees its own parked jobs, the lead and the root every one here, a desk none', () => {
  const o = office()
  park(o)
  park(o, { id: 'aics-notes', role: 'aics', needs: { plugin: '>=99.0.0' } })
  park(o, { id: 'tidy-later', role: 'construction' })
  const lines = (env, who) => jobLines(o.root, o.cfg, env, who).join('\n')
  const own = lines({ OFFICE_PROFILE: 'full' }, null)
  assert.match(own, /1 prepared job waiting for this role:\n- rename-and-tidy \(role full\): \/office-job run rename-and-tidy/)
  const root = lines({}, null)
  assert.match(root, /3 prepared jobs waiting/)
  assert.match(root, /aics-notes \(role aics\): \/office-job run aics-notes \(held: it needs office-anything >=99\.0\.0/)
  assert.match(lines({}, { kind: 'lead', role: 'AICS' }), /3 prepared jobs waiting/, 'the lead sees what is prepared')
  assert.doesNotMatch(lines({ OFFICE_PROFILE: 'construction' }, null), /rename-and-tidy|aics-notes/)
  assert.equal(lines({}, { kind: 'desk', desk: 'x' }), '', 'a desk runs no role\'s job')
})

test('the /office-job command runs the plugin\'s own runJob and says why not to hand-edit schedule.json', () => {
  const md = readFileSync(join(REPO, 'commands', 'office-job.md'), 'utf8')
  assert.match(md, /lib\/schedule\.mjs/)
  assert.match(md, /runJob/)
  assert.match(md, /⛔/)
  assert.match(readFileSync(join(REPO, 'README.md'), 'utf8'), /\/office-job/)
})

// ── the commit review of 0.20.0 ───────────────────────────────────────────
const HOOK = join(REPO, 'hooks', 'desk-wall.mjs')
function as(root, name, tool_name, tool_input) {
  const c = mkdtempSync(join(tmpdir(), 'oa-park-cfg-'))
  mkdirSync(join(c, 'sessions'))
  writeFileSync(join(c, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, name }))
  const env = { ...process.env, CLAUDE_CONFIG_DIR: c }; delete env.OFFICE_ROLE; delete env.CLAUDE_PROJECT_DIR
  return spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name, tool_input, cwd: root }), encoding: 'utf8', env, cwd: root, timeout: 15000 }).status
}
test('⛔ office.json broken: a session named by a prefix the wall last saw still claims a desk and is refused', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'oa-park-wall-')))
  mkdirSync(join(root, 'departments', 'aics', 'web', 'runtime'), { recursive: true })
  writeFileSync(join(root, 'departments', 'aics', 'web', 'desk.json'), JSON.stringify({ name: 'web', kind: 'knowledge', port: 9931 }))
  writeFileSync(join(root, 'office.json'), JSON.stringify({ roleEnv: 'OFFICE_ROLE', departments: { aics: { lead: 'AICS', desks: ['web'], prefix: 'aics' } }, wall: { failClosed: true } }))
  assert.equal(as(root, 'aics-web', 'Bash', { command: 'ls' }), 0, 'a good read: and the prefixes are remembered')
  assert.deepEqual(JSON.parse(readFileSync(join(root, '.office', 'session-prefixes.json'), 'utf8')), ['aics', 'desk'])
  writeFileSync(join(root, 'office.json'), '{ "roleEnv": ')
  assert.equal(as(root, 'aics-web', 'Bash', { command: 'ls' }), 2)
  assert.equal(as(root, 'aics-anything', 'Bash', { command: 'ls' }), 2)
  assert.equal(as(root, 'alibaba-98', 'Write', { file_path: join(root, 'office.json'), content: '{}' }), 0, 'a developer can still fix the file')
})

test('⛔ the board: a tab is a desk only by an exact name; a prefix stripped is not a desk, a tie is not guessed', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'oa-park-board-')))
  mkdirSync(join(root, 'departments', 'aics', 'web'), { recursive: true })
  writeFileSync(join(root, 'departments', 'aics', 'web', 'desk.json'), JSON.stringify({ name: 'web', kind: 'knowledge', port: 9941 }))
  writeFileSync(join(root, 'office.json'), JSON.stringify({ departments: { aics: { lead: 'AICS', desks: ['web'], prefix: 'aics' }, ops: { lead: 'ERP', desks: [], prefix: 'erp' } } }))
  useRoster(officeRoster(root).desks)
  try {
    assert.equal(normalizeTitle('✳ aics-web'), 'web')
    assert.equal(normalizeTitle('erp-web'), 'erp-web', 'another department\'s prefix does not reach desk web')
    assert.equal(normalizeTitle('desk-web'), 'web', 'its old name')
    const list = (titles) => () => JSON.stringify({ result: { terminals: titles.map((t, i) => ({ handle: 'h' + i, title: t })) } })
    assert.equal(terminalFor('web', list(['desk-web', '✳ aics-web'])), 'h1', 'its current name first')
    assert.equal(terminalFor('web', list(['aics-web', '✶ aics-web'])), null, 'two tabs of one name: not guessed')
    assert.equal(terminalFor('web', list(['erp-web'])), null)
  } finally { useRoster(null) }
})
