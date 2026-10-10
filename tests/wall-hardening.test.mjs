// THE WALL, REVIEWED BY THE OFFICE THAT RUNS ON IT (2026-10-10, the lead's
// security review of 0.7.40). Six ways a desk session walked through, each
// pinned here: a symlinked hook path, an unreadable office.json, a missing,
// throwing or hanging office module, MCP tools nobody checked, a case-blind
// disk and a symlinked folder, and limits a half-written office left off.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOOK = join(REPO, 'hooks', 'desk-wall.mjs')
const BASE = { roleEnv: 'OFFICE_ROLE', lead: { session: 'Office Lead' }, wall: { lockedEnv: ['OPS_TOKEN'] } }

function office(cfg = BASE, { raw = null, module = null } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'oa-hard-')))
  for (const n of ['inventory', 'customer']) {
    mkdirSync(join(root, 'desks', n, 'runtime'), { recursive: true })
    mkdirSync(join(root, 'desks', n, '.claude'), { recursive: true })
    writeFileSync(join(root, 'desks', n, 'desk.json'), JSON.stringify({ name: n, kind: 'knowledge', port: 9500 + n.length }))
  }
  mkdirSync(join(root, 'lib'), { recursive: true })
  if (module) { mkdirSync(join(root, 'desks', 'hooks'), { recursive: true }); writeFileSync(join(root, 'desks', 'hooks', 'extra.mjs'), module) }
  writeFileSync(join(root, 'office.json'), raw ?? JSON.stringify(cfg))
  return root
}
const env0 = () => { const e = { ...process.env, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'oa-cfg-')) }; delete e.OFFICE_ROLE; delete e.CLAUDE_PROJECT_DIR; return e }
const run = (root, desk, tool_name, tool_input, { hook = HOOK, raw = null, timeout = 15000 } = {}) => {
  const cwd = desk ? join(root, 'desks', desk) : root
  return spawnSync(process.execPath, [hook], { input: raw ?? JSON.stringify({ tool_name, tool_input, cwd }), encoding: 'utf8', env: env0(), cwd, timeout }).status
}

test('(1) a hook started through a symlinked path still judges', () => {
  const root = office()
  const link = join(mkdtempSync(join(tmpdir(), 'oa-link-')), 'plugin')
  symlinkSync(REPO, link)
  assert.equal(run(root, 'inventory', 'Write', { file_path: join(root, 'lib', 'x.mjs') }, { hook: join(link, 'hooks', 'desk-wall.mjs') }), 2)
})

test('(2) an unreadable office.json denies a desk session, and a malformed payload is always denied in an office', () => {
  const broken = office(null, { raw: '{ "wall": { oops' })
  assert.equal(run(broken, 'inventory', 'Bash', { command: 'ls' }), 2, 'a desk cannot walk through a broken config')
  assert.equal(run(broken, null, 'Bash', { command: 'ls' }), 0, 'a developer at the root can still repair it')
  const root = office()
  assert.equal(run(root, 'inventory', null, null, { raw: '{not json' }), 2)
})

test('(3) failClosed is the default once a wall exists; a missing, throwing or hanging module denies', () => {
  const missing = office({ ...BASE, wall: { ...BASE.wall, module: 'desks/hooks/nope.mjs' } })
  assert.equal(run(missing, 'inventory', 'Bash', { command: 'ls' }), 2)
  const throwing = office({ ...BASE, wall: { ...BASE.wall, module: 'desks/hooks/extra.mjs' } }, { module: 'export function judge() { throw new Error("boom") }' })
  assert.equal(run(throwing, 'inventory', 'Bash', { command: 'ls' }), 2)
  const hanging = office({ ...BASE, wall: { ...BASE.wall, module: 'desks/hooks/extra.mjs' } }, { module: 'export function judge() { for (;;) {} }' })
  const t0 = Date.now()
  assert.equal(run(hanging, 'inventory', 'Bash', { command: 'ls' }), 2)
  assert.ok(Date.now() - t0 < 8000, 'the wall keeps its own deadline')
  const open = office({ ...BASE, wall: { ...BASE.wall, failClosed: false, module: 'desks/hooks/nope.mjs' } })
  assert.equal(run(open, 'inventory', 'Bash', { command: 'ls' }), 0, 'an office may still opt out, explicitly')
  // the hook entry carries a timeout of its own
  const hooks = JSON.parse(readFileSync(join(REPO, 'hooks', 'hooks.json'), 'utf8')).hooks.PreToolUse
  assert.ok(hooks.some((h) => h.hooks.some((x) => /desk-wall/.test(x.command) && Number.isFinite(x.timeout))))
})

