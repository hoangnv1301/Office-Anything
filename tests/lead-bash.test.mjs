// AN UNANCHORED wall.lead.bash ENTRY IS A HOLE (audit of 0.9.7, 2026-10-18):
// `node scripts/dev/lead-decisions\.mjs add` let the lead run
// `rm -rf x node scripts/dev/lead-decisions.mjs add`. An entry must be anchored
// ^…$ with no top-level |, and an entry that names a script names one real file
// inside the office, written relative to its root.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { compileWall, judge } from '../lib/wall.mjs'
import { report } from '../checks/desk-wall.mjs'

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'desk-wall.mjs')
const ARG = `(?:'[^']*'|"[^"$\`\\\\]*"|[A-Za-z0-9_.:/=-]+)`
const GOOD = `^node scripts/dev/lead-decisions\\.mjs add ${ARG} --why ${ARG}$`
function office(bash) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'oa-lbash-')))
  mkdirSync(join(root, 'desks', 'design'), { recursive: true })
  writeFileSync(join(root, 'desks', 'design', 'desk.json'), JSON.stringify({ name: 'design', kind: 'knowledge', port: 9500 }))
  mkdirSync(join(root, 'scripts', 'dev'), { recursive: true })
  writeFileSync(join(root, 'scripts', 'dev', 'lead-decisions.mjs'), '')
  writeFileSync(join(root, 'office.json'), JSON.stringify({ roleEnv: 'OFFICE_ROLE', lead: { session: 'Office Lead' }, wall: { lead: { bash } } }))
  return root
}
const wallOf = (root, bash) => compileWall({ lead: { bash }, root })
const run = (W, root, command) => judge({ tool_name: 'Bash', tool_input: { command }, cwd: root }, { kind: 'lead' }, root, W)

test('an unanchored entry matches nothing, says so, and the prefix trick is refused', () => {
  const root = office([])
  const W = wallOf(root, ['node scripts/dev/lead-decisions\\.mjs add'])
  assert.equal(W.leadBashProblems.length, 1)
  assert.match(W.leadBashProblems[0].why, /anchored.*\^/)
  const why = run(W, root, 'rm -rf /tmp/zz node scripts/dev/lead-decisions.mjs add x --why y')
  assert.match(why, /limited to the commands this office lists/)
  assert.match(why, /1 wall\.lead\.bash entr(y|ies) (is|are) not used/, 'the refusal says why a listed command may not run')
  // not even the command it was meant for: an entry that is a hole is not an entry
  assert.match(run(W, root, 'node scripts/dev/lead-decisions.mjs add x --why y'), /limited to the commands/)
})

test('a top-level | defeats the anchors: ^a$|b and ^a|b are rejected, a | inside a group is fine, and how offices already write entries holds', () => {
  const root = office([])
  for (const p of ['^node scripts/dev/lead-decisions\\.mjs add x$|rm', '^rm|node scripts/dev/lead-decisions\\.mjs add']) {
    assert.equal(wallOf(root, [p]).leadBashProblems.length, 1, p)
  }
  const ok = wallOf(root, ['^gh pr (view|list|diff|checks)( [A-Za-z0-9_.:/=#-]+)*$'])
  assert.deepEqual(ok.leadBashProblems, [])
  assert.equal(run(ok, root, 'gh pr view 31'), null)
  assert.match(run(ok, root, 'gh pr merge 31'), /limited to the commands/)
  // ^…  with no closing $ is the existing convention: still start-anchored, so the prefix trick fails
  const legacy = wallOf(root, ['^\\s*(node \\S*scripts/desk/ops\\.mjs\\s+\\S|ls(\\s|$))'])
  assert.deepEqual(legacy.leadBashProblems, [])
  assert.equal(run(legacy, root, 'node scripts/desk/ops.mjs inbox'), null)
  assert.match(run(legacy, root, 'rm -rf x node scripts/desk/ops.mjs inbox'), /limited/)
  // a | inside a character class or after a backslash is not alternation
  assert.deepEqual(wallOf(root, ['^echo [|]$', '^echo \\|$']).leadBashProblems, [])
})

