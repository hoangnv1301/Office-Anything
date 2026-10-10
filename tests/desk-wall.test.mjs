// THE DESK WALL as a gate: refused is refused, allowed is allowed, judged by
// spawning the real hook with a PreToolUse payload and reading its exit code.
// The cases come from the office this was extracted from, where each one was
// a wall that had been walked through once.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { report as wallCheck } from '../checks/desk-wall.mjs'

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'desk-wall.mjs')
const CONFIG = {
  roleEnv: 'OFFICE_ROLE',
  lead: { session: 'Office Lead' },
  wall: {
    failClosed: true,
    secrets: '\\.env\\b|\\.dev\\.vars\\b',
    lockedEnv: ['OPS_TOKEN'],
    deny: [
      { pattern: '\\bwrangler\\b', why: 'desks hold no database keys' },
      { pattern: '\\bd1\\s+execute\\b|\\bsqlite3\\b', why: 'desks do not touch the database directly' },
      { pattern: 'ops\\.mjs\\s+(approve|reject)\\b', why: 'approving is the lead\'s' },
    ],
    lead: { bash: ['^\\s*(node \\S*scripts/desk/ops\\.mjs\\s+\\S|ls(\\s|$))'] },
    audit: ['\\bwrangler\\b', '\\bsqlite3\\b'],
  },
}
function office(cfg = CONFIG) {
  const root = mkdtempSync(join(tmpdir(), 'oa-wall-'))
  for (const n of ['inventory', 'manufacturing', 'customer', 'quotes']) {
    mkdirSync(join(root, 'desks', n, 'runtime'), { recursive: true })
    writeFileSync(join(root, 'desks', n, 'desk.json'), JSON.stringify({ name: n, kind: 'knowledge', port: 9300 + n.length }))
  }
  mkdirSync(join(root, 'lib'), { recursive: true })
  if (cfg) writeFileSync(join(root, 'office.json'), JSON.stringify(cfg))
  return root
}
const ROOT = office()
const env0 = () => { const e = { ...process.env, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'oa-cfg-')) }; delete e.OFFICE_ROLE; return e }
const run = (desk, tool_name, tool_input, { raw, root = ROOT, env = env0() } = {}) => {
  const cwd = desk === 'lead' ? root : desk ? join(root, 'desks', desk) : root
  if (desk === 'lead') env.OFFICE_ROLE = 'Office Lead'
  // Claude Code runs a hook in the session's folder: the cwd is a witness even when the payload is not
  return spawnSync(process.execPath, [HOOK], { input: raw ?? JSON.stringify({ tool_name, tool_input, cwd }), encoding: 'utf8', env, cwd }).status
}
const ok = (...a) => assert.equal(run(...a), 0, JSON.stringify(a))
const no = (...a) => assert.equal(run(...a), 2, JSON.stringify(a))

test('inert without a wall: no office.json, or a developer session at the root', () => {
  const bare = office(null)
  assert.equal(run('inventory', 'Bash', { command: 'wrangler d1 execute' }, { root: bare }), 0, 'no office.json: the plugin does not judge')
  ok(null, 'Bash', { command: 'wrangler d1 execute' })
  ok(null, 'Write', { file_path: join(ROOT, 'lib', 'x.ts') })
})

test('a payload the hook cannot read is refused in a walled office, whoever sent it (the lead\'s review of 0.7.40)', () => {
  // it used to pass for a developer and under failClosed: false; an unreadable
  // payload is never what Claude Code sends, so it is treated as an attack
  assert.equal(run('inventory', null, null, { raw: '{not json' }), 2)
  const open = office({ ...CONFIG, wall: { ...CONFIG.wall, failClosed: false } })
  assert.equal(run('inventory', null, null, { raw: '{not json', root: open }), 2)
  assert.equal(run(null, null, null, { raw: '{not json' }), 2)
})

test('a desk: the office\'s own refusals, own-folder writes, its door and keys', () => {
  no('inventory', 'Bash', { command: "wrangler d1 execute DB --command 'select 1'" })
  no('inventory', 'Bash', { command: 'git push origin main' })
  no('inventory', 'Write', { file_path: join(ROOT, 'lib', 'verbs.ts') })
  no('inventory', 'Edit', { file_path: join(ROOT, 'desks', 'inventory', 'runtime', '.env') })
  no('inventory', 'Write', { file_path: join(ROOT, 'desks', 'inventory', '.claude', 'settings.json') })
  ok('inventory', 'Write', { file_path: join(ROOT, 'desks', 'inventory', 'facts.md') })
  ok('inventory', 'Bash', { command: 'node ../../scripts/desk/ops.mjs ask items q=white' })
})

