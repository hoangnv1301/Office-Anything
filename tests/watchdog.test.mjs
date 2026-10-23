// THE WATCHDOG. A LaunchAgent that runs `health --heal` every 2 minutes, and
// nothing is installed until the owner runs --install-watchdog. Every test
// injects launchctl: nothing here loads a real agent.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { installWatchdog, uninstallWatchdog, labelFor, pathsFor, refusal } from '../lib/watchdog.mjs'

function world() {
  const root = mkdtempSync(join(tmpdir(), 'oa-wd-root-'))
  mkdirSync(join(root, 'desks'))
  const home = mkdtempSync(join(tmpdir(), 'oa-wd-home-'))
  const calls = []
  const launchctl = (args) => { calls.push(args); return { status: 0 } }
  return { root, home, calls, launchctl, opts: { home, launchctl, uid: 501, path: '/my/bin:/usr/bin', allowTempRoot: true } }
}

test('the plist: every 120s, PATH carried, node through env, Standard, nothing on the office disk', () => {
  const w = world()
  const r = installWatchdog(w.root, w.opts)
  assert.ok(r.ok, r.why)
  const plist = readFileSync(r.plist, 'utf8')
  assert.match(plist, /<key>StartInterval<\/key>\s*<integer>120<\/integer>/)
  assert.match(plist, /<key>PATH<\/key><string>\/my\/bin:\/usr\/bin:\/opt\/homebrew\/bin/, 'launchd starts with a bare PATH: node and start would exit 127')
  assert.match(plist, /<string>\/usr\/bin\/env<\/string><string>node<\/string>/, 'no baked node binary path')
  assert.ok(!plist.includes(process.execPath), 'a node upgrade must not strand it')
  assert.match(plist, /<key>ProcessType<\/key><string>Standard<\/string>/)
  assert.ok(!plist.includes(w.root), 'shim, log and working directory are on the home disk, never the office disk')
  assert.ok(r.shim.startsWith(w.home) && r.log.startsWith(w.home))
  assert.ok(!/plugins\/cache/.test(plist + readFileSync(r.shim, 'utf8')), 'never points into the versioned plugin cache')
  assert.deepEqual(w.calls.at(-1).slice(0, 2), ['bootstrap', 'gui/501'])
})

test('⛔ refused: an office in a temp folder, a git worktree, or a folder with no desks', () => {
  assert.match(refusal('/private/tmp/x'), /temp/)
  assert.match(refusal('/var/folders/ab/T/x'), /temp/)
  const wt = mkdtempSync(join(tmpdir(), 'oa-wt-'))
  mkdirSync(join(wt, 'desks'))
  writeFileSync(join(wt, '.git'), 'gitdir: /somewhere/.git/worktrees/x\n')
  assert.match(refusal(wt), /worktree/)
  const w = world()
  const r = installWatchdog(wt, { ...w.opts })
  assert.equal(r.ok, false, 'allowTempRoot does not excuse a worktree')
  assert.equal(w.calls.length, 0, 'nothing loaded')
})

test('two offices get two watchdogs, not one that overwrites the other', () => {
  const a = world(), b = world()
  assert.notEqual(labelFor(a.root), labelFor(b.root))
})

test('the shim finds the plugin where it is installed NOW and runs health --heal on this office', () => {
  const w = world()
  const r = installWatchdog(w.root, w.opts)
  const install = mkdtempSync(join(tmpdir(), 'oa-wd-plugin-'))
  mkdirSync(join(install, 'lib'), { recursive: true })
  writeFileSync(join(install, 'lib', 'health.mjs'), `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(join(w.root, 'ran.json'))}, JSON.stringify(process.argv.slice(2)))\nconsole.log('office: green')\n`)
  mkdirSync(join(w.home, '.claude', 'plugins'), { recursive: true })
  writeFileSync(join(w.home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'office-anything@office-anything': [{ installPath: install, version: '9.9.9' }] } }))
  const run = spawnSync(process.execPath, [r.shim], { env: { ...process.env, HOME: w.home, CLAUDE_CONFIG_DIR: '' }, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(JSON.parse(readFileSync(join(w.root, 'ran.json'), 'utf8')), [w.root, '--heal'])
  assert.match(readFileSync(r.log, 'utf8'), /office: green/, 'the run lands in the log on the home disk')
})

