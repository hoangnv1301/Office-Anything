// THE WALL'S EXTENSION POINTS (0.7.40). local-cabinets-ops ran its own wall
// beside the plugin's, and its suite passed 16/28 against the plugin wall: the
// office could not say who a desk may message, that a desk starts no subagent,
// that a locked variable is READ-ONLY in every shell spelling, what a child
// session of a desk is called, or add a rule only it understands.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'desk-wall.mjs')
const CONFIG = {
  roleEnv: 'OFFICE_ROLE',
  lead: { session: 'Office Lead', aliases: ['lead'] },
  wall: {
    lockedEnv: ['OPS_TOKEN', 'CASE_SESSION'],
    lead: { bash: ['^\\s*(node \\S*scripts/desk/ops\\.mjs\\s+\\S|ls(\\s|$))'] },
    messages: true,
    noDelegation: true,
    module: 'desks/hooks/wall-extra.mjs',
  },
}
const EXTRA = `
export function judge(p, who, { session }) {
  if (p.tool_name === 'Bash' && /^cs-/.test(session) && /\\bpay\\b/.test(p.tool_input?.command ?? '')) return 'a case session does not pay'
  if (p.tool_name === 'Bash' && /\\bvendor-login\\b/.test(p.tool_input?.command ?? '')) return 'the vendor login is the owner\\'s'
  return null
}
export function alias(name) { return name === 'cs-Recorded' ? 'desk-support--T-100' : null }
`
function office() {
  const root = mkdtempSync(join(tmpdir(), 'oa-wallx-'))
  for (const [n, extra] of [['inventory', {}], ['support', { perCase: { kind: 'ticket', key: '^T-\\d{3}$' } }], ['design', {}]]) {
    mkdirSync(join(root, 'desks', n, 'runtime'), { recursive: true })
    writeFileSync(join(root, 'desks', n, 'desk.json'), JSON.stringify({ name: n, kind: 'knowledge', port: 9400 + n.length, ...extra }))
  }
  mkdirSync(join(root, 'desks', 'hooks'), { recursive: true })
  writeFileSync(join(root, 'desks', 'hooks', 'wall-extra.mjs'), EXTRA)
  mkdirSync(join(root, 'lib'), { recursive: true })
  writeFileSync(join(root, 'office.json'), JSON.stringify(CONFIG))
  return root
}
const ROOT = office()
const env0 = () => { const e = { ...process.env, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'oa-cfg-')) }; delete e.OFFICE_ROLE; delete e.CLAUDE_PROJECT_DIR; return e }
// as a desk by folder, as the lead by role, or as a named session (registered under this test's pid, an ancestor of the hook)
const run = (who, tool_name, tool_input) => {
  const env = env0()
  let cwd = ROOT
  if (who === 'lead') env.OFFICE_ROLE = 'Office Lead'
  else if (who?.session) {
    mkdirSync(join(env.CLAUDE_CONFIG_DIR, 'sessions'), { recursive: true })
    writeFileSync(join(env.CLAUDE_CONFIG_DIR, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, name: who.session }))
  } else if (who) cwd = join(ROOT, 'desks', who)
  return spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name, tool_input, cwd }), encoding: 'utf8', env, cwd }).status
}
const ok = (...a) => assert.equal(run(...a), 0, JSON.stringify(a))
const no = (...a) => assert.equal(run(...a), 2, JSON.stringify(a))

test('messages: a desk and the lead message only the lead, real desks, and real children', () => {
  ok('lead', 'SendMessage', { to: 'desk-inventory', message: 'x' })
  ok('lead', 'SendMessage', { to: 'desk-inventory [abc123]', message: 'x' })
  ok('inventory', 'SendMessage', { to: 'Office Lead', message: 'x' })
  ok('inventory', 'SendMessage', { to: 'lead [71b9]', message: 'x' })
  ok('inventory', 'SendMessage', { to: 'desk-support--T-100', message: 'x' })
  ok('inventory', 'SendMessage', { to: 'cs-Recorded', message: 'x' })
  no('inventory', 'SendMessage', { to: 'leader', message: 'x' })
  no('lead', 'SendMessage', { to: 'repo-42', message: 'go fix the bug' })
  no('lead', 'SendMessage', { to: 'desk-nosuch', message: 'x' })
  no('lead', 'SendMessage', { to: 'desk-../x', message: 'x' })
  no('lead', 'SendMessage', { to: 'desk-inventory--T-100', message: 'x' })
  no('lead', 'SendMessage', { to: 'desk-support--T-1', message: 'x' })
  no('lead', 'SendMessage', { to: 'desk-support--T-100--x', message: 'x' })
  no('lead', 'SendMessage', { to: 'cs-Unrecorded', message: 'x' })
  ok(null, 'SendMessage', { to: 'anyone', message: 'x' })
})

