// ROLES (0.17.0). A role is a NEW session with its own folder, name and
// generated --settings; never a switch in place, never a second session under a
// live name, and a department's role only where this machine runs it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { profilesOf, rolesHere, settingsOf, writeProfile, profilesDir, roleCommand, openRole, hereRole, launchRefused } from '../lib/role.mjs'
import { roleLines } from '../hooks/desk-boot.mjs'

// ⛔ NOTHING HERE MAY OPEN A REAL WINDOW (2026-10-23: a mutation run of this file
// opened Terminal windows on the owner's desktop). Every opener the code could
// reach is a stub on PATH that records the call; orca answers "not running".
const STUBS = mkdtempSync(join(tmpdir(), 'oa-role-stubs-'))
const CALLS = join(STUBS, 'calls.log')
for (const b of ['osascript', 'tmux', 'orca', 'claude', 'open']) writeFileSync(join(STUBS, b), `#!/bin/sh\necho "${b} $*" >> '${CALLS}'\nexit 1\n`, { mode: 0o755 })
process.env.PATH = `${STUBS}:${dirname(process.execPath)}:/usr/bin:/bin`
const stubCalls = () => { try { return readFileSync(CALLS, 'utf8').trim().split('\n').filter(Boolean) } catch { return [] } }

const PROFILES = {
  _note: 'one session per role',
  construction: { cwd: '.', deny: ['Read(./departments/**/*)'], note: 'Do not search departments/.' },
  full: { cwd: '.' },
  aics: { department: 'customer-service', claudeMdExcludes: ['**/local-cabinets-ops/CLAUDE.md'] },
  erp: { department: 'local-ops' },
}
function office({ profiles = PROFILES, machine = { departments: ['customer-service'], role: 'aics' }, extra = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oa-role-'))
  const home = mkdtempSync(join(tmpdir(), 'oa-role-home-'))
  mkdirSync(join(root, 'desks', 'x'), { recursive: true })
  writeFileSync(join(root, 'desks', 'x', 'desk.json'), JSON.stringify({ name: 'x', kind: 'knowledge', port: 9901 }))
  mkdirSync(join(root, 'departments', 'aics'), { recursive: true })
  const cfg = {
    roleEnv: 'OFFICE_ROLE',
    departments: { 'customer-service': { dir: 'departments/aics', lead: 'AICS', desks: [] }, 'local-ops': { lead: 'ERP', desks: [] } },
    construction: [{ name: 'construction', root: '.', model: 'opus' }],
    ...(profiles ? { profiles } : {}), ...extra,
  }
  writeFileSync(join(root, 'office.json'), JSON.stringify(cfg))
  if (machine) { mkdirSync(join(root, '.office'), { recursive: true }); writeFileSync(join(root, '.office', 'local.json'), JSON.stringify(machine)) }
  return { root, home, cfg }
}
const live = (name, cwd, pid = 4242) => ({ pid, name, cwd, sessionId: `00000000-0000-4000-8000-${String(pid).padStart(12, '0')}` })

test('profiles: a department\'s role is its lead in its folder; a builder\'s takes its name and model; the rest their own', () => {
  const o = office()
  const P = profilesOf(o.root, o.cfg)
  assert.deepEqual(P.problems, [])
  assert.deepEqual(P.list.map((p) => [p.name, p.session, p.cwd.slice(o.root.length) || '/', p.isLead, p.model]), [
    ['construction', 'construction', '/', false, 'opus'], ['full', 'full', '/', false, null],
    ['aics', 'AICS', '/departments/aics', true, null], ['erp', 'ERP', '/departments/local-ops', true, null],
  ])
})

test('⛔ a department\'s role opens only where this machine runs it; the default is this machine\'s', () => {
  const o = office()
  const R = rolesHere(o.root, o.cfg)
  assert.deepEqual(R.list.map((p) => p.name), ['construction', 'full', 'aics'])
  assert.deepEqual(R.hidden, ['erp'])
  assert.equal(R.default, 'aics')
  const r = openRole(o.root, 'erp', { cfg: o.cfg, sessions: [], term: false, caller: null, home: o.home })
  assert.equal(r.state, 'refused')
  assert.match(r.why, /belongs to a department this machine does not run/)
  const none = office({ machine: null })
  assert.deepEqual(rolesHere(none.root, none.cfg).list.map((p) => p.name), ['construction', 'full'], 'no machine setting: no department role')
})

test('⛔ globs, not machine paths: a rule or exclude that names one machine\'s path is refused', () => {
  for (const bad of [{ deny: ['Read(/etc/passwd)'] }, { deny: ['Read(//Users/x/**)'] }, { deny: ['Read(~/.ssh/**)'] }, { claudeMdExcludes: ['/Users/x/CLAUDE.md'] }]) {
    const o = office({ profiles: { p: { cwd: '.', ...bad } } })
    const P = profilesOf(o.root, o.cfg)
    assert.equal(P.list.length, 0, JSON.stringify(bad))
    assert.match(P.problems[0], /is a path on one machine/)
  }
  const o = office({ profiles: { p: { cwd: '../elsewhere' }, q: { department: 'nope' }, r: { deny: ['not a rule!'] } } })
  assert.deepEqual(profilesOf(o.root, o.cfg).problems.map((x) => x.split(':')[0]), ['profile p', 'profile q', 'profile r'])
  // a builder's own root may be another codebase
  const b = office({ profiles: { plugin: { builder: 'oa' } }, extra: { construction: [{ name: 'oa', root: '../office-anything', model: 'opus' }] } })
  assert.equal(profilesOf(b.root, b.cfg).list[0].cwd, resolve(b.root, '../office-anything'))
})

test('the settings file is generated from office.json, outside the repo, and follows it', () => {
  const o = office()
  const p = profilesOf(o.root, o.cfg).list.find((x) => x.name === 'construction')
  assert.deepEqual(settingsOf(p), { permissions: { deny: ['Read(./departments/**/*)'] } })
  const f = writeProfile(o.root, p, o.home)
  assert.ok(f.startsWith(join(o.home, '.office', 'profiles') + '/'), f)
  assert.ok(!f.startsWith(o.root), 'never in the repo')
  assert.equal(profilesDir(o.root, o.home), join(o.home, '.office', 'profiles', f.split('/').at(-2)))
  assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')), { permissions: { deny: ['Read(./departments/**/*)'] } })
  // office.json changes: the next launch writes the new rules
  writeProfile(o.root, { ...p, deny: ['Read(./departments/**/*)', 'Grep(./departments/**)'] }, o.home)
  assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')).permissions.deny, ['Read(./departments/**/*)', 'Grep(./departments/**)'])
  const aics = profilesOf(o.root, o.cfg).list.find((x) => x.name === 'aics')
  assert.deepEqual(settingsOf(aics), { claudeMdExcludes: ['**/local-cabinets-ops/CLAUDE.md'] })
})

test('the command: its folder, its name, its role variable, its generated settings', () => {
  const o = office()
  const aics = profilesOf(o.root, o.cfg).list.find((x) => x.name === 'aics')
  const cmd = roleCommand(o.root, o.cfg, aics, { home: o.home })
  assert.match(cmd, new RegExp(`^cd '${join(o.root, 'departments', 'aics').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}' && OFFICE_PROFILE=aics OFFICE_ROLE='AICS' `))
  assert.match(cmd, / claude --name 'AICS' /)
  assert.match(cmd, new RegExp(`--settings '${join(o.home, '.office', 'profiles').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[^/]+/aics\\.json'`))
})

test('⛔ never two sessions under one name: a running role is brought forward, one elsewhere refused', () => {
  const o = office()
  const switched = [], created = []
  const term = { all: () => [{ handle: 'term_A', title: '✳ AICS', agent: true, path: o.root }], create: (x) => { created.push(x); return 'term_new' }, switch: (h) => switched.push(h) }
  const here = openRole(o.root, 'aics', { cfg: o.cfg, sessions: [live('AICS', join(o.root, 'departments', 'aics'))], term, caller: null, home: o.home })
  assert.equal(here.state, 'already')
  assert.match(here.why, /AICS is already open: Orca tab term_A, brought forward; not opening a second/)
  assert.deepEqual(switched, ['term_A'])
  assert.equal(created.length, 0)
  const away = openRole(o.root, 'aics', { cfg: o.cfg, sessions: [live('AICS', '/somewhere/else')], term, caller: null, home: o.home })
  assert.equal(away.state, 'refused')
  assert.match(away.why, /already runs at \/somewhere\/else .*one name, one session/)
  assert.equal(created.length, 0)
  const h = hereRole(o.root, 'aics', { cfg: o.cfg, sessions: [live('AICS', join(o.root, 'departments', 'aics'))], term, home: o.home })
  assert.equal(h.state, 'already')
})

test('a new role opens in a new Orca tab titled with its session; else tmux; else Terminal', () => {
  const o = office()
  const created = []
  const term = { all: () => [], create: (x) => { created.push(x); return 'term_new' }, switch: () => {} }
  const r = openRole(o.root, 'construction', { cfg: o.cfg, sessions: [], term, run: () => ({ status: 1 }), caller: null, home: o.home })
  assert.equal(r.state, 'opened')
  assert.match(r.why, /the new construction session is open in Orca tab term_new; you can close this one/)
  assert.equal(created[0].title, 'construction')
  assert.match(created[0].command, /OFFICE_PROFILE=construction .*--model opus/)
  const calls = []
  const run = (cmd, args) => { calls.push([cmd, args[0]]); return { status: cmd === 'orca' ? 1 : 0 } }
  assert.equal(openRole(o.root, 'full', { cfg: o.cfg, sessions: [], term: false, caller: null, run, env: { TMUX: '/tmp/t' }, home: o.home }).state, 'opened')
  assert.deepEqual(calls.at(-1), ['tmux', 'new-window'])
  if (process.platform === 'darwin') {
    openRole(o.root, 'full', { cfg: o.cfg, sessions: [], term: false, caller: null, run, env: {}, home: o.home })
    assert.equal(calls.at(-1)[0], 'osascript')
  }
})

test('⛔ a desk does not open a role', () => {
  const o = office()
  const r = openRole(o.root, 'full', { cfg: o.cfg, sessions: [], term: false, caller: { kind: 'desk', desk: 'x' }, home: o.home })
  assert.equal(r.state, 'refused')
  assert.match(r.why, /a desk does not open other sessions/)
})

test('boot: a root session with no role is told how to get one; a role is told which, and its note; no profiles, nothing', () => {
  const o = office()
  assert.deepEqual(roleLines(o.root, o.cfg, o.root, {}, null), ['dev/construction session; /role to switch (construction, full, aics).'])
  assert.deepEqual(roleLines(o.root, o.cfg, o.root, { OFFICE_PROFILE: 'construction' }, null), ['You are construction, opened as the construction role.', 'Do not search departments/.'])
  assert.deepEqual(roleLines(o.root, o.cfg, join(o.root, 'desks', 'x'), {}, { kind: 'desk' }), [])
  assert.deepEqual(roleLines(o.root, o.cfg, o.root, {}, { kind: 'lead' }), [], 'the lead already knows who it is')
  const bare = office({ profiles: null })
  assert.deepEqual(roleLines(bare.root, bare.cfg, bare.root, {}, null), [])
})

test('the README documents roles and the `office` command', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  assert.match(readme, /## Roles: open a session as who you mean to be/)
  assert.match(readme, /node lib\/role\.mjs install/)
  assert.ok(existsSync(new URL('../commands/role.md', import.meta.url)))
})

test('⛔ through the real boot hook: the root line prints with profiles, and nothing changes without them', async () => {
  const { spawnSync } = await import('node:child_process')
  const { fileURLToPath } = await import('node:url')
  const HOOK = fileURLToPath(new URL('../hooks/desk-boot.mjs', import.meta.url))
  const boot = (root, env = {}) => { const e = { ...process.env, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'oa-role-cfg-')), ...env }; delete e.OFFICE_ROLE; if (!env.OFFICE_PROFILE) delete e.OFFICE_PROFILE; return spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd: root, source: 'startup' }), encoding: 'utf8', env: e, cwd: root }).stdout.trim() }
  const o = office()
  assert.equal(boot(o.root), 'dev/construction session; /role to switch (construction, full, aics).')
  assert.equal(boot(o.root, { OFFICE_PROFILE: 'construction' }), 'You are construction, opened as the construction role.\nDo not search departments/.')
  assert.equal(boot(office({ profiles: null }).root), '')
})

