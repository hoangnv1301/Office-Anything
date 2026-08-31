import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GATE = join(ROOT, 'hooks', 'send-wall-gate.mjs')

// ⛔ A CHECK REPORTS. A GATE BLOCKS. These test the gate, and the difference is the
// whole reason both exist: the check tells you a knowledge desk grew a sender AFTER it
// happened, if somebody runs it. This refuses the write.

function run(payload) {
  try {
    execFileSync('node', [GATE], { input: JSON.stringify(payload), encoding: 'utf8', stdio: 'pipe' })
    return { code: 0, err: '' }
  } catch (e) { return { code: e.status, err: String(e.stderr ?? '') } }
}

function desk(kind, live = false) {
  const root = mkdtempSync(join(tmpdir(), 'oa-gate-'))
  mkdirSync(join(root, 'desks', 'd'), { recursive: true })
  writeFileSync(join(root, 'desks', 'd', 'desk.json'),
    JSON.stringify({ name: 'd', kind, port: 9223, live }))
  return { root, sender: join(root, 'desks', 'd', 'runtime', 'send', 'out.mjs') }
}

test('⛔ writing a sender into a KNOWLEDGE desk is BLOCKED', () => {
  const { root, sender } = desk('knowledge')
  const r = run({ tool_input: { file_path: sender } })
  assert.equal(r.code, 2, 'exit 2 is what actually stops the tool call')
  assert.match(r.err, /KNOWLEDGE desk/)
  rmSync(root, { recursive: true, force: true })
})

test('⛔ and the refusal tells you the RIGHT fix, not just "no"', () => {
  const { root, sender } = desk('knowledge')
  assert.match(run({ tool_input: { file_path: sender } }).err, /Change its\s+kind/,
    'a block that does not say what to do instead gets worked around')
  rmSync(root, { recursive: true, force: true })
})

test('⛔ a DARK channel desk getting a sender is BLOCKED', () => {
  const { root, sender } = desk('channel', false)
  assert.equal(run({ tool_input: { file_path: sender } }).code, 2,
    'going live must be a reviewed edit, not a file quietly appearing')
  rmSync(root, { recursive: true, force: true })
})

test('a LIVE channel desk getting a sender is allowed', () => {
  const { root, sender } = desk('channel', true)
  assert.equal(run({ tool_input: { file_path: sender } }).code, 0)
  rmSync(root, { recursive: true, force: true })
})

test('an unrelated file is none of the gate\'s business', () => {
  assert.equal(run({ tool_input: { file_path: '/tmp/notes.txt' } }).code, 0)
})

// ⛔ THE ONE THAT MATTERS MOST FOR A HOOK. This runs on EVERY Write and Edit in the repo.
// If it throws on something it did not expect, it blocks all of them.
test('⛔ garbage input exits 0. A crashing hook must never block every write.', () => {
  try {
    execFileSync('node', [GATE], { input: 'not json at all', encoding: 'utf8', stdio: 'pipe' })
  } catch (e) { assert.fail(`the gate exited ${e.status} on unparseable input`) }
})

test('hooks.json points at a file that exists and is registered for Write and Edit', () => {
  const h = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8'))
  const pre = h.hooks?.PreToolUse
  assert.ok(Array.isArray(pre) && pre.length, 'PreToolUse must be registered or the gate never runs')
  assert.match(pre[0].matcher, /Write/)
  assert.match(pre[0].matcher, /Edit/)
  assert.match(pre[0].hooks[0].command, /send-wall-gate\.mjs/)
})
