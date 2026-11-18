// THE PLUGIN'S OWN SCRIPTS ARE RUN, NOT READ (0.30.1). An installed plugin
// lives under ~/.claude/plugins/cache/…, so a desk running
// `node <plugin>/lib/tasks.mjs answer T-…` was refused as reading Claude Code's
// folder, and desks could not answer or close their own tasks (2026-11-18).
// Here the folder above this checkout plays ~/.claude (CLAUDE_CONFIG_DIR), so
// the plugin sits under it exactly as an installed one does.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileWall, judge } from '../lib/wall.mjs'

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOME = dirname(PLUGIN)
function office() {
  const root = mkdtempSync(join(tmpdir(), 'oa-ownplug-'))
  mkdirSync(join(root, 'desks', 'inventory'), { recursive: true })
  writeFileSync(join(root, 'desks', 'inventory', 'desk.json'), JSON.stringify({ name: 'inventory', kind: 'knowledge', port: 9821 }))
  writeFileSync(join(root, 'office.json'), JSON.stringify({ roleEnv: 'OFFICE_ROLE', lead: { session: 'Office Lead' } }))
  return root
}

test('a desk runs the plugin\'s own lib/ scripts from where it is installed; everything else under the Claude folder stays closed', () => {
  const before = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = HOME
  try {
    const root = office()
    const W = compileWall({ root, leadSession: 'Office Lead' })
    const who = { kind: 'desk', desk: 'inventory', dir: join(root, 'desks', 'inventory') }
    const bash = (command) => judge({ tool_name: 'Bash', tool_input: { command }, cwd: who.dir }, who, root, W)
    const CLOSED = /Claude Code's own folder/
    const SHUT = /Claude Code's own folder|secret/   // the credentials may meet the secrets floor first: refused either way
    assert.equal(bash(`node ${PLUGIN}/lib/tasks.mjs update T-261118-81 --state done --note "fixed, see the PR"`), null, 'its own task, closed')
    assert.equal(bash(`node ${PLUGIN}/lib/tasks.mjs list`), null)
    // what stays closed
    assert.match(bash(`cat ${HOME}/projects/x.jsonl`), CLOSED, 'a transcript')
    assert.match(bash(`cat ${HOME}/.credentials.json`), SHUT, 'the credentials')
    assert.match(bash(`cat ${PLUGIN}/lib/tasks.mjs`), CLOSED, 'reading the plugin\'s files is still a read of the folder')
    assert.match(bash(`node ${PLUGIN}/scripts/release-post.mjs`), CLOSED, 'only its lib/, not anything else in it')
    assert.match(bash(`node ${PLUGIN}/lib/tasks.mjs update T-1 --note ${HOME}/.credentials.json`), SHUT, 'any other word of the command is judged as before')
    assert.match(bash(`node ${PLUGIN}/lib/*.mjs`), /Claude Code's own folder|glob|a path built/, 'a glob is never the plugin\'s own script')
    assert.match(String(judge({ tool_name: 'Read', tool_input: { file_path: `${HOME}/.credentials.json` }, cwd: who.dir }, who, root, W)), SHUT, 'the Read tool too')
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = before
  }
})