test('an entry that names a script: relative to the office root, inside it, one real file', () => {
  const root = office([])
  const other = realpathSync(mkdtempSync(join(tmpdir(), 'oa-lbash-out-')))
  writeFileSync(join(other, 'evil.mjs'), '')
  symlinkSync(join(other, 'evil.mjs'), join(root, 'scripts', 'dev', 'linked.mjs'))
  const bad = {
    absolute: `^node ${other}/evil\\.mjs$`,
    parent: '^node \\.\\./evil\\.mjs$',
    parentInside: '^node scripts/\\.\\./\\.\\./evil\\.mjs$',
    missing: '^node scripts/dev/no-such\\.mjs$',
    symlinkOut: '^node scripts/dev/linked\\.mjs$',
    wholeDir: '^node scripts/dev/[a-z-]+\\.mjs$',
  }
  for (const [k, p] of Object.entries(bad)) {
    const W = wallOf(root, [p])
    assert.equal(W.leadBashProblems.length, 1, `${k}: ${JSON.stringify(W.leadBashProblems)}`)
  }
  // the script may be followed by a group of optional arguments
  const opt = wallOf(root, [`^node scripts/dev/lead-decisions\\.mjs( ${ARG})*$`])
  assert.deepEqual(opt.leadBashProblems, [])
  assert.equal(run(opt, root, 'node scripts/dev/lead-decisions.mjs'), null)
  assert.equal(run(opt, root, 'node scripts/dev/lead-decisions.mjs 0.9.8 --x'), null)
  // ...but a group cannot stand in for part of the path
  assert.equal(wallOf(root, ['^node scripts/dev/(lead-decisions|merge-verify)\\.mjs$']).leadBashProblems.length, 1)
  assert.deepEqual(wallOf(root, [GOOD]).leadBashProblems, [])
  const W = wallOf(root, [GOOD])
  assert.equal(run(W, root, `node scripts/dev/lead-decisions.mjs add 'ship 0.9.8 (a > b; c)' --why 'owner asked'`), null)
  assert.match(run(W, root, 'node scripts/dev/lead-decisions.mjs add x --why y --out=/etc/x'), /limited/)
})

test('the check reports the entry, the gate keeps the wall on, and the lead runs only what is valid', () => {
  const root = office([GOOD, 'node scripts/dev/lead-decisions\\.mjs add'])
  const r = report(root)
  assert.equal(r.code, 4)
  assert.ok(r.findings.some((f) => /wall\.lead\.bash\[1\]/.test(f.say) && /anchored/.test(f.say)), JSON.stringify(r.findings))
  const env = { ...process.env, OFFICE_ROLE: 'Office Lead', CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'oa-lbash-cfg-')) }
  delete env.CLAUDE_PROJECT_DIR
  const gate = (command) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: root }), encoding: 'utf8', env, cwd: root }).status
  assert.equal(gate(`node scripts/dev/lead-decisions.mjs add x --why y`), 0)
  assert.equal(gate('rm -rf x node scripts/dev/lead-decisions.mjs add'), 2)
})

test('the README says it', async () => {
  const { readFileSync } = await import('node:fs')
  assert.match(readFileSync(new URL('../README.md', import.meta.url), 'utf8'), /wall\.lead\.bash.*anchored/s)
})

// THE LEAD CHAINS LISTED COMMANDS (owner 2026-10-20: "let the lead do things as
// needed"). && ; | and 2>&1 are fine when every part is itself listed; a write,
// a command inside a command, a newline or a background job are still refused.
test('the lead chains listed commands with && ; | and 2>&1; every part must be listed; writes and nesting stay refused', () => {
  const root = office([])
  const W = wallOf(root, ['^gh pr (view|list|checks|diff)( [A-Za-z0-9_.:/=#-]+)*$', '^git (status|log|diff)( [A-Za-z0-9_.:/=@~^-]+)*$', '^(head|tail|wc|grep)( [A-Za-z0-9_.:/=-]+| \'[^\']*\')*$'])
  for (const ok of ['gh pr list && git status', 'git log --oneline -5; git status', 'gh pr view 31 2>&1 | tail -5', "git log -3 | grep 'fix: a > b; c'", 'gh pr checks 50 2>&1'])
    assert.equal(run(W, root, ok), null, ok)
  const refused = {
    'gh pr list && rm -rf x': /limited to the commands this office lists \(not listed: "rm -rf x"\)/,
    'gh pr list | sh': /not listed: "sh"/,
    'git status > out.txt': /writes no file/,
    'git status >> out.txt': /writes no file/,
    'gh pr list 2>err.txt': /writes no file/,
    'git log $(rm -rf x)': /command inside a command/,
    'git log `rm x`': /command inside a command/,
    'grep x <(rm x)': /command inside a command/,
    'git status &': /background/,
    'git status || rm x': /not \|\|/,
    'git status\nrm x': /one line/,
    'git status ;; git log': /empty command/,
    'grep "$HOME" x': /expands inside/,
    "grep 'x": /unclosed quote/,
  }
  for (const [cmd, why] of Object.entries(refused)) assert.match(run(W, root, cmd) ?? 'RAN', why, cmd)
})