test('`office` on PATH: a shim that runs the newest installed plugin\'s role.mjs here', async () => {
  const { installShim } = await import('../lib/role.mjs')
  const { statSync } = await import('node:fs')
  const { spawnSync } = await import('node:child_process')
  const home = mkdtempSync(join(tmpdir(), 'oa-role-shim-'))
  const r = installShim({ home, dir: join(home, 'bin') })
  assert.equal(r.file, join(home, 'bin', 'office'))
  assert.ok(statSync(r.file).mode & 0o111, 'executable')
  // two installed versions: the newer one runs
  for (const v of ['0.16.0', '0.17.0']) { mkdirSync(join(home, '.claude', 'plugins', 'cache', 'm', 'office-anything', v, 'lib'), { recursive: true }); writeFileSync(join(home, '.claude', 'plugins', 'cache', 'm', 'office-anything', v, 'lib', 'role.mjs'), `console.log('${v}', process.argv.slice(2).join(' '))`) }
  const out = spawnSync('/bin/sh', [r.file, 'aics'], { encoding: 'utf8', cwd: home, env: { ...process.env, CLAUDE_CONFIG_DIR: join(home, '.claude') } }).stdout.trim()
  assert.match(out, /^0\.17\.0 .* here aics$/)
})

test('⛔ no real launch under a test: the real openers refuse unless the test injects its own', () => {
  assert.match(launchRefused({ NODE_TEST_CONTEXT: 'child' }), /under node --test/)
  assert.match(launchRefused({ OFFICE_NO_LAUNCH: '1' }), /OFFICE_NO_LAUNCH=1/)
  assert.equal(launchRefused({}), null, 'a real session launches')
  assert.ok(process.env.NODE_TEST_CONTEXT, 'node --test marks its processes')
  const o = office()
  const before = stubCalls().length
  const r = openRole(o.root, 'full', { cfg: o.cfg, sessions: [], caller: null, home: o.home })
  assert.equal(r.state, 'refused')
  assert.match(r.why, /no real window or session is opened/)
  assert.deepEqual(stubCalls().slice(before), [], 'no opener was even asked')
})

