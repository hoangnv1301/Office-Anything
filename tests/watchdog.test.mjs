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
  const run = spawnSync(process.execPath, [r.shim], { env: { ...process.env, HOME: w.home }, encoding: 'utf8' })
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
    const run = spawnSync(process.execPath, [r.shim], { env: { ...process.env, HOME: w.home }, encoding: 'utf8' })
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