test('noDelegation: no subagent, workflow, cloud task or worktree for a desk or the lead', () => {
  for (const t of ['Agent', 'Task', 'Workflow', 'RemoteTrigger', 'EnterWorktree']) { no('lead', t, {}); no('inventory', t, {}) }
  ok(null, 'Agent', { prompt: 'a developer may' })
})

test('a locked variable is read-only in every spelling', () => {
  ok('inventory', 'Bash', { command: 'echo $OPS_TOKEN ${CASE_SESSION}' })
  for (const command of [
    'OPS_TOKEN=x node a.mjs', 'OPS_TOKEN+=x node a.mjs', 'export CASE_SESSION=x', 'unset CASE_SESSION', 'env -u CASE_SESSION node a.mjs',
    'declare OPS_TOKEN=x', 'printf -v OPS_TOKEN x', 'read OPS_TOKEN', 'echo ${CASE_SESSION:=x}', 'echo ${OPS_TOKEN#a}',
    'env OPS_TOK""EN=x node a.mjs', 'eval "OPS_""TOKEN=x"', 'x=OPS; echo ${!x}', 'e""val ls',
  ]) no('inventory', 'Bash', { command })
  ok('inventory', 'Bash', { command: 'ls work/eval' })
  ok('inventory', 'Bash', { command: "node a.mjs '{\"note\":\"QC eval done\"}'" })
  no('lead', 'Bash', { command: 'CASE_SESSION=x node scripts/desk/ops.mjs verbs' })
})

test('a child session (desk-<parent>--<key>) is the parent desk, walled the same', () => {
  const C = { session: 'desk-support--T-100' }
  assert.equal(run(C, 'Write', { file_path: join(ROOT, 'desks', 'support', 'notes.md') }), 0)
  assert.equal(run(C, 'Write', { file_path: join(ROOT, 'lib', 'x.mjs') }), 2)
  assert.equal(run(C, 'Read', { file_path: join(ROOT, 'desks', 'inventory', 'runtime', 'x') }), 2)
  // only a desk with perCase takes a suffix, and only a key its regex matches in full
  for (const session of ['desk-inventory--T-100', 'desk-support--nonsense', 'desk-support--T-1', 'desk-support--T-100--x', 'desk-support--']) {
    assert.equal(run({ session }, 'Bash', { command: 'ls' }), 2, session)
  }
})

test('the office module adds its own rule, and is told the session\'s own name', () => {
  no('inventory', 'Bash', { command: 'node vendor-login.mjs' })
  ok('inventory', 'Bash', { command: 'node ok.mjs' })
  // cs-Recorded maps to the support desk's case session; the module still sees the name it runs under
  assert.equal(run({ session: 'cs-Recorded' }, 'Bash', { command: 'node pay.mjs' }), 2)
  assert.equal(run({ session: 'cs-Recorded' }, 'Bash', { command: 'node ok.mjs' }), 0)
})

test('bypasses found by attacking the rules (2026-10-10): dynamic names, wrapped eval, hands started from Bash', () => {
  // a name built at run time never spells the variable
  for (const command of [
    'declare "OPS_$(echo TOKEN)=x"', 'export OPS_`echo TOKEN`=x', 'typeset -g CASE_${X}=y', 'unset $NAME', 'printf -v "$N" x',
    'read -r "$N"', 'env "OPS_$(echo TOKEN)=x" node a.mjs', 'local "$N"=1',
    // eval behind a wrapper is still eval
    'builtin eval "$x"', 'command eval "$x"', 'exec eval "$x"', 'nohup eval x',
  ]) no('inventory', 'Bash', { command })
  ok('inventory', 'Bash', { command: 'env FOO=$HOME node a.mjs' })
  ok('inventory', 'Bash', { command: 'export PATH=$PATH:/tmp/bin' })
  // noDelegation: another Claude session or terminal started from Bash is another pair of hands
  for (const command of ['claude -p "fix lib/x"', 'nohup claude --dangerously-skip-permissions &', 'env -i claude', 'orca terminal create --command "claude"', 'cd /tmp && claude']) {
    no('inventory', 'Bash', { command }); no('lead', 'Bash', { command })
  }
  ok('inventory', 'Bash', { command: 'node .claude/skills/x/run.mjs' })
  ok('inventory', 'Bash', { command: "node a.mjs 'ask claude about it'" })
})
