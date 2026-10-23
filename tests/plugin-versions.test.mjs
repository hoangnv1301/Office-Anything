// A PLUGIN UPDATE DOES NOT STRAND A RUNNING SESSION (0.18.8). A session keeps
// the hooks it started with: ERP (2026-10-23), started on 0.18.4, was told to
// run its 0.18.7 doorbell and its 0.18.4 wall refused the new folder, so it ran
// the old bell until it was restarted. {plugin} is now this version's folder or
// a NEWER one that Claude Code recorded installing, beside it in the cache.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compileWall, judge, pluginRoots, bellRoots } from '../lib/wall.mjs'
import { officeHealth } from '../lib/health.mjs'
import { heal } from '../lib/heal.mjs'

function cache() {
  const parent = mkdtempSync(join(tmpdir(), 'oa-cache-'))
  const put = (v, name = 'office-anything', at = join(parent, v)) => {
    mkdirSync(join(at, '.claude-plugin'), { recursive: true }); mkdirSync(join(at, 'lib'), { recursive: true })
    writeFileSync(join(at, '.claude-plugin', 'plugin.json'), JSON.stringify({ name, version: v }))
    for (const f of ['lead-bell.mjs', 'tasks.mjs']) writeFileSync(join(at, 'lib', f), '')
    return at
  }
  const own = put('0.18.4')
  put('0.18.7'); put('0.18.10'); put('0.18.1')
  put('0.19.0', 'someone-else')
  // a "version" that is a link to a folder somewhere else
  const away = put('0.20.0', 'office-anything', join(mkdtempSync(join(tmpdir(), 'oa-away-')), 'p'))
  symlinkSync(away, join(parent, '0.20.0'))
  put('0.19.0x')   // this plugin, in a folder that is not a version
  put('0.18.9')    // ⛔ a real copy that merely appeared in the cache: never recorded as installed
  const elsewhere = put('0.21.0', 'office-anything', join(mkdtempSync(join(tmpdir(), 'oa-else-')), '0.21.0'))
  // what Claude Code recorded (installed_plugins.json, as lib/watchdog.mjs reads it)
  const configDir = mkdtempSync(join(tmpdir(), 'oa-cfg-'))
  mkdirSync(join(configDir, 'plugins'))
  const rec = (v) => ({ scope: 'user', installPath: join(parent, v), version: v })
  writeFileSync(join(configDir, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: {
    // 0.19.0 is recorded here but is another plugin's folder
    'office-anything@office-anything': [rec('0.18.7'), rec('0.18.10'), rec('0.18.1'), rec('0.20.0'), rec('0.19.0x'), rec('0.19.0'), { installPath: elsewhere }],
    // 0.18.9 is recorded, but for another plugin
    'someone-else@x': [rec('0.18.9')],
  } }))
  return { parent, own, configDir }
}

test('⛔ {plugin} is this version or a newer RECORDED install beside it; never older, unrecorded, another plugin, a link or elsewhere', () => {
  const { parent, own, configDir } = cache()
  assert.deepEqual(pluginRoots(own, { configDir }).map((d) => d.slice(parent.length + 1)).sort(), ['0.18.10', '0.18.4', '0.18.7'])
  // no record to read: only itself
  assert.deepEqual(pluginRoots(own, { configDir: mkdtempSync(join(tmpdir(), 'oa-cfg-none-')) }), [own])
  // a checkout, not a version folder: only itself
  const repo = mkdtempSync(join(tmpdir(), 'oa-repo-'))
  assert.deepEqual(pluginRoots(repo, { configDir }), [repo])
})

