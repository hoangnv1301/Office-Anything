// RELEASE NOTES (0.18.1). The owner, 2026-10-23: none had been posted since
// 0.9.0. The release step posts each version's note itself
// (scripts/release-post.mjs), the note is checked against the forum verb's own
// rules before it goes, and health warns while the loaded version has none.
// Nothing here touches the network: git, gh and ops.mjs are injected.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { notes, noteProblem, postNote, semverSort } from '../scripts/release-post.mjs'
import { releaseNoteMissing } from '../lib/health.mjs'

const VERSION = JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version

test('⛔ the version being shipped has a release note, and every note passes the forum\'s rules', () => {
  const N = notes()
  assert.ok(N[VERSION], `docs/releases.json has no note for ${VERSION}: bumping the version means writing its note`)
  for (const v of Object.keys(N).filter((k) => !k.startsWith('_')).sort(semverSort)) assert.equal(noteProblem(v, N[v]), null, v)
})

test('a note the forum would refuse is refused here first', () => {
  const ok = { date: '2026-10-23', new: ['A thing works now.'] }
  assert.equal(noteProblem('1.2.3', ok), null)
  assert.match(noteProblem('1.2.3', { ...ok, new: ['Fixed in PR 71.'] }), /internal number/)
  assert.match(noteProblem('1.2.3', { ...ok, new: ['See #1472.'] }), /internal number/)
  assert.match(noteProblem('1.2.3', { ...ok, new: ['x'.repeat(161)] }), /161 characters, at most 160/)
  assert.match(noteProblem('1.2.3', { ...ok, notes: ['x'] }), /not a section/)
  assert.match(noteProblem('1.2.3', { date: '2026-10-23' }), /says nothing/)
  assert.match(noteProblem('v1.2', ok), /not a plugin version/)
})

// a fake world: gh says the release exists, ops.mjs answers as told
const world = (opsAnswer) => {
  const calls = []
  const r = (cmd, args, opts) => {
    calls.push({ cmd, args, env: opts?.env })
    if (cmd === 'gh') return { status: 0, stdout: '{"tagName":"v1"}' }
    if (cmd === 'git') return { status: 0, stdout: 'abc\n' }
    return opsAnswer
  }
  return { r, calls }
}
test('⛔ the post goes through ops.mjs as the lead, never with a key of its own, and a refusal is loud', () => {
  const { r, calls } = world({ status: 0, stdout: '{"id":"p1","status":"queued"}\n' })
  const got = postNote(VERSION, { r, ops: '/ops' })
  assert.equal(got.state, 'posted', got.why)
  const op = calls.find((c) => c.cmd === process.execPath)
  assert.deepEqual(op.args.slice(1, 3), ['propose', '发版本日志'])
  assert.deepEqual(JSON.parse(op.args[3]), { product: 'office-anything', release: VERSION, date: notes()[VERSION].date, sections: Object.fromEntries(['new', 'fixed', 'improved', 'todo'].filter((k) => notes()[VERSION][k]?.length).map((k) => [k, notes()[VERSION][k]])) })
  assert.equal(op.env.LCC_ROLE, 'lead')
  assert.equal(op.env.OPS_TOKEN, '', 'no key handed in: ops.mjs picks the lead\'s')
  assert.ok(!op.args.some((a) => /^key=/.test(a)), 'no idempotency key: it would hand back a rejection for ever')
  assert.equal(postNote(VERSION, { r: world({ status: 0, stdout: '{"id":"p1","dup":true}\n' }).r, ops: '/ops' }).state, 'dup')
  const refused = postNote(VERSION, { r: world({ status: 1, stderr: 'Office-Anything release channel not configured: its forum channel id is not set' }).r, ops: '/ops' })
  assert.equal(refused.state, 'refused')
  assert.match(refused.why, /channel not configured/)
  assert.equal(postNote(VERSION, { r: world({ status: 1, stderr: '24 小时最多 10 条发布日志：今天发够了' }).r, ops: '/ops' }).state, 'cap')
  // ⛔ the real answer of 2026-10-23: exit 0, and rejected
  const real = '{"id":"53773cd5-306a-4bce-a677-4a72a623c9b0","status":"rejected","result":{"error":"Office-Anything release channel not configured: its forum channel id is not set in lib/release-channels.ts yet"},"error":"Office-Anything release channel not configured: its forum channel id is not set in lib/release-channels.ts yet","dup":true}\n'
  const rej = postNote(VERSION, { r: world({ status: 0, stdout: real }).r, ops: '/ops' })
  assert.equal(rej.state, 'refused')
  assert.match(rej.why, /release channel not configured/)
  assert.equal(postNote(VERSION, { r: world({ status: 0, stdout: '{"status":"rejected","error":"24 小时最多 10 条发布日志：今天发够了"}\n' }).r, ops: '/ops' }).state, 'cap')
  assert.equal(postNote(VERSION, { r: world({ status: 0, stdout: 'not json' }).r, ops: '/ops' }).state, 'refused', 'an answer it cannot read is not a post')
})

test('⛔ health warns while the loaded version has no release note, and asks the book at most every 30 minutes', () => {
  const root = mkdtempSync(join(tmpdir(), 'oa-rel-'))
  mkdirSync(join(root, '.office'), { recursive: true })
  const cfg = { releases: { posted: 'node scripts/x.mjs posted' } }
  let asked = 0
  const run = (out) => () => { asked++; return { status: 0, stdout: out } }
  assert.match(releaseNoteMissing(root, cfg, { loaded: '0.18.1', run: run('0.18.0\nv0.17.0\n') }), /no release note posted for office-anything 0\.18\.1/)
  assert.equal(releaseNoteMissing(root, cfg, { loaded: '0.18.0', run: run('0.18.0\n') }), null)
  // posted: the next look within 30 minutes asks nothing
  asked = 0
  assert.equal(releaseNoteMissing(root, cfg, { loaded: '0.18.0', run: run('') }), null)
  assert.equal(asked, 0)
  assert.match(releaseNoteMissing(root, cfg, { loaded: '0.18.0', run: () => ({ status: 3, stdout: '' }), now: Date.now() + 31 * 60_000 }), /UNKNOWN/, 'a failing ask is not "posted"')
  assert.equal(releaseNoteMissing(root, {}, { loaded: '0.18.0' }), null, 'not asked: nothing said')
})
