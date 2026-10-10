// THE SECOND REPLAY OF #18 (local-cabinets-ops, 7,353 real calls, 2026-10-10):
// a security regression (writes inside $(…) and backticks unseen), 67 false
// refusals from a ) in quoted code inside $(…), Claude Code's folder closed
// too widely and still open by four other spellings, Grep and Bash disagreeing
// about another desk's facts.md, a 6.6 s judgement on 30,000 nested ${, and a
// sed script read as a write target.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'desk-wall.mjs')
const HOME = realpathSync(mkdtempSync(join(tmpdir(), 'oa-home-')))
const CC = join(HOME, '.claude')
const ROOT = (() => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'oa-r2-')))
  for (const n of ['design', 'customer']) {
    mkdirSync(join(root, 'desks', n, 'runtime'), { recursive: true })
    mkdirSync(join(root, 'desks', n, 'work-quynh'), { recursive: true })
    writeFileSync(join(root, 'desks', n, 'desk.json'), JSON.stringify({ name: n, kind: 'knowledge', port: 9970 + n.length }))
    writeFileSync(join(root, 'desks', n, 'facts.md'), 'facts\n')
  }
  mkdirSync(join(root, 'lib'), { recursive: true })
  writeFileSync(join(root, 'office.json'), JSON.stringify({ roleEnv: 'OFFICE_ROLE', lead: { session: 'Office Lead' }, wall: { lockedEnv: ['OPS_TOKEN'] } }))
  return root
})()
const DESK = join(ROOT, 'desks', 'design')
const SLUG = DESK.replace(/[^A-Za-z0-9]/g, '-')
for (const d of [join(CC, 'projects', SLUG, 'sess', 'tool-results'), join(CC, 'projects', SLUG, 'memory'), join(CC, 'skills', 'x'), join(CC, 'sessions')]) mkdirSync(d, { recursive: true })
writeFileSync(join(CC, 'settings.json'), '{}')
const run = (tool_name, tool_input, extraEnv = {}) => {
  const env = { ...process.env, HOME, ...extraEnv }; delete env.OFFICE_ROLE; delete env.CLAUDE_PROJECT_DIR; delete env.CLAUDE_CONFIG_DIR
  for (const [k, v] of Object.entries(extraEnv)) env[k] = v
  return spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name, tool_input, cwd: DESK }), encoding: 'utf8', env, cwd: DESK, timeout: 30000 })
}
const ok = (t, i, e) => assert.equal(run(t, i, e).status, 0, JSON.stringify(i))
const no = (t, i, e) => assert.equal(run(t, i, e).status, 2, JSON.stringify(i))

test('(1) a write inside $(…) or backticks is a write', () => {
  no('Bash', { command: 'echo $(echo x > ../../lib/x.mjs)' })
  no('Bash', { command: 'V=$(node a.mjs > ../../lib/x.mjs)' })
  no('Bash', { command: 'echo `echo x > ../../lib/x.mjs`' })
  no('Bash', { command: 'echo "$(echo x >|../../lib/x.mjs)"' })
  no('Bash', { command: 'echo $(cat ../customer/runtime/token.json)' })
  ok('Bash', { command: 'V=$(node a.mjs 2>/dev/null)' })
})

test('(2) a ) inside quoted code inside $(…) does not end the substitution', () => {
  ok('Bash', { command: "cd work-quynh && V=$(node -e 'f(a)=>b')" })
  ok('Bash', { command: `cd work-quynh && V=$(node ../../../scripts/desk/ops.mjs ask x | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(s.length))')` })
  ok('Bash', { command: `V=$(echo ")" > /dev/null; echo ok)` })
})

test('(3) Claude Code\'s folder: the desk\'s own project tree and skills are readable; keys, sessions, settings are not, by any spelling', () => {
  ok('Read', { file_path: join(CC, 'projects', SLUG, 'sess', 'tool-results', 'out.txt') })
  ok('Grep', { pattern: 'x', path: join(CC, 'projects', SLUG, 'memory') })
  ok('Bash', { command: 'ls -d ~/.claude/skills/*' })
  ok('Bash', { command: `cat ~/.claude/projects/${SLUG}/sess/tool-results/out.txt` })
  no('Read', { file_path: join(CC, 'settings.json') })
  no('Read', { file_path: '~/.claude/settings.json' })
  no('Bash', { command: 'cat ~/.claude/sessions/1.json' })
  no('Bash', { command: 'H=$HOME; cat $H/.claude/settings.json' })
  no('Bash', { command: `cat ~${userInfo().username}/.claude/settings.json` }, { HOME })
  no('Grep', { pattern: 'x', path: join(CC, 'projects') })
  // CLAUDE_CONFIG_DIR elsewhere does not open ~/.claude
  no('Bash', { command: 'cat ~/.claude/settings.json' }, { CLAUDE_CONFIG_DIR: join(HOME, 'other-cc') })
})