test('⛔ the office disk is not mounted: one line an hour, a clean exit, nothing run', () => {
  const w = world()
  const gone = join(w.root, 'not-mounted')
  mkdirSync(join(gone, 'desks'), { recursive: true })
  const r = installWatchdog(gone, w.opts)
  spawnSync('rm', ['-rf', gone])
  for (let i = 0; i < 3; i++) {
    const run = spawnSync(process.execPath, [r.shim], { env: { ...process.env, HOME: w.home, CLAUDE_CONFIG_DIR: '' }, encoding: 'utf8' })
    assert.equal(run.status, 0)
  }
  const lines = readFileSync(r.log, 'utf8').trim().split('\n')
  assert.equal(lines.length, 1, 'said once, not every 120 s')
  assert.match(lines[0], /not found/)
})

test('uninstall boots it out and removes the plist and the shim', () => {
  const w = world()
  const r = installWatchdog(w.root, w.opts)
  const u = uninstallWatchdog(w.root, w.opts)
  assert.ok(u.ok)
  assert.ok(!existsSync(r.plist) && !existsSync(r.shim))
  assert.ok(w.calls.some((c) => c[0] === 'bootout'))
  assert.equal(pathsFor(w.root, w.home).plist, r.plist)
})

test('the shim honours CLAUDE_CONFIG_DIR and runs an install that EXISTS, the newest, not entry [0]', () => {
  const w = world()
  const r = installWatchdog(w.root, w.opts)
  const fake = (tag) => {
    const d = mkdtempSync(join(tmpdir(), 'oa-wd-' + tag + '-'))
    mkdirSync(join(d, 'lib'), { recursive: true })
    writeFileSync(join(d, 'lib', 'health.mjs'), `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(join(w.root, 'which.txt'))}, ${JSON.stringify(tag)})\n`)
    return d
  }
  const older = fake('older'), newer = fake('newer')
  const cfg = mkdtempSync(join(tmpdir(), 'oa-wd-cfg-'))
  mkdirSync(join(cfg, 'plugins'), { recursive: true })
  writeFileSync(join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'office-anything@office-anything': [
    { installPath: join(tmpdir(), 'gone-' + Date.now()), lastUpdated: '2026-10-09T00:00:00Z' },
    { installPath: older, lastUpdated: '2026-10-01T00:00:00Z' },
    { installPath: newer, lastUpdated: '2026-10-05T00:00:00Z' },
  ] } }))
  const run = spawnSync(process.execPath, [r.shim], { env: { ...process.env, HOME: w.home, CLAUDE_CONFIG_DIR: cfg }, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(readFileSync(join(w.root, 'which.txt'), 'utf8'), 'newer')
})