test('⛔ a session on an older wall runs its doorbell and its listed commands from the newer install', () => {
  const { parent, own, configDir } = cache()
  const root = mkdtempSync(join(tmpdir(), 'oa-office-'))
  const W = compileWall({ root, leadWake: 'node {plugin}/lib/lead-bell.mjs', lead: { bash: ['^node {plugin}/lib/tasks\\.mjs list$'] } }, { pluginRoot: own, configDir })
  const mon = (c) => judge({ tool_name: 'Monitor', tool_input: { command: c }, cwd: root }, { kind: 'lead' }, root, W)
  const bash = (c) => judge({ tool_name: 'Bash', tool_input: { command: c }, cwd: root }, { kind: 'lead' }, root, W)
  assert.equal(mon(`node ${own}/lib/lead-bell.mjs`), null, 'its own version')
  assert.equal(mon(`node ${parent}/0.18.7/lib/lead-bell.mjs`), null, 'the update it was told to run')
  assert.equal(bash(`node ${parent}/0.18.10/lib/tasks.mjs list`), null)
  for (const v of ['0.18.1', '0.19.0', '0.20.0', '0.19.0x', '0.18.9']) {
    assert.notEqual(mon(`node ${parent}/${v}/lib/lead-bell.mjs`), null, v)
    assert.notEqual(bash(`node ${parent}/${v}/lib/tasks.mjs list`), null, v)
  }
  assert.notEqual(mon(`node ${parent}/0.18.7/lib/lead-bell.mjs; rm -rf x`), null, 'still the whole command')
})

test('⛔ office.json cannot say where {plugin} is: the wall block is not where the folder comes from', () => {
  const { parent, own, configDir } = cache()
  const root = mkdtempSync(join(tmpdir(), 'oa-office-'))
  const W = compileWall({ root, leadWake: 'node {plugin}/lib/lead-bell.mjs', lead: { bash: ['^ls$'] }, pluginRoot: join(parent, '0.18.9'), pluginRoots: [join(parent, '0.18.9')], configDir }, { pluginRoot: own })
  assert.notEqual(judge({ tool_name: 'Monitor', tool_input: { command: `node ${parent}/0.18.9/lib/lead-bell.mjs` }, cwd: root }, { kind: 'lead' }, root, W), null)
})

// ⛔ AN UPDATE DOES NOT MAKE A RUNNING BELL "UNARMED" (0.19.1). ERP (2026-10-23)
// armed 0.18.7's lead-bell; once 0.19.0 was installed, the watchdog looked only
// for 0.19.0's, reported "ERP doorbell unarmed" and typed it a kickoff naming a
// folder ERP's wall had never heard of.
function upgraded(bellAt) {
  const parent = mkdtempSync(join(tmpdir(), 'oa-up-'))
  const put = (v, name = 'office-anything', at = join(parent, v)) => {
    mkdirSync(join(at, '.claude-plugin'), { recursive: true }); mkdirSync(join(at, 'lib'), { recursive: true })
    writeFileSync(join(at, '.claude-plugin', 'plugin.json'), JSON.stringify({ name, version: v }))
    writeFileSync(join(at, 'lib', 'lead-bell.mjs'), '')
    return at
  }
  const old = put('0.18.7'), now = put('0.19.0')
  put('0.18.6', 'someone-else')
  symlinkSync(put('0.18.5', 'office-anything', join(mkdtempSync(join(tmpdir(), 'oa-up-away-')), 'p')), join(parent, '0.18.5'))
  const home = mkdtempSync(join(tmpdir(), 'oa-up-home-'))
  mkdirSync(join(home, '.claude', 'sessions'), { recursive: true }); mkdirSync(join(home, '.claude', 'plugins'))
  writeFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'office-anything@office-anything': [{ scope: 'user', installPath: now, version: '0.19.0' }] } }))
  const root = mkdtempSync(join(tmpdir(), 'oa-up-office-'))
  mkdirSync(join(root, 'desks', 'ledger'), { recursive: true })
  writeFileSync(join(root, 'desks', 'ledger', 'desk.json'), JSON.stringify({ name: 'ledger', kind: 'knowledge', port: 9711 }))
  writeFileSync(join(root, 'office.json'), JSON.stringify({ roleEnv: 'OFFICE_ROLE', lead: { session: 'ERP', wake: 'node {plugin}/lib/lead-bell.mjs' } }))
  const NOW = Date.now()
  writeFileSync(join(home, '.claude', 'sessions', '7201.json'), JSON.stringify({ pid: 7201, name: 'ERP', cwd: root, sessionId: '00000000-0000-4000-8000-000000007201', status: 'idle', statusUpdatedAt: NOW - 60_000, updatedAt: NOW, startedAt: NOW - 3600_000 }))
  const procs = new Map([[1, { pid: 1, ppid: 0, ageSec: 1e6, cmd: 'launchd' }], [7201, { pid: 7201, ppid: 1, ageSec: 3605, cmd: 'claude --name ERP' }], [7202, { pid: 7202, ppid: 7201, ageSec: 3500, cmd: '/bin/zsh -c x' }], [7203, { pid: 7203, ppid: 7202, ageSec: 3500, cmd: `node ${join(parent, bellAt)}/lib/lead-bell.mjs` }]])
  return { parent, old, now, home, root, procs, NOW }
}