test('(4) Grep may read another desk\'s facts file, as Bash may', () => {
  ok('Grep', { pattern: 'price', path: join(ROOT, 'desks', 'customer', 'facts.md') })
  no('Grep', { pattern: 'price', path: join(ROOT, 'desks', 'customer') })
})

test('(5) 30,000 nested ${ is refused fast', () => {
  const t0 = Date.now()
  const r = run('Bash', { command: 'echo ' + '${'.repeat(30000) + 'x' + '}'.repeat(30000) })
  assert.equal(r.status, 2)
  assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`)
})

test('(6) a sed script is a script, not a file to write', () => {
  ok('Bash', { command: "sed -i '' 's#/Users/x/old#/Users/x/new#g' work-quynh/keys.mjs; node a.mjs 2>&1 | head" })
  ok('Bash', { command: "sed -i -e 's|/tmp/a|/tmp/b|' work-quynh/keys.mjs" })
  // a script that starts with an address /regex/ looks like an absolute path
  ok('Bash', { command: "sed -i '' '/^import x/d' work-quynh/keys.mjs; node a.mjs 2>&1 | head" })
  ok('Bash', { command: "sed -i '/^$/d' work-quynh/keys.mjs" })
  no('Bash', { command: "sed -i '' 's/a/b/' ../../lib/x.mjs" })
})

test('(review) sed scripts given by attached or long options do not turn the target into "the script"', () => {
  for (const command of [
    "sed -i -e's/a/b/' ../../lib/x.mjs", "sed -i -es/a/b/ ../../lib/x.mjs", "sed -i --expression='s/a/b/' ../../lib/x.mjs",
    "sed -i --expression 's/a/b/' ../../lib/x.mjs", "sed -i -f/tmp/s.sed ../../lib/x.mjs", "sed -i --file=/tmp/s.sed ../../lib/x.mjs",
    "sed -i -n -e 's/a/b/p' ../../lib/x.mjs", "sed --in-place 's/a/b/' ../../lib/x.mjs", "sed -i.bak 's/a/b/' ../../lib/x.mjs",
  ]) no('Bash', { command })
  ok('Bash', { command: "sed -i -e's/a/b/' work-quynh/keys.mjs" })
  ok('Bash', { command: "sed -i --expression='s/a/b/' work-quynh/keys.mjs" })
})

test('(review) a write target given as an option, and writers the list never knew', () => {
  for (const command of [
    'cp -t../../lib x.mjs', 'cp -t ../../lib x.mjs', 'mv --target-directory=../../lib x.mjs', 'install -m 644 x.mjs ../../lib/x.mjs',
    'dd if=x of=../../lib/x.mjs', 'truncate -s 0 ../../lib/x.mjs', "perl -pi -e 's/a/b/' ../../lib/x.mjs", "ruby -i -pe 'x' ../../lib/x.mjs",
    'cd ~/.claude && cat sessions/1.json', 'pushd ~/.claude; cat sessions/1.json',
  ]) no('Bash', { command })
  for (const command of ['cp -t work-quynh x.mjs', 'dd if=x of=work-quynh/x.bin', 'truncate -s 0 work-quynh/x.log', "perl -pi -e 's/a/b/' work-quynh/keys.mjs", 'dd if=/dev/zero of=/dev/null count=1']) ok('Bash', { command })
})

test('(review) a writer behind a wrapper, a path, a quote or a backslash is still a writer', () => {
  for (const command of [
    'nohup cp x.mjs ../../lib/', 'env cp x.mjs ../../lib/', 'env FOO=1 cp x.mjs ../../lib/', 'timeout 5 tee ../../lib/x.mjs',
    'timeout -s KILL 5 cp x.mjs ../../lib/', 'nice -n 5 cp x.mjs ../../lib/', 'command cp x.mjs ../../lib/', 'exec cp x.mjs ../../lib/',
    'stdbuf -oL tee ../../lib/x.mjs', 'sudo -u me cp x.mjs ../../lib/', 'ls | xargs cp -t ../../lib', 'ls | xargs -I{} cp {} ../../lib/',
    '/bin/cp x.mjs ../../lib/', '\\cp x.mjs ../../lib/', '"cp" x.mjs ../../lib/', "command sed -i 's/a/b/' ../../lib/x.mjs",
    'env -C ../../lib touch x.mjs', 'timeout 5 cat ../customer/runtime/token.json',
  ]) no('Bash', { command })
  for (const command of ['nohup cp x.mjs work-quynh/', 'timeout 5 tee work-quynh/out.txt', 'ls | xargs -I{} cp {} work-quynh/']) ok('Bash', { command })
})