test('a desk does not approve, read tokens, swap tokens or walk into another desk', () => {
  no('inventory', 'Bash', { command: "node ../../scripts/desk/ops.mjs approve abc 'all'" })
  no('inventory', 'Bash', { command: 'cat ../runtime/.env' })
  no('inventory', 'Bash', { command: 'cat ../../.dev.vars' })
  no('inventory', 'Bash', { command: 'OPS_TOKEN=abc node ../../scripts/desk/ops.mjs ask x' })
  no('inventory', 'Bash', { command: 'OFFICE_ROLE=desk-customer node ../../scripts/desk/ops.mjs ask x' })
  no('inventory', 'Bash', { command: 'cd ../customer; ls' })
  no('inventory', 'Bash', { command: `cd "${join(ROOT, 'desks', 'quotes')}" && ls` })
  no('inventory', 'Bash', { command: 'cd $HOME/x && ls' })
  ok('inventory', 'Bash', { command: 'cd .. && ls' })
  ok('inventory', 'Bash', { command: `cd ${join(ROOT, 'lib')} && ls` })
  ok('inventory', 'Bash', { command: 'cd ../inventory && ls' })
  no('inventory', 'Read', { file_path: join(ROOT, 'desks', 'customer', 'runtime', 'CLAUDE.md') })
  ok('inventory', 'Read', { file_path: join(ROOT, 'desks', 'inventory', 'runtime', 'CLAUDE.md') })
  ok('inventory', 'Read', { file_path: join(ROOT, 'lib', 'verbs.ts') })
})

test('a desk\'s Bash writes only in its folder or a temp dir; heredoc bodies are data', () => {
  no('manufacturing', 'Bash', { command: 'cd ../../ && sed -i s/a/b/ lib/eta.ts' })
  no('manufacturing', 'Bash', { command: 'sed -i s/a/b/ ../../lib/eta.ts' })
  no('manufacturing', 'Bash', { command: `echo hi > ${join(ROOT, 'lib', 'x.ts')}` })
  no('manufacturing', 'Bash', { command: 'git -C ../../ commit -am x' })
  no('manufacturing', 'Bash', { command: 'cp ../../lib/verbs.ts ./copy.ts' })
  no('manufacturing', 'Bash', { command: 'rm -rf ../../lib' })
  // git is read-only by allowlist: every writing subcommand, not a list of some
  for (const c of ['git branch -D main', 'git clean -fdx', 'git config user.name x', 'git tag v1', 'git worktree add ../x', 'git update-ref HEAD x', 'git -C ../.. branch newbranch', 'git commit -am x'])
    no('manufacturing', 'Bash', { command: c })
  for (const c of ['git status', 'git log --oneline -5', 'git -C ../.. diff HEAD~1', 'git branch', 'git branch --show-current', 'git show HEAD:lib/x.ts | head'])
    ok('manufacturing', 'Bash', { command: c })
  ok('manufacturing', 'Bash', { command: 'echo hi > notes.md' })
  ok('manufacturing', 'Bash', { command: 'rm -f tmp.json' })
  ok('manufacturing', 'Bash', { command: 'node ../../scripts/desk/ops.mjs ask eta > /private/tmp/x/out.json' })
  ok('manufacturing', 'Bash', { command: 'grep -n foo ../../lib/eta.ts' })
  ok('quotes', 'Bash', { command: 'SP=/private/tmp/x && node ../../x.mjs > $SP/v.json && cat ../../tools/app.js | head' })
  no('quotes', 'Bash', { command: `SP=${join(ROOT, 'lib')}; echo x > $SP/y.ts` })
  ok('quotes', 'Bash', { command: "cat > /private/tmp/x/mk.mjs <<'EOF'\nconst f = (a) => a + 1;\nimport { x } from '../../lib/y.js';\nEOF\nnode /private/tmp/x/mk.mjs" })
  no('quotes', 'Bash', { command: "cat > ../../lib/y.ts <<'EOF'\nx\nEOF" })
  no('quotes', 'Bash', { command: "cat <<'EOF' > ../../lib/y.ts\nx\nEOF" })
  ok('quotes', 'Bash', { command: "node -e 'const f = (a) => a; console.log(f(1))'" })
})

test('the lead: only the commands the office lists, unchained, and no file writes', () => {
  ok('lead', 'Bash', { command: 'node scripts/desk/ops.mjs pending' })
  ok('lead', 'Bash', { command: 'ls desks/' })
  no('lead', 'Bash', { command: 'node scripts/desk/ops.mjs pending | head' })
  no('lead', 'Bash', { command: 'cat lib/verbs.ts' })
  no('lead', 'Bash', { command: 'npm test' })
  no('lead', 'Bash', { command: 'node scripts/desk/ops.mjs pending; rm -rf x' })
  no('lead', 'Bash', { command: 'node scripts/desk/ops.mjs pending\nrm -rf x' })
  no('lead', 'Bash', { command: 'node scripts/desk/ops.mjs pending $(rm -rf x)' })
  no('lead', 'Bash', { command: 'ls `rm -rf x`' })
  no('lead', 'Write', { file_path: join(ROOT, 'notes.md') })
  no('lead', 'Read', { file_path: join(ROOT, 'desks', 'inventory', 'runtime', '.env') })
  ok('lead', 'Read', { file_path: join(ROOT, 'README.md') })
})