test("⛔ upgraded 0.18.7 → 0.19.0: the lead's bell stays allowed by its wall and counted armed by health, and heal types nothing", () => {
  const u = upgraded('0.18.7')
  // the wall it started with (0.18.8 and later): the new install's bell is its own
  const W = compileWall({ root: u.root, leadWake: 'node {plugin}/lib/lead-bell.mjs' }, { pluginRoot: u.old, configDir: join(u.home, '.claude') })
  assert.equal(judge({ tool_name: 'Monitor', tool_input: { command: `node ${u.now}/lib/lead-bell.mjs` }, cwd: u.root }, { kind: 'lead' }, u.root, W), null)
  // the watchdog on the new version: the old bell still hears
  const h = officeHealth(u.root, { home: u.home, procs: u.procs, now: u.NOW, checks: false, cwd: () => null, pluginRoot: u.now })
  assert.equal(h.leads[0].doorbell.state, 'armed', h.line)
  assert.equal(h.leads[0].doorbell.version, '0.18.7')
  assert.doesNotMatch(h.line, /doorbell unarmed/)
  assert.match(h.line, /ERP doorbell runs 0\.18\.7's bell \(this is 0\.19\.0\): restart it when idle/)
  const typed = []
  const r = heal(u.root, h, { home: u.home, now: u.NOW, kill: () => {}, freshProcs: () => u.procs, cwd: () => null, terminal: { all: () => [{ handle: 't', title: '✳ ERP', agent: true, path: u.root }], titles: () => [], send: (x, t) => typed.push(t), screen: () => '❯ ' } })
  assert.deepEqual(typed, [], JSON.stringify(r.acts))
  // on the current bell: armed, and nothing to say
  const cur = upgraded('0.19.0')
  const hc = officeHealth(cur.root, { home: cur.home, procs: cur.procs, now: cur.NOW, checks: false, cwd: () => null, pluginRoot: cur.now })
  assert.equal(hc.leads[0].doorbell.state, 'armed')
  assert.equal(hc.leads[0].doorbell.version, undefined)
  assert.doesNotMatch(hc.line, /'s bell/)
})

test("⛔ a bell from another plugin, a link, or a folder that is not a version is not this lead's bell", () => {
  for (const v of ['0.18.6', '0.18.5', '0.18.7x']) {
    const u = upgraded(v)
    const h = officeHealth(u.root, { home: u.home, procs: u.procs, now: u.NOW, checks: false, cwd: () => null, pluginRoot: u.now })
    assert.equal(h.leads[0].doorbell.state, 'unarmed', v)
  }
  const u = upgraded('0.18.7')
  assert.deepEqual(bellRoots(u.now, { configDir: join(u.home, '.claude') }).map((d) => d.slice(u.parent.length + 1)).sort(), ['0.18.7', '0.19.0'])
  // a checkout finds the installed cache through what Claude Code recorded
  const repo = mkdtempSync(join(tmpdir(), 'oa-up-repo-'))
  mkdirSync(join(repo, '.claude-plugin')); writeFileSync(join(repo, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'office-anything' }))
  assert.deepEqual(bellRoots(repo, { configDir: join(u.home, '.claude') }).map((d) => d.startsWith(u.parent) ? d.slice(u.parent.length + 1) : 'repo').sort(), ['0.18.7', '0.19.0', 'repo'])
})
