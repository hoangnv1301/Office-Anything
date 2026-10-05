// THE WATCHDOG. A LaunchAgent that runs `health --heal` every 2 minutes, and
// nothing is installed until the owner runs --install-watchdog.
// ⛔ THE PLUGIN'S PATH CHANGES WITH EVERY VERSION (cache/<name>/<version>/), so
// a plist pointing into the cache runs a stale copy, or nothing, after the
// first update. The plist points at a shim in the project's own .office/, and
// the shim asks installed_plugins.json where the plugin lives NOW.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { installWatchdog, uninstallWatchdog, labelFor } from '../lib/watchdog.mjs'

function world() {
  const root = mkdtempSync(join(tmpdir(), 'oa-wd-root-'))
  const home = mkdtempSync(join(tmpdir(), 'oa-wd-home-'))
  const calls = []
  const launchctl = (args) => { calls.push(args); return { status: 0 } }
  return { root, home, calls, launchctl }
}

test('install writes one plist for this office, every 120s, logging into .office/', () => {
  const w = world()
  const r = installWatchdog(w.root, { home: w.home, launchctl: w.launchctl, uid: 501 })
  assert.ok(r.ok, r.why)
  const plist = readFileSync(join(w.home, 'Library', 'LaunchAgents', labelFor(w.root) + '.plist'), 'utf8')
  assert.match(plist, /<key>StartInterval<\/key>\s*<integer>120<\/integer>/)
  assert.match(plist, new RegExp(join(w.root, '.office', 'watchdog.mjs').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.ok(!/plugins\/cache/.test(plist), 'never points into the versioned plugin cache')
  assert.deepEqual(w.calls.at(-1).slice(0, 2), ['bootstrap', 'gui/501'])
})

test('two offices get two watchdogs, not one that overwrites the other', () => {
  const a = world(), b = world()
  assert.notEqual(labelFor(a.root), labelFor(b.root))
})

test('the shim finds the plugin where it is installed NOW and runs health --heal on this office', () => {
  const w = world()
  installWatchdog(w.root, { home: w.home, launchctl: w.launchctl, uid: 501 })
  // a fake installed plugin whose health.mjs records how it was called
  const install = mkdtempSync(join(tmpdir(), 'oa-wd-plugin-'))
  mkdirSync(join(install, 'lib'), { recursive: true })
  writeFileSync(join(install, 'lib', 'health.mjs'), `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(join(w.root, 'ran.json'))}, JSON.stringify(process.argv.slice(2)))\n`)
  mkdirSync(join(w.home, '.claude', 'plugins'), { recursive: true })
  writeFileSync(join(w.home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'office-anything@office-anything': [{ installPath: install, version: '9.9.9' }] } }))
  const r = spawnSync(process.execPath, [join(w.root, '.office', 'watchdog.mjs')], { env: { ...process.env, HOME: w.home }, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(JSON.parse(readFileSync(join(w.root, 'ran.json'), 'utf8')), [w.root, '--heal'])
})

test('uninstall boots it out and removes the plist', () => {
  const w = world()
  installWatchdog(w.root, { home: w.home, launchctl: w.launchctl, uid: 501 })
  const r = uninstallWatchdog(w.root, { home: w.home, launchctl: w.launchctl, uid: 501 })
  assert.ok(r.ok)
  assert.ok(!existsSync(join(w.home, 'Library', 'LaunchAgents', labelFor(w.root) + '.plist')))
  assert.ok(w.calls.some((c) => c[0] === 'bootout'))
})