test('⛔ Orca running but unable to open it here: refused and said, never a plain Terminal window', () => {
  const o = office()
  const calls = []
  const run = (cmd, args) => { calls.push(cmd); return { status: 0 } }
  const r = openRole(o.root, 'full', { cfg: o.cfg, sessions: [], term: false, caller: null, run, env: {}, home: o.home })
  assert.equal(r.state, 'refused')
  assert.match(r.why, /Orca is running but has no workspace holding/)
  assert.ok(!calls.includes('osascript') && !calls.includes('tmux'), JSON.stringify(calls))
  const term = { all: () => [], create: () => { throw new Error('no Orca workspace contains it') }, switch: () => {} }
  assert.match(openRole(o.root, 'full', { cfg: o.cfg, sessions: [], term, caller: null, run, env: {}, home: o.home }).why, /Orca is running but could not open a tab/)
})

test('⛔ install never needs sudo: an unwritable /usr/local/bin falls back to ~/.local/bin, with the PATH line', async () => {
  const { installShim } = await import('../lib/role.mjs')
  const home = mkdtempSync(join(tmpdir(), 'oa-role-inst-'))
  const r = installShim({ home, path: '/usr/local/bin:/usr/bin', writable: () => false })
  assert.equal(r.file, join(home, '.local', 'bin', 'office'))
  assert.equal(r.onPath, false)
  assert.equal(r.pathLine, `export PATH="${join(home, '.local', 'bin')}:$PATH"`)
  const on = installShim({ home, path: `${join(home, '.local', 'bin')}:/usr/bin`, writable: () => false })
  assert.equal(on.pathLine, null, 'already on PATH: nothing to add')
})

