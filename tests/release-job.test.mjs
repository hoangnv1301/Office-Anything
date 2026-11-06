// A RELEASE IS A JOB WITH STEPS, EACH A CASE WITH AN OWNER AND AN ALARM (Office-Anything #97, 2026-11-06).
// 0.22.0 was released and then nothing moved until the owner asked twice.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startRelease, releaseStatus, closeStep, installHere, releaseConfig } from '../lib/release-job.mjs'
import { readTasks } from '../lib/tasks.mjs'
import { followThrough } from '../lib/follow.mjs'
import { captureWords, recordApproval } from '../lib/approvals.mjs'
import { closeNoteStep } from '../scripts/release-post.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'lib', 'release-job.mjs')
const MIN = 60_000
const T0 = Date.parse('2026-11-06T09:00:00Z')
const CFG = { roleEnv: 'OFFICE_ROLE', lead: { session: 'Lead' }, plugin: { approved: ['0.22.0', '0.24.0'] },
  release: { notify: ['David'], machines: [{ name: 'mac', host: 'Airm1-Mac.local', session: 'full' }, { name: 'box', host: 'box1' }] } }
function office(cfg = CFG) {
  const root = mkdtempSync(join(tmpdir(), 'oa-rel-'))
  mkdirSync(join(root, 'desks', 'aics'), { recursive: true })
  writeFileSync(join(root, 'desks', 'aics', 'desk.json'), JSON.stringify({ name: 'aics', kind: 'knowledge', port: 9721 }))
  writeFileSync(join(root, 'office.json'), JSON.stringify(cfg))
  return root
}

test('start puts every step down as a case with an owner and a due time, once', () => {
  const root = office()
  const r = startRelease(root, CFG, '0.24.0', { now: T0 })
  assert.deepEqual(r.created, ['release:0.24.0:note', 'release:0.24.0:notify:David', 'release:0.24.0:install:mac', 'release:0.24.0:install:box'])
  const t = Object.fromEntries(readTasks(root).map((x) => [x.key, x]))
  assert.equal(t['release:0.24.0:note'].assigned, 'lead'); assert.equal(t['release:0.24.0:note'].dueAt, T0 + 60 * MIN)
  assert.equal(t['release:0.24.0:notify:David'].dueAt, T0 + 120 * MIN)
  assert.equal(t['release:0.24.0:install:mac'].assigned, 'full'); assert.equal(t['release:0.24.0:install:box'].assigned, 'lead')
  assert.equal(t['release:0.24.0:install:mac'].kind, 'step')
  assert.deepEqual(startRelease(root, CFG, '0.24.0', { now: T0 + MIN }).created, [], 'a second start changes nothing')
  assert.equal(readTasks(root).length, 4)
  assert.throws(() => startRelease(root, CFG, 'latest'), /not a plugin version/)
  assert.deepEqual(releaseConfig({}).machines, [])
})

test('a step nobody closes is rung, raised and said to the owner, like an ask; a closed one never is', () => {
  const root = office()
  startRelease(root, CFG, '0.24.0', { now: T0 })
  const at = (m) => followThrough(root, CFG, { now: T0 + m * MIN })
  assert.deepEqual(at(30), [])
  const first = at(65)
  assert.deepEqual(first.map((a) => a.id.length > 0 && a.step), ['due'], 'only the note is due at 65 min')
  assert.match(first[0].text, /^NUDGE lead T-\d+-1: "release 0\.24\.0: post the release note \(lead\)" was due 5 minutes ago/)
  // the note is closed by the script that posted it
  closeStep(root, '0.24.0', 'note', { evidence: 'forum post', proof: 'accepted' }, { now: T0 + 70 * MIN })
  assert.deepEqual(at(100).map((a) => a.step), [], 'the closed step is never rung')
  const later = at(130)
  assert.ok(later.every((a) => !/post the release note/.test(a.text)), JSON.stringify(later))
  assert.equal(later.length, 1, 'tell David is due at 120')
  assert.throws(() => closeStep(root, '0.24.0', 'note', { evidence: 'x', proof: 'y' }), /no open step/)
  assert.throws(() => closeStep(root, '0.24.0', 'notify:David', { evidence: '', proof: 'y' }), /--evidence/)
})

test('a step the assignee marked done is not rung; the stale-task road asks the lead to verify it', () => {
  const root = office()
  startRelease(root, CFG, '0.24.0', { now: T0 })
  const id = readTasks(root).find((t) => t.key.endsWith(':note')).id
  const tasks = readFileSync(join(root, '.office', 'tasks.jsonl'), 'utf8')
  writeFileSync(join(root, '.office', 'tasks.jsonl'), tasks + JSON.stringify({ at: T0 + MIN, by: 'lead', ev: 'update', id, state: 'done' }) + '\n')
  assert.deepEqual(followThrough(root, CFG, { now: T0 + 90 * MIN }).filter((a) => a.id === id), [])
})

