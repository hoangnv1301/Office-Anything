// THE LEAD AND DEVELOPERS (owner's request, 2026-10-18): the lead may message
// the developer sessions office.json names, log a decision through one listed
// command whatever its text says, and is never started twice under an alias.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { start, launchCommand, targetsOf } from '../lib/start.mjs'

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'desk-wall.mjs')
function office(cfg = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oa-ldev-'))
  mkdirSync(join(root, 'desks', 'design'), { recursive: true })
  writeFileSync(join(root, 'desks', 'design', 'desk.json'), JSON.stringify({ name: 'design', kind: 'knowledge', port: 9411 }))
  const full = { roleEnv: 'OFFICE_ROLE', lead: { session: '工厂ERP', aliases: ['lead'] }, launch: { flags: ['--dangerously-skip-permissions'], lead: { flags: ['--remote-control'] } }, wall: { failClosed: true, lead: { bash: ['^\\s*node scripts/dev/lead-decisions\\.mjs add\\s'], devSessions: ['dev-*', 'office-anything'] } }, ...cfg }
  writeFileSync(join(root, 'office.json'), JSON.stringify(full))
  return { root, cfg: full }
}
const gate = (root, role, tool_name, tool_input) => {
  const cwd = role.startsWith('desk-') ? join(root, 'desks', role.slice(5)) : root
  const env = { ...process.env, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'oa-ldev-cfg-')), OFFICE_ROLE: role }
  return spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name, tool_input, cwd }), encoding: 'utf8', env, cwd }).status
}

test('wall.lead.devSessions: the lead (by name or alias) may message exactly those developers; a desk may not', () => {
  const { root } = office()
  const send = (role, to) => gate(root, role, 'SendMessage', { to, message: 'x' })
  assert.equal(send('工厂ERP', 'dev-ui'), 0)
  assert.equal(send('lead', 'office-anything'), 0, 'an alias is the lead')
  assert.equal(send('工厂ERP', 'office-anything-dd'), 2, 'an exact name is not a prefix')
  assert.equal(send('工厂ERP', 'random-session'), 2)
  assert.equal(send('desk-design', 'dev-ui'), 2, 'desks gain nothing')
  assert.equal(send('desk-design', '工厂ERP'), 0)
  const none = office({ wall: { failClosed: true } })
  assert.equal(gate(none.root, '工厂ERP', 'SendMessage', { to: 'dev-ui', message: 'x' }), 2, 'without the key nothing is widened')
})

test('the lead\'s listed command takes quoted text that says ; & | > — and still runs nothing else', () => {
  const { root } = office()
  const bash = (command) => gate(root, '工厂ERP', 'Bash', { command })
  assert.equal(bash('node scripts/dev/lead-decisions.mjs add "price > 500; ok & go | later"'), 0)
  assert.equal(bash("node scripts/dev/lead-decisions.mjs add 'use $(the new) <<supplier>>'"), 0)
  assert.equal(bash('node scripts/dev/lead-decisions.mjs add "ok"; rm -rf x'), 2)
  assert.equal(bash('node scripts/dev/lead-decisions.mjs add "$(whoami)"'), 2, 'double quotes still expand')
  assert.equal(bash("node scripts/dev/lead-decisions.mjs add \\' ; rm x ; echo \\'"), 2, 'an escaped quote opens nothing')
  assert.equal(bash('node scripts/dev/lead-decisions.mjs add x > decisions.md'), 2)
  assert.equal(bash('node scripts/dev/lead-decisions.mjs add "x" "y'), 2, 'an unclosed quote')
  assert.equal(bash('rm "a; b"'), 2, 'only the listed commands')
})

test('start: a live session under a lead alias IS the lead; two are a clash; the lead launches in the desks\' mode', async () => {
  const { root, cfg } = office()
  const made = []
  const term = { titles: () => [], screen: () => '', answerImports: () => {}, create: ({ title }) => { made.push(title); return 'term_1' } }
  const o = (live) => ({ cfg, live: () => live, terminal: term, sleep: async () => {}, dir: mkdtempSync(join(tmpdir(), 'oa-ldev-cl-')) })
  const one = await start(root, 'lead', o([{ pid: 43523, name: 'lead', cwd: root, sessionId: 'x' }]))
  assert.equal(one[0].state, 'already')
  assert.match(one[0].why, /pid 43523 as "lead"/)
  assert.deepEqual(made, [], 'no second lead')
  const two = await start(root, 'lead', o([{ pid: 1, name: 'lead', cwd: root }, { pid: 2, name: '工厂ERP', cwd: root }]))
  assert.equal(two[0].state, 'clash')
  assert.deepEqual(made, [])
  // bypass desks hold a message from a lead in another mode: the lead carries every desk flag
  const lead = targetsOf(root, cfg, 'lead')[0]
  assert.match(launchCommand({ cfg, target: lead }), /claude --name '工厂ERP' --dangerously-skip-permissions --remote-control$/)
})
