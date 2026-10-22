// A PLUGIN UPDATE DOES NOT STRAND A RUNNING SESSION (0.18.8). A session keeps
// the hooks it started with: ERP (2026-10-23), started on 0.18.4, was told to
// run its 0.18.7 doorbell and its 0.18.4 wall refused the new folder, so it ran
// the old bell until it was restarted. {plugin} is now this version's folder or
// a NEWER one installed beside it that really is this plugin.
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
  mkdirSync(join(parent, 'latest'))
  put('0.19.0x')   // this plugin, in a folder that is not a version
  return { parent, own }
}

test('⛔ {plugin} is this version or a newer real install of this plugin beside it; never older, another plugin, or a link', () => {
  const { parent, own } = cache()
  assert.deepEqual(pluginRoots(own).map((d) => d.slice(parent.length + 1)).sort(), ['0.18.10', '0.18.4', '0.18.7'])
  // a checkout, not a version folder: only itself
  const repo = mkdtempSync(join(tmpdir(), 'oa-repo-'))
  assert.deepEqual(pluginRoots(repo), [repo])
})

test('⛔ a session on an older wall runs its doorbell and its listed commands from a newer install', () => {
  const { parent, own } = cache()
  const root = mkdtempSync(join(tmpdir(), 'oa-office-'))
  const W = compileWall({ root, pluginRoot: own, leadWake: 'node {plugin}/lib/lead-bell.mjs', lead: { bash: ['^node {plugin}/lib/tasks\\.mjs list$'] } })
  const mon = (c) => judge({ tool_name: 'Monitor', tool_input: { command: c }, cwd: root }, { kind: 'lead' }, root, W)
  const bash = (c) => judge({ tool_name: 'Bash', tool_input: { command: c }, cwd: root }, { kind: 'lead' }, root, W)
  assert.equal(mon(`node ${own}/lib/lead-bell.mjs`), null, 'its own version')
  assert.equal(mon(`node ${parent}/0.18.7/lib/lead-bell.mjs`), null, 'the update it was told to run')
  assert.equal(bash(`node ${parent}/0.18.10/lib/tasks.mjs list`), null)
  for (const v of ['0.18.1', '0.19.0', '0.20.0', 'latest', '0.19.0x']) {
    assert.notEqual(mon(`node ${parent}/${v}/lib/lead-bell.mjs`), null, v)
    assert.notEqual(bash(`node ${parent}/${v}/lib/tasks.mjs list`), null, v)
  }
  assert.notEqual(mon(`node ${parent}/0.18.7/lib/lead-bell.mjs; rm -rf x`), null, 'still the whole command')
})