test('(4) MCP tools that reach outsiders are refused to a desk by default; wall.mcp sets the list', () => {
  const root = office()
  for (const t of ['mcp__claude_ai_Gmail__send_message', 'mcp__claude_ai_Google_Drive__share_file', 'mcp__x__delete_thing', 'mcp__claude_ai_Gmail__reply', 'mcp__claude_ai_Gmail__forward']) assert.equal(run(root, 'inventory', t, {}), 2, t)
  assert.equal(run(root, 'inventory', 'mcp__claude_ai_Gmail__search_threads', {}), 0)
  const strict = office({ ...BASE, wall: { ...BASE.wall, mcp: { allow: ['^mcp__docs__'] } } })
  assert.equal(run(strict, 'inventory', 'mcp__docs__read', {}), 0)
  assert.equal(run(strict, 'inventory', 'mcp__claude_ai_Gmail__search_threads', {}), 2, 'with an allow list, anything else is refused')
  const hooks = JSON.parse(readFileSync(join(REPO, 'hooks', 'hooks.json'), 'utf8')).hooks.PreToolUse
  assert.ok(hooks.some((h) => /desk-wall/.test(JSON.stringify(h)) && new RegExp(`^(?:${h.matcher})$`).test('mcp__claude_ai_Gmail__send_message')), 'the matcher reaches MCP tools')
})

test('(5) a case-blind disk and a symlinked folder do not open a way out', () => {
  const root = office()
  assert.equal(run(root, 'inventory', 'Write', { file_path: join(root, 'desks', 'inventory', '.CLAUDE', 'settings.json') }), 2)
  assert.equal(run(root, 'inventory', 'Write', { file_path: join(root, 'desks', 'inventory', 'Runtime', 'x') }), 2)
  assert.equal(run(root, 'inventory', 'Read', { file_path: join(root, 'desks', 'customer', 'RUNTIME', 'x') }), 2)
  assert.equal(run(root, 'inventory', 'Read', { file_path: join(root, 'x', '.ENV') }), 2)
  assert.equal(run(root, 'inventory', 'Write', { file_path: join(root, 'desks', 'inventory', '.', '..', 'customer', 'x.md') }), 2)
  symlinkSync(join(root, 'lib'), join(root, 'desks', 'inventory', 'out'))
  assert.equal(run(root, 'inventory', 'Write', { file_path: join(root, 'desks', 'inventory', 'out', 'x.mjs') }), 2, 'a symlink out of the folder is outside it')
  assert.equal(run(root, 'inventory', 'Write', { file_path: join(root, 'desks', 'inventory', 'notes.md') }), 0)
})

test('(6) once a wall exists, messages and delegation are limited unless the office opts out', () => {
  const root = office()
  assert.equal(run(root, 'inventory', 'SendMessage', { to: 'some-dev-session', message: 'x' }), 2)
  assert.equal(run(root, 'inventory', 'Agent', { prompt: 'x' }), 2)
  const out = office({ ...BASE, wall: { ...BASE.wall, messages: false, noDelegation: false } })
  assert.equal(run(out, 'inventory', 'SendMessage', { to: 'some-dev-session', message: 'x' }), 0)
  assert.equal(run(out, 'inventory', 'Agent', { prompt: 'x' }), 0)
})

