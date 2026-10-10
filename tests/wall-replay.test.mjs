// FALSE REFUSALS FOUND BY REPLAYING 5,000 REAL DESK COMMANDS (local-cabinets-ops,
// 2026-10-10): 7 commands their own wall allowed and this one refused. Each
// shape is pinned here as ALLOWED, beside the attack it must still refuse.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'desk-wall.mjs')
function office(wall = { lockedEnv: ['OPS_TOKEN', 'CASE_SESSION'] }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'oa-replay-')))
  for (const n of ['design', 'manufacturing']) {
    mkdirSync(join(root, 'desks', n, 'runtime'), { recursive: true })
    mkdirSync(join(root, 'desks', n, 'work-a', 'from-buyer'), { recursive: true })
    writeFileSync(join(root, 'desks', n, 'desk.json'), JSON.stringify({ name: n, kind: 'knowledge', port: 9900 + n.length }))
  }
  mkdirSync(join(root, 'desks', 'manufacturing', 'skills', 'production-server'), { recursive: true })
  mkdirSync(join(root, 'desks', 'design', '.claude', 'skills'), { recursive: true })
  symlinkSync(join(root, 'desks', 'manufacturing', 'skills', 'production-server'), join(root, 'desks', 'design', '.claude', 'skills', 'production-server'))
  mkdirSync(join(root, 'lib'), { recursive: true })
  writeFileSync(join(root, 'office.json'), JSON.stringify({ roleEnv: 'OFFICE_ROLE', lead: { session: 'Office Lead' }, wall }))
  return root
}
const ROOT = office()
const run = (tool_name, tool_input, cwd = join(ROOT, 'desks', 'design')) => {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'oa-cfg-')) }; delete env.OFFICE_ROLE; delete env.CLAUDE_PROJECT_DIR
  return spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name, tool_input, cwd }), encoding: 'utf8', env, cwd, timeout: 20000 }).status
}
const ok = (t, i, c) => assert.equal(run(t, i, c), 0, JSON.stringify(i))
const no = (t, i, c) => assert.equal(run(t, i, c), 2, JSON.stringify(i))

test('(1) a here-string after read is data, not a variable name', () => {
  ok('Bash', { command: `IFS='|' read a b <<< "$x"` })
  ok('Bash', { command: 'read -r line < "$f"' })
  no('Bash', { command: 'read -r "$N" <<< x' })
})

test('(2) after a cd, a path is read from where the shell stands, not from every folder it passed', () => {
  // resolved from the desk folder, ../from-buyer would be desks/from-buyer: "another desk"
  ok('Bash', { command: 'cd work-a/from-buyer && grep -rl price ../from-buyer' })
  ok('Bash', { command: 'cd work-a/from-buyer && cat ../../facts.md' })
  no('Bash', { command: 'cd work-a && cat ../../manufacturing/runtime/token.json' })
})

test('(3) a quoted grep pattern is a pattern, not a glob over the folder', () => {
  // from the repo root, the pattern's "." used to resolve to the root: "a glob over every desk"
  ok('Bash', { command: 'cd ../.. && grep -rn "price.*total" lib' })
  ok('Bash', { command: "cd ../.. && grep -rn 'SC-[0-9]*' lib" })
  no('Bash', { command: 'cat ../*/runtime/*' })
})

test('(5) a symlink in the desk\'s own folder to another desk\'s non-runtime files is the desk\'s own to search', () => {
  ok('Grep', { pattern: 'x', path: join(ROOT, 'desks', 'design', '.claude', 'skills', 'production-server') })
  ok('Bash', { command: 'grep -r x .claude/skills/production-server' })
  // the link still does not reach a runtime/
  no('Read', { file_path: join(ROOT, 'desks', 'manufacturing', 'runtime', 'token.json') })
})

test('(4) the office module\'s deadline has room under load, and an office can set it', async () => {
  const { MODULE_DEADLINE_MS } = await import('../lib/wall-module.mjs')
  assert.ok(MODULE_DEADLINE_MS >= 5000, `the default deadline is ${MODULE_DEADLINE_MS} ms`)
  const { moduleDeadline } = await import('../hooks/desk-wall.mjs')
  assert.equal(moduleDeadline({ wall: { moduleTimeoutMs: 3000 } }), 3000)
  assert.equal(moduleDeadline({ wall: { moduleTimeoutMs: 60000 } }), 8000, 'never past the hook\'s own timeout')
  assert.equal(moduleDeadline({ wall: {} }), MODULE_DEADLINE_MS)
})
