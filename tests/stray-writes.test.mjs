import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { report } from '../checks/stray-writes.mjs'
import { hire } from '../lib/hire.mjs'

// ⛔ The promise of a trial desk is that firing it is a real uninstall. That promise is
// worth exactly what your ability to check it is worth. These test the checking.

function trial(installed, litterAt = null) {
  const root = mkdtempSync(join(tmpdir(), 'oa-trial-'))
  hire(root, { name: 'probe', kind: 'knowledge', description: 'trying a library out' })
  const f = join(root, 'desks', 'probe', 'desk.json')
  const j = JSON.parse(readFileSync(f, 'utf8')); j.installed = installed
  writeFileSync(f, JSON.stringify(j))
  mkdirSync(join(root, 'desks', 'probe', 'vendor'), { recursive: true })
  writeFileSync(join(root, 'desks', 'probe', 'vendor', `${installed[0]}.js`), 'x')
  if (litterAt) {
    mkdirSync(join(root, litterAt), { recursive: true })
    writeFileSync(join(root, litterAt, `${installed[0]}.rc`), 'x')
  }
  return root
}
const clean = (r) => rmSync(r, { recursive: true, force: true })

test('a trial that stays inside its desk is clean', () => {
  const root = trial(['cool-lib'])
  assert.equal(report(root).code, 0)
  clean(root)
})

test('⛔ a trial that litters the project root is CAUGHT', () => {
  const root = trial(['cool-lib'], 'config')
  const r = report(root)
  assert.equal(r.code, 4, 'firing the desk will not remove this, so you need to know now')
  assert.match(r.findings[0].at, /config/)
  clean(root)
})

test('a desk that installed nothing is not something to complain about', () => {
  const root = mkdtempSync(join(tmpdir(), 'oa-trial-'))
  hire(root, { name: 'plain', kind: 'knowledge', description: 'just a normal desk' })
  const r = report(root)
  assert.equal(r.code, 0)
  assert.match(r.why, /none of them installed anything/)
  clean(root)
})

test('⛔ no desks/ is NOT APPLICABLE, and an empty desks/ is UNKNOWN', () => {
  const bare = mkdtempSync(join(tmpdir(), 'oa-trial-'))
  assert.equal(report(bare).applicable, false)
  mkdirSync(join(bare, 'desks'), { recursive: true })
  assert.equal(report(bare).code, 7, 'a walk that examined nothing has not passed')
  clean(bare)
})