test('(review 2) the hook judges even when it is not recognised as the main module', () => {
  // started by a wrapper (node -e, a loader) argv[1] is not this file; the
  // hook used to read that as "imported, do nothing" and exit 0: an allow
  const root = office()
  const cwd = join(root, 'desks', 'inventory')
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(new URL('file://' + HOOK).href)})`], {
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: join(root, 'lib', 'x.mjs') }, cwd }), encoding: 'utf8', env: env0(), cwd, timeout: 15000 })
  assert.equal(r.status, 2)
})

test('(review 3) the default MCP rule allows reading and refuses everything else', () => {
  const root = office()
  for (const t of ['mcp__claude_ai_Gmail__create_draft', 'mcp__claude-in-chrome__computer', 'mcp__claude-in-chrome__form_input', 'mcp__claude_ai_Google_Drive__copy_file',
    'mcp__claude_ai_Gmail__update_label', 'mcp__claude_ai_Gmail__trash_message', 'mcp__x__post_update', 'mcp__x__upload_file', 'mcp__x__invite_member', 'mcp__x__get_and_send']) assert.equal(run(root, 'inventory', t, {}), 2, t)
  for (const t of ['mcp__claude_ai_Gmail__search_threads', 'mcp__claude_ai_Gmail__get_message', 'mcp__claude_ai_Google_Drive__read_file_content', 'mcp__x__list_labels']) assert.equal(run(root, 'inventory', t, {}), 0, t)
})

test('(review 4) redirects the shell reads differently: >| and >&file write where bash says', () => {
  const root = office()
  for (const command of ['echo x >|../../lib/x.mjs', 'echo x >&../../lib/x.mjs', 'echo x >| "../../lib/x.mjs"', 'echo x 1>|../../lib/x.mjs']) assert.equal(run(root, 'inventory', 'Bash', { command }), 2, command)
  for (const command of ['echo x >&2', 'echo x 2>&1', 'echo x >&-', 'echo x >| notes.md']) assert.equal(run(root, 'inventory', 'Bash', { command }), 0, command)
})

test('(review 4) Grep and Glob are reads: no secret files, nothing that reaches another desk\'s runtime/', () => {
  const root = office()
  const hooks = JSON.parse(readFileSync(join(REPO, 'hooks', 'hooks.json'), 'utf8')).hooks.PreToolUse
  const m = hooks.find((h) => /desk-wall/.test(JSON.stringify(h))).matcher
  for (const t of ['Grep', 'Glob']) assert.ok(new RegExp(`^(?:${m})$`).test(t), `the matcher reaches ${t}`)
  assert.equal(run(root, 'inventory', 'Grep', { pattern: 'TOKEN', path: join(root, 'desks', 'customer', 'runtime') }), 2)
  assert.equal(run(root, 'inventory', 'Grep', { pattern: 'TOKEN', path: root }), 2, 'the repo root reaches every desk\'s runtime/')
  assert.equal(run(root, 'inventory', 'Grep', { pattern: 'TOKEN', path: join(root, 'desks') }), 2)
  assert.equal(run(root, 'inventory', 'Grep', { pattern: 'x', path: join(root, '.env') }), 2)
  assert.equal(run(root, 'inventory', 'Grep', { pattern: 'x', path: join(root, 'lib'), glob: '**/.env*' }), 2)
  assert.equal(run(root, 'inventory', 'Glob', { pattern: '**/.env', path: join(root, 'lib') }), 2)
  assert.equal(run(root, 'inventory', 'Glob', { pattern: 'desks/*/runtime/*', path: root }), 2)
  assert.equal(run(root, 'inventory', 'Grep', { pattern: 'x', path: join(root, 'lib') }), 0)
  assert.equal(run(root, 'inventory', 'Grep', { pattern: 'x', path: join(root, 'desks', 'inventory') }), 0)
  assert.equal(run(root, 'inventory', 'Glob', { pattern: '**/*.md' }), 0, 'from its own folder')
})

test('(review 5) Bash does not read another desk\'s runtime/ either: direct, by glob, or by a recursive walk', () => {
  const root = office()
  for (const command of [
    'cat ../customer/runtime/token.json', 'head -c 100 ../customer/runtime/x', "cat '../customer/runtime/x'", 'cat ../../desks/customer/runtime/*',
    'cat ../*/runtime/*', 'grep -r TOKEN ../../desks', 'grep -R TOKEN ..', 'rg TOKEN ../..', 'find ../.. -name "*.json"', 'tar cz ../customer',
    'cd ../customer && cat runtime/x',
  ]) assert.equal(run(root, 'inventory', 'Bash', { command }), 2, command)
  for (const command of ['cat runtime/mine.json', 'cat ../customer/facts.md', 'grep -r x lib', 'grep -r TOKEN .', 'ls ../../desks', 'rg x ../../lib']) assert.equal(run(root, 'inventory', 'Bash', { command }), 0, command)
})