// ⛔ A DESK RESUMED AT THE REPO ROOT keeps its session name and loses its cd
// and role variable; the wall finds it by name through the CLI's registry.
test('a desk resumed at the root is known by its session name; an unknown desk name is refused', () => {
  const asSession = (name, tool_name, tool_input) => {
    const cfg = mkdtempSync(join(tmpdir(), 'oa-sess-'))
    mkdirSync(join(cfg, 'sessions'))
    writeFileSync(join(cfg, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, name }))
    const env = { ...process.env, CLAUDE_CONFIG_DIR: cfg }; delete env.OFFICE_ROLE
    return spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name, tool_input, cwd: ROOT }), encoding: 'utf8', env }).status
  }
  assert.equal(asSession('desk-inventory', 'Write', { file_path: join(ROOT, 'lib', 'verbs.ts') }), 2)
  assert.equal(asSession('desk-inventory', 'Write', { file_path: join(ROOT, 'desks', 'inventory', 'facts.md') }), 0)
  assert.equal(asSession('Office Lead', 'Write', { file_path: join(ROOT, 'desks', 'inventory', 'facts.md') }), 2)
  assert.equal(asSession('desk-nosuchdesk', 'Bash', { command: 'ls' }), 2)
  assert.equal(asSession('repo-99', 'Bash', { command: 'wrangler d1 execute' }), 0, 'a developer session is not judged')
})

test('the check: a rule that does not compile is a finding; a desk record with an audited command is one', () => {
  const broken = office({ ...CONFIG, wall: { ...CONFIG.wall, deny: [{ pattern: '(unclosed', why: 'x' }] } })
  const r = wallCheck(broken, { home: mkdtempSync(join(tmpdir(), 'oa-h-')) })
  assert.equal(r.code, 4)
  assert.match(r.findings[0].say, /does not compile/)
  const home = mkdtempSync(join(tmpdir(), 'oa-h-'))
  const slug = join(ROOT, 'desks', 'inventory').replace(/[/ ]/g, '-')
  mkdirSync(join(home, '.claude', 'projects', slug), { recursive: true })
  writeFileSync(join(home, '.claude', 'projects', slug, 's.jsonl'), JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'sqlite3 db.sqlite' } }] } }) + '\n')
  const r2 = wallCheck(ROOT, { home })
  assert.equal(r2.code, 4)
  assert.equal(r2.findings[0].desk, 'inventory')
  assert.equal(wallCheck(ROOT, { home: mkdtempSync(join(tmpdir(), 'oa-h-')) }).code, 0)
  assert.equal(wallCheck(office(null)).applicable, false)
})

// ⛔ review: a desk that cd's out of the repo sent a cwd with no office above
// it, and the wall let everything through. The session's project dir does
// not move with cd.
test('a desk that cd\'d out of the repo is still walled: CLAUDE_PROJECT_DIR, and the role variable', () => {
  const runAt = (cwd, env, tool_name, tool_input) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name, tool_input, cwd }), encoding: 'utf8', env, cwd: tmpdir() }).status
  const outside = mkdtempSync(join(tmpdir(), 'oa-outside-'))
  const byDir = { ...env0(), CLAUDE_PROJECT_DIR: join(ROOT, 'desks', 'inventory') }
  assert.equal(runAt(outside, byDir, 'Write', { file_path: join(ROOT, 'lib', 'verbs.ts') }), 2, 'found by its project dir')
  assert.equal(runAt(outside, byDir, 'Bash', { command: 'wrangler d1 execute x' }), 2)
  const byRole = { ...env0(), CLAUDE_PROJECT_DIR: ROOT, OFFICE_ROLE: 'desk-inventory' }
  assert.equal(runAt(outside, byRole, 'Write', { file_path: join(ROOT, 'lib', 'verbs.ts') }), 2, 'found by its role variable, office from the project dir')
  assert.equal(runAt(outside, { ...env0(), CLAUDE_PROJECT_DIR: ROOT }, 'Write', { file_path: join(ROOT, 'lib', 'verbs.ts') }), 0, 'a developer at the root is still not judged')
})

test('a wall that breaks while judging fails closed when the office says so, open when it does not', async () => {
  const { decide } = await import('../hooks/desk-wall.mjs')
  const bad = (failClosed) => office({ ...CONFIG, wall: { ...CONFIG.wall, failClosed, deny: [{ pattern: '(unclosed', why: 'x' }] } })
  const payload = (root) => JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: join(root, 'desks', 'inventory') })
  const env = (root) => ({ ...env0(), CLAUDE_PROJECT_DIR: join(root, 'desks', 'inventory') })
  const closed = bad(true), open = bad(false)
  const r = await decide(payload(closed), env(closed), tmpdir())
  assert.equal(r.code, 2)
  assert.match(r.why, /fails closed/)
  assert.equal((await decide(payload(open), env(open), tmpdir())).code, 0)
})
