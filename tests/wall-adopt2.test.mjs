// WHAT STILL STOOD BETWEEN 0.9.1 AND REPLACING AN OFFICE'S OWN WALL (the
// local-cabinets-ops replay, 2026-10-10): /dev/null counted as a write outside
// the desk (45 real commands, ~0.9% of desk Bash), `=>` in quoted code read as
// a redirect, a recursive grep naming another desk's facts.md FILE refused,
// and three parity gaps: zsh ${(e)…}, the <> redirect, and ~/.claude.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'desk-wall.mjs')
const ROOT = (() => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'oa-adopt2-')))
  for (const n of ['design', 'customer']) {
    mkdirSync(join(root, 'desks', n, 'runtime'), { recursive: true })
    writeFileSync(join(root, 'desks', n, 'desk.json'), JSON.stringify({ name: n, kind: 'knowledge', port: 9960 + n.length }))
    writeFileSync(join(root, 'desks', n, 'facts.md'), 'facts\n')
  }
  mkdirSync(join(root, 'lib'), { recursive: true })
  writeFileSync(join(root, 'office.json'), JSON.stringify({ roleEnv: 'OFFICE_ROLE', lead: { session: 'Office Lead' }, wall: { lockedEnv: ['OPS_TOKEN'] } }))
  return root
})()
const CFG = realpathSync(mkdtempSync(join(tmpdir(), 'oa-claudecfg-')))
const run = (tool_name, tool_input) => {
  const cwd = join(ROOT, 'desks', 'design')
  const env = { ...process.env, CLAUDE_CONFIG_DIR: CFG }; delete env.OFFICE_ROLE; delete env.CLAUDE_PROJECT_DIR
  return spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name, tool_input, cwd }), encoding: 'utf8', env, cwd, timeout: 20000 }).status
}
const ok = (t, i) => assert.equal(run(t, i), 0, JSON.stringify(i))
const no = (t, i) => assert.equal(run(t, i), 2, JSON.stringify(i))

test('(A) /dev/null, /dev/stderr and /dev/stdout are not writes outside the desk', () => {
  for (const command of ['ls work 2>/dev/null', 'node a.mjs > /dev/null 2>&1', 'node a.mjs &>/dev/null', 'echo x >/dev/stderr', 'echo x 1>/dev/stdout', 'cat x 2> /dev/null']) ok('Bash', { command })
  no('Bash', { command: 'echo x > ../../lib/x.mjs 2>/dev/null' })
  no('Bash', { command: 'echo x >/dev/null >../../lib/x.mjs' })
  // operators glued together are still separate redirections
  no('Bash', { command: 'echo x 2>&1>../../lib/x.mjs' })
  no('Bash', { command: 'exec 3>../../lib/x.mjs' })
  no('Bash', { command: 'echo x>|../../lib/x.mjs' })
})

test('(A) an arrow or a > inside quoted code is code, not a redirect', () => {
  ok('Bash', { command: `node -e "const f = (a) => a + 1; console.log(f(1) > 0)"` })
  ok('Bash', { command: `node -e 'process.stdout.write([1,2].map(x => x * 2).join(">"))'` })
  // the shape the replay found: an arrow function comparing against a regex literal
  ok('Bash', { command: `node -e "x.filter(a => a >/^SC-/.test(a))"` })
  ok('Bash', { command: `node -e "const f = s => s.length >/x/.source.length"` })
  no('Bash', { command: `node -e "x" > ../../lib/x.mjs` })
})

test('(B) a recursive grep may name another desk\'s facts FILE, not its folder or runtime', () => {
  ok('Bash', { command: 'grep -rn price ../design/facts.md ../customer/facts.md' })
  no('Bash', { command: 'grep -rn price ../customer' })
  no('Bash', { command: 'grep -rn price ../customer/runtime' })
})

test('(parity) zsh ${(e)…} evaluates like eval; the <> redirect writes; ~/.claude is not read', () => {
  no('Bash', { command: 'echo ${(e)x}' })
  no('Bash', { command: 'cat <>../../lib/x.mjs' })
  ok('Bash', { command: 'cat <>notes.md' })
  no('Grep', { pattern: 'token', path: CFG })
  no('Read', { file_path: join(CFG, 'sessions', '1.json') })
  no('Bash', { command: `cat ${CFG}/sessions/1.json` })
})
