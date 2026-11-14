// A DESK RUNS THIS PLUGIN'S OWN TASK SCRIPT FROM WHERE CLAUDE CODE INSTALLED IT (0.29.0).
// desk-selene, 2026-11-13: `node ~/.claude/plugins/cache/office-anything/office-anything/0.27.1/lib/tasks.mjs update
// T-261113-44 --state done …` (the line her own task table prints) was refused by the desk wall: "a desk does not read
// Claude Code's own folder". The plugin lives inside ~/.claude, so every desk was walled off its tasks, and the
// hand-off of T-261114-75 would have been refused the same way. The plugin's own install folder is open now; the rest
// of ~/.claude is not. Judged by spawning the real hook from a copy installed the way Claude Code installs it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')
const VERSION = JSON.parse(readFileSync(join(SRC, '.claude-plugin', 'plugin.json'), 'utf8')).version
// a Claude Code home with this plugin installed in its cache
const HOME = mkdtempSync(join(tmpdir(), 'oa-cc-home-'))
const INSTALLED = join(HOME, 'plugins', 'cache', 'office-anything', 'office-anything', VERSION)
for (const d of ['.claude-plugin', 'lib', 'hooks', 'checks']) cpSync(join(SRC, d), join(INSTALLED, d), { recursive: true })
writeFileSync(join(HOME, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'office-anything@office-anything': [{ installPath: INSTALLED, version: VERSION }] } }))
mkdirSync(join(HOME, 'sessions'), { recursive: true }); writeFileSync(join(HOME, 'sessions', 'x.json'), '{}')
const HOOK = join(INSTALLED, 'hooks', 'desk-wall.mjs'), CLI = join(INSTALLED, 'lib', 'tasks.mjs')

// an office walled like the live one: fail closed, a deny list, a lead allow-list
const ROLE = 'OFFICE_ROLE'
const root = mkdtempSync(join(tmpdir(), 'oa-wt-'))
mkdirSync(join(root, 'desks', 'selene', 'runtime'), { recursive: true })
writeFileSync(join(root, 'desks', 'selene', 'desk.json'), JSON.stringify({ name: 'selene', kind: 'knowledge', port: 9400 }))
writeFileSync(join(root, 'office.json'), JSON.stringify({ roleEnv: ROLE, lead: { session: 'Lead' }, wall: { failClosed: true, secrets: '\\.env\\b', deny: [{ pattern: '\\bsqlite3\\b', why: 'no database' }], lead: { bash: ['^\\s*ls(\\s|$)'] } } }))
const run = (command, tool = 'Bash') => {
  const env = { ...process.env }
  env.CLAUDE_CONFIG_DIR = HOME; env[ROLE] = 'desk-selene'
  const cwd = join(root, 'desks', 'selene')
  const input = tool === 'Bash' ? { command } : { file_path: command }
  return spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name: tool, tool_input: input, cwd }), encoding: 'utf8', env, cwd })
}

test("the real refusal: Selene's update, and the hand-off, answer and update of an ask, run from the installed plugin", () => {
  for (const cmd of [
    `node ${CLI} update T-261113-44 --state done --note "closed"`,
    `node ${CLI} handoff T-261114-75 --to "Sam" --via "team chat" --ref discord:42`,
    `node ${CLI} answer T-261114-75 --text "asked Sam"`,
    `node ${CLI} list`,
  ]) { const r = run(cmd); assert.equal(r.status, 0, `${cmd.slice(cmd.indexOf('lib/'))}: ${r.stderr}`) }
  assert.equal(run(join(INSTALLED, 'lib', 'tasks.mjs'), 'Read').status, 0, 'reading the plugin\'s own code too')
})

test("the rest of Claude Code's folder stays closed to a desk: sessions, settings, a path that climbs out of the plugin", () => {
  for (const cmd of [`cat ${join(HOME, 'sessions', 'x.json')}`, `cat ${join(HOME, 'settings.json')}`, `cat ${INSTALLED}/../../../../sessions/x.json`, `node ${CLI.replace(INSTALLED, join(HOME, 'plugins', 'cache', 'other', 'other', '1.0.0'))} x`]) {
    const r = run(cmd); assert.equal(r.status, 2, cmd); assert.match(r.stderr, /Claude Code's own folder/)
  }
  assert.equal(run(join(HOME, 'sessions', 'x.json'), 'Read').status, 2)
  assert.equal(run(join(INSTALLED, 'lib', 'x.mjs'), 'Write').status, 2, 'open to run and read, never to write')
})