test('status says who has the owner\'s yes to tell each person, and who does not', () => {
  const root = office()
  startRelease(root, CFG, '0.24.0', { now: T0 })
  assert.equal(releaseStatus(root, CFG, '0.24.0', { now: T0 }).find((s) => s.step === 'notify:David').approved, false)
  const tr = join(root, 't.jsonl')
  writeFileSync(tr, JSON.stringify({ type: 'user', promptId: 'p1', turnOrigin: 'human', promptSource: 'typed', message: { content: 'yes, tell David' } }) + '\n')
  captureWords(root, { session: 'full', text: 'yes, tell David', promptId: 'p1', transcript: tr }, { now: T0 })
  recordApproval(root, { session: 'full', quote: 'tell David', action: 'notify-release', target: 'David' }, { now: T0 + 1000 })
  const s = releaseStatus(root, CFG, '0.24.0', { now: T0 + 2000 })
  assert.equal(s.find((x) => x.step === 'notify:David').approved, true)
  assert.equal(s.find((x) => x.step === 'note').approved, undefined)
})

const fakeInstalled = (v) => () => v
test('install: only a listed machine, only an approved version, never a busy machine; dry unless --apply', () => {
  const root = office()
  startRelease(root, CFG, '0.24.0', { now: T0 })
  const base = { host: 'airm1-mac', sessions: [], installed: fakeInstalled('0.20.5'), now: T0 }
  assert.equal(installHere(root, CFG, { ...base, host: 'stranger' }).state, 'not-listed')
  const no = installHere(root, CFG, { ...base, version: '0.30.0' })
  assert.equal(no.state, 'not-approved'); assert.match(no.blockedBy, /owner approves 0\.30\.0 .* plugin\.approved/)
  assert.equal(installHere(root, { ...CFG, plugin: {} }, base).state, 'not-approved')
  const busy = installHere(root, CFG, { ...base, sessions: [{ pid: 1, name: 'alibaba-98', status: 'busy' }, { pid: 2, name: 'lead', status: 'idle' }] })
  assert.equal(busy.state, 'busy'); assert.deepEqual(busy.busy, ['alibaba-98'])
  const dry = installHere(root, CFG, { ...base, sessions: [{ pid: 2, name: 'lead', status: 'idle' }] })
  assert.equal(dry.state, 'would-update'); assert.equal(dry.target, '0.24.0'); assert.equal(dry.from, '0.20.5'); assert.deepEqual(dry.restart, ['lead'])
  assert.match(dry.cmds[1], /^claude plugin update office-anything@/)
  assert.equal(readTasks(root).find((t) => t.key.endsWith('install:mac')).state, 'open', 'a dry run closes nothing')
})

test('install --apply runs the update, reads the installed version back, and only then closes the step', () => {
  const root = office()
  startRelease(root, CFG, '0.24.0', { now: T0 })
  const calls = []
  let v = '0.20.5'
  const run = (c, a) => { calls.push([c, ...a].join(' ')); if (a.includes('update') && a.includes('plugin') && !a.includes('marketplace')) v = '0.24.0'; return { status: 0 } }
  const r = installHere(root, CFG, { host: 'airm1-mac', apply: true, sessions: [{ pid: 2, name: 'lead', status: 'idle' }], installed: () => v, run, now: T0 + MIN })
  assert.equal(r.state, 'updated'); assert.equal(calls.length, 2); assert.match(calls[0], /marketplace update/)
  assert.match(r.why, /need a restart: lead/)
  const t = readTasks(root).find((x) => x.key.endsWith('install:mac'))
  assert.equal(t.state, 'verified'); assert.match(t.evidence[0].proof, /reads 0\.24\.0/)
  assert.equal(installHere(root, CFG, { host: 'airm1-mac', sessions: [], installed: () => '0.24.0', now: T0 }).state, 'current')
})

test('a failed update, or one that leaves the old version, closes nothing and says why', () => {
  const root = office()
  startRelease(root, CFG, '0.24.0', { now: T0 })
  const args = { host: 'box1', apply: true, sessions: [], now: T0 }
  assert.match(installHere(root, CFG, { ...args, installed: () => '0.20.5', run: () => ({ status: 1, stderr: 'network down\n' }) }).why, /failed .*network down/)
  const stale = installHere(root, CFG, { ...args, installed: () => '0.20.5', run: () => ({ status: 0 }) })
  assert.equal(stale.state, 'failed'); assert.match(stale.why, /reads 0\.20\.5, not 0\.24\.0/)
  assert.equal(readTasks(root).find((x) => x.key.endsWith('install:box')).state, 'open')
})

test('the release post closes the note step it just proved', async () => {
  const root = office()
  startRelease(root, CFG, '0.24.0', { now: T0 })
  assert.ok(await closeNoteStep('0.24.0', root))
  assert.equal(readTasks(root).find((x) => x.key.endsWith(':note')).state, 'verified')
  assert.equal(await closeNoteStep('0.24.0', root), null, 'twice is a no-op')
  assert.equal(await closeNoteStep('0.24.0', mkdtempSync(join(tmpdir(), 'oa-rel-none-'))), null, 'no office there: nothing to close')
})

test('CLI: start, status, done', () => {
  const root = office()
  const run = (...a) => spawnSync(process.execPath, [CLI, root, ...a], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'oa-rel-cfg-')) } })
  assert.match(run('start', '0.24.0').stdout, /4 step\(s\) put down: note, notify:David, install:mac, install:box/)
  assert.match(run('status').stdout, /note\s+open\s+lead[\s\S]*notify:David[\s\S]*no owner yes yet/)
  assert.equal(run('done', '0.24.0', 'note').status, 1, 'no evidence, no close')
  assert.match(run('done', '0.24.0', 'note', '--evidence', 'forum post', '--proof', 'accepted').stdout, /closed/)
  assert.match(run('status', '0.24.0').stdout, /note\s+verified/)
})