test('⛔ a role below the root carries the root\'s hooks (pinned to the root) and permissions; a root role needs none', async () => {
  const { spawnSync } = await import('node:child_process')
  const o = office()
  mkdirSync(join(o.root, '.claude'), { recursive: true })
  // the shape of local-cabinets-ops' root settings, 2026-10-23
  writeFileSync(join(o.root, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'x@x': true }, hooks: {
    PreToolUse: [{ matcher: 'Bash|Read|Write', hooks: [{ type: 'command', command: 'echo "$CLAUDE_PROJECT_DIR/desks/hooks/write-wall.mjs" || exit 2' }] }],
    SessionStart: [{ hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/desks/hooks/desk-boot.mjs" || true' }] }],
  } }))
  writeFileSync(join(o.root, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash(cd *)'], deny: ['Read(/desks/**/runtime/**)'] } }))
  const P = profilesOf(o.root, o.cfg).list
  const aics = settingsOf(P.find((p) => p.name === 'aics'), { root: o.root })
  assert.deepEqual(Object.keys(aics.hooks), ['PreToolUse', 'SessionStart'])
  assert.equal(aics.hooks.PreToolUse[0].matcher, 'Bash|Read|Write')
  assert.deepEqual(aics.permissions.allow, ['Bash(cd *)'])
  assert.deepEqual(aics.permissions.deny, [`Read(/${o.root}/desks/**/runtime/**)`], 'a root-relative rule made absolute: its settings file moved')
  assert.deepEqual(aics.enabledPlugins, { 'x@x': true })
  assert.deepEqual(aics.claudeMdExcludes, ['**/local-cabinets-ops/CLAUDE.md'])
  // the hook, run as Claude Code would from the department's folder, sees the office root
  const cmd = aics.hooks.PreToolUse[0].hooks[0].command
  const out = spawnSync('/bin/sh', ['-c', cmd], { cwd: join(o.root, 'departments', 'aics'), env: { ...process.env, CLAUDE_PROJECT_DIR: join(o.root, 'departments', 'aics') }, encoding: 'utf8' }).stdout.trim()
  assert.equal(out, join(o.root, 'desks', 'hooks', 'write-wall.mjs'))
  // a role at the root loads the root's settings itself: nothing copied
  const cons = settingsOf(P.find((p) => p.name === 'construction'), { root: o.root })
  assert.equal(cons.hooks, undefined)
  assert.deepEqual(cons.permissions, { deny: ['Read(./departments/**/*)'] })
  // opting out
  assert.equal(settingsOf({ ...P.find((p) => p.name === 'aics'), rootSettings: false }, { root: o.root }).hooks, undefined)
})
