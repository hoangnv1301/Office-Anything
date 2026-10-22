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
import { compileWall, judge, pluginRoots } from '../lib/wall.mjs'

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