// ⛔ A STALE SHIM SKIPPED A LIVE OFFICE FOR FOUR HOURS (0.20.2). local-cabinets-ops'
// shim, written before desks could leave desks/, tested `join(root, 'desks')`;
// its cleanup retired desks/, and every pass said "office not found" while the
// disk sat mounted. The shim now only finds the install and runs its
// lib/watchdog-pass.mjs, and an installed shim is rewritten when it is not the
// one this version writes: by every session start, health and ensureWatchdog.
import { copyFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { refreshShim } from '../lib/watchdog.mjs'
import { pass, officeThere } from '../lib/watchdog-pass.mjs'
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const OLD_SHIM = (root) => `// written by office-anything --install-watchdog\nimport { existsSync } from 'node:fs'\nimport { join } from 'node:path'\nconst root = ${JSON.stringify(root)}\nif (!existsSync(join(root, 'desks'))) process.exit(0)\n`
// an office the way local-cabinets-ops is now: office.json, departments/, no desks/
function retired() {
  const w = world()
  spawnSync('rm', ['-rf', join(w.root, 'desks')])
  mkdirSync(join(w.root, 'departments', 'aics', 'web'), { recursive: true })
  writeFileSync(join(w.root, 'departments', 'aics', 'web', 'desk.json'), JSON.stringify({ name: 'web', kind: 'knowledge', port: 9951 }))
  writeFileSync(join(w.root, 'office.json'), JSON.stringify({ departments: { aics: { lead: 'AICS', desks: ['web'] } } }))
  return w
}

test('⛔ an office with no desks/ (its desks in departments/) is still healed: the shim runs the plugin\'s own pass', () => {
  const w = retired()
  const r = installWatchdog(w.root, w.opts)
  assert.doesNotMatch(readFileSync(r.shim, 'utf8'), /join\(root, 'desks'\)/, 'the shim decides nothing about the layout')
  // an install with the real pass, and a health that says it ran
  const install = mkdtempSync(join(tmpdir(), 'oa-wd-plugin-'))
  mkdirSync(join(install, 'lib'), { recursive: true })
  for (const f of ['watchdog-pass.mjs', 'desk.mjs', 'is-main.mjs']) copyFileSync(join(REPO, 'lib', f), join(install, 'lib', f))
  writeFileSync(join(install, 'lib', 'health.mjs'), `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(join(w.root, 'ran.json'))}, JSON.stringify(process.argv.slice(2)))\nconsole.log('office: green')\n`)
  mkdirSync(join(w.home, '.claude', 'plugins'), { recursive: true })
  writeFileSync(join(w.home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'office-anything@office-anything': [{ installPath: install, version: '0.20.2' }] } }))
  const run = spawnSync(process.execPath, [r.shim], { env: { ...process.env, HOME: w.home, CLAUDE_CONFIG_DIR: '' }, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(JSON.parse(readFileSync(join(w.root, 'ran.json'), 'utf8')), [w.root, '--heal'])
  assert.match(readFileSync(r.log, 'utf8'), /office: green/)
})

test('the pass: an office.json or a desk folder is an office; nothing there is said once an hour', () => {
  const w = retired()
  assert.equal(officeThere(w.root), true)
  const calls = []
  assert.equal(pass(w.root, join(w.home, 'p.log'), { run: (...a) => { calls.push(a); return { stdout: 'ok\n' } } }), 'ran')
  assert.equal(calls[0][1][1], w.root)
  const empty = mkdtempSync(join(tmpdir(), 'oa-wd-empty-')), log = join(w.home, 'e.log')
  const t = Date.now()
  for (const dt of [0, 60_000, 120_000]) assert.equal(pass(empty, log, { run: () => { throw new Error('ran') }, now: t + dt }), 'missing')
  pass(empty, log, { run: () => ({}), now: t + 3700_000 })
  assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 2, 'once an hour')
})

test('⛔ an installed shim an older version wrote is rewritten, a current one left alone, none never made', () => {
  const w = retired()
  const r = installWatchdog(w.root, w.opts)
  writeFileSync(r.shim, OLD_SHIM(w.root))
  assert.equal(refreshShim(w.root, { home: w.home }), 'rewritten')
  assert.match(readFileSync(r.shim, 'utf8'), /watchdog-pass\.mjs/)
  assert.equal(refreshShim(w.root, { home: w.home }), 'current')
  assert.equal(w.calls.filter((c) => c[0] === 'bootstrap').length, 1, 'launchd is not touched by a refresh')
  const other = world()
  assert.equal(refreshShim(other.root, { home: other.home }), 'none', 'no watchdog installed: nothing is written')
  assert.ok(!existsSync(pathsFor(other.root, other.home).shim))
})

test('⛔ every session start rewrites a stale shim (the boot hook), so an update reaches a watchdog nobody reinstalls', () => {
  const w = retired()
  const r = installWatchdog(w.root, w.opts)
  writeFileSync(r.shim, OLD_SHIM(w.root))
  const hook = spawnSync(process.execPath, [join(REPO, 'hooks', 'desk-boot.mjs')], { input: JSON.stringify({ cwd: w.root }), env: { ...process.env, HOME: w.home, CLAUDE_CONFIG_DIR: join(w.home, '.claude') }, cwd: w.root, encoding: 'utf8' })
  assert.equal(hook.status, 0, hook.stderr)
  assert.match(readFileSync(r.shim, 'utf8'), /watchdog-pass\.mjs/)
})
