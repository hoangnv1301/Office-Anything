// A DESK CLOSES ITS OWN TASK (2026-11-12). The plugin sits under Claude Code's own
// folder, which a desk never reads, so `node <plugin>/lib/tasks.mjs update …` was
// refused and finished tasks kept nudging (T-261112-22). The wall now lets exactly
// that shape through, for a task the book says is this desk's, and nothing wider.
// Judged by spawning the real hook. CLAUDE_CONFIG_DIR is the plugin checkout, so
// the plugin counts as inside Claude Code's folder, as it does when installed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { addTask, addAsk, readTasks } from '../lib/tasks.mjs'

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOOK = join(PLUGIN, 'hooks', 'desk-wall.mjs')
const CLI = join(PLUGIN, 'lib', 'tasks.mjs')
const CONFIG = { roleEnv: 'OFFICE_ROLE', lead: { session: 'Office Lead' }, wall: { failClosed: true, lead: { bash: ['^\\s*ls(\\s|$)'] } } }

function office() {
  const root = mkdtempSync(join(tmpdir(), 'oa-owntask-'))
  for (const n of ['customer', 'quotes']) {
    mkdirSync(join(root, 'desks', n, 'runtime'), { recursive: true })
    writeFileSync(join(root, 'desks', n, 'desk.json'), JSON.stringify({ name: n, kind: 'knowledge', port: 9300 + n.length }))
  }
  writeFileSync(join(root, 'office.json'), JSON.stringify(CONFIG))
  const mine = addTask(root, { said: 'answer Pat Example about lead times', title: 'Lead-time reply', assigned: 'desk-customer' }).id
  const theirs = addTask(root, { said: 'reprice the quote', title: 'Reprice', assigned: 'desk-quotes' }).id
  const ask = addAsk(root, { to: 'desk-customer', question: 'Is the buyer still waiting?' }, { by: { kind: 'lead' } }).id
  return { root, mine, theirs, ask }
}
const env0 = () => { const e = { ...process.env, CLAUDE_CONFIG_DIR: PLUGIN }; delete e.OFFICE_ROLE; return e }
const hook = (root, desk, command) => {
  const cwd = desk === 'lead' ? root : join(root, 'desks', desk)
  const env = env0(); if (desk === 'lead') env.OFFICE_ROLE = 'Office Lead'
  return spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd }), encoding: 'utf8', env, cwd })
}
const allowed = (o, desk, cmd) => { const r = hook(o.root, desk, cmd); assert.equal(r.status, 0, cmd + '\n' + r.stderr) }
const refused = (o, desk, cmd, why) => { const r = hook(o.root, desk, cmd); assert.equal(r.status, 2, 'should be refused: ' + cmd); if (why) assert.match(r.stderr, why) }
const node = `node ${PLUGIN}/lib/tasks.mjs`

test('a desk moves its own task: update --state working|done, with or without a one-line note', () => {
  const o = office()
  allowed(o, 'customer', `${node} update ${o.mine} --state done --note "replied to Pat Example at 10:05"`)
  allowed(o, 'customer', `${node} update ${o.mine} --state working`)
  allowed(o, 'customer', `${node} update ${o.mine} --state done --note 'sent; see the thread'`)
  // and the CLI itself, run as that desk, closes it
  const r = spawnSync(process.execPath, [CLI, 'update', o.mine, '--state', 'done', '--note', 'replied'], { cwd: join(o.root, 'desks', 'customer'), env: env0(), encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(readTasks(o.root).find((t) => t.id === o.mine).state, 'done')
})

test("a desk cannot move another desk's task, through the wall or the CLI", () => {
  const o = office()
  refused(o, 'customer', `${node} update ${o.theirs} --state done --note "done"`, /assigned to desk-quotes, not to this desk/)
  refused(o, 'customer', `${node} update T-991231-9 --state done`, /no task T-991231-9/)
  const r = spawnSync(process.execPath, [CLI, 'update', o.theirs, '--state', 'done'], { cwd: join(o.root, 'desks', 'customer'), env: env0(), encoding: 'utf8' })
  assert.notEqual(r.status, 0, 'tasks.mjs refuses it on its own side too')
  assert.equal(readTasks(o.root).find((t) => t.id === o.theirs).state, 'open')
})

test('a desk runs no other tasks.mjs verb or shape', () => {
  const o = office()
  for (const cmd of [
    `${node} list`,
    `${node} add --said "x" --title "x"`,
    `${node} drop ${o.mine} --reason "not needed any more at all"`,
    `${node} verify ${o.mine} --evidence x --proof y`,
    `${node} digest`,
    `${node} update ${o.mine} --state waiting --blocked-by "owner: decide"`,
    `${node} update ${o.mine} --state done --assigned desk-quotes`,
    `${node} update ${o.mine} --note "only a note"`,
    `${node} ${o.root} update ${o.mine} --state done`,
    `${node} update ${o.mine} --state done --note "$(cat /etc/hosts)"`,
    `${node} update ${o.mine} --state done; rm -rf ..`,
    `${node} update ${o.mine} --state done && ${node} drop ${o.theirs} --reason "xxxxxxxxxxxxxxx"`,
    `${node} answer ${o.mine} --text "a task is not an ask"`,
  ]) refused(o, 'customer', cmd)
  // the same file reached by a path that is not this plugin's folder written out
  refused(o, 'customer', `node ${PLUGIN}/lib/../lib/tasks.mjs update ${o.mine} --state done`)
})

test('an ask put to the desk is answered the same way; an ask put to another desk is not', () => {
  const o = office()
  allowed(o, 'customer', `${node} answer ${o.ask} --text "yes, replied at 10:05"`)
  refused(o, 'quotes', `${node} answer ${o.ask} --text "yes"`, /not to this desk/)
})

test('the lead gains nothing: closing a desk\'s task stays outside its listed commands', () => {
  const o = office()
  refused(o, 'lead', `${node} update ${o.mine} --state done --note "closing it for them"`)
})
