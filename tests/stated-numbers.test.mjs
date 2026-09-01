import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { report, realTestCount, STATED } from '../checks/stated-numbers.mjs'

const REAL_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const clean = (r) => rmSync(r, { recursive: true, force: true })

function world(counts) {
  const root = mkdtempSync(join(tmpdir(), 'oa-num-'))
  mkdirSync(join(root, 'tests'), { recursive: true })
  writeFileSync(join(root, 'tests', 'a.test.mjs'), "test('one', () => {})\ntest('two', () => {})\n")
  writeFileSync(join(root, 'README.md'), `<img src="https://img.shields.io/badge/tests-${counts.readme}%20passing-3fb950">`)
  writeFileSync(join(root, 'CLAUDE.md'), `node --test "tests/**/*.test.mjs"  # ${counts.claude} tests`)
  return root
}

test('counts tests by counting them, not by trusting a number', () => {
  const root = world({ readme: 2, claude: 2 })
  assert.equal(realTestCount(root), 2)
  clean(root)
})

test('agreement across every stated place passes', () => {
  const root = world({ readme: 2, claude: 2 })
  assert.equal(report(root).code, 0)
  clean(root)
})

test('⛔ ONE stale number out of several is caught, and the file is NAMED', () => {
  const root = world({ readme: 99, claude: 2 })
  const r = report(root)
  assert.equal(r.code, 4)
  assert.equal(r.findings[0].desk, 'README.md', 'naming the count without the file leaves you grepping')
  assert.match(r.findings[0].say, /says 99 tests, there are 2/)
  clean(root)
})

// ⚠️ This used to assert UNKNOWN for a project that states no count. The clean-room run
// showed that was wrong: a project claiming no number has nothing to be wrong ABOUT, so it
// is NOT APPLICABLE. UNKNOWN means "I looked and could not tell", and there was nothing to
// look at. The UNKNOWN case that remains is a project that DOES state a count while having
// no tests to count, which is a genuine contradiction.
test('⛔ stating a count while having no tests to count IS a contradiction', () => {
  const root = mkdtempSync(join(tmpdir(), 'oa-num-'))
  mkdirSync(join(root, 'tests'), { recursive: true })
  writeFileSync(join(root, 'tests', 'a.test.mjs'), '// no tests defined here at all\n')
  writeFileSync(join(root, 'CLAUDE.md'), 'node --test "tests/**/*.test.mjs"  # 5 tests')
  assert.equal(report(root).code, 7, 'it claims five and defines none')
  clean(root)
})

test('no tests/ directory is not applicable', () => {
  const bare = mkdtempSync(join(tmpdir(), 'oa-num-'))
  assert.equal(report(bare).applicable, false)
  clean(bare)
})

// ⛔ THE ONE THAT MATTERS: it must be true of THIS repo, right now, every run.
test('⛔ this project\'s own stated counts are all correct', () => {
  const r = report(REAL_ROOT)
  assert.equal(r.code, 0, r.findings ? JSON.stringify(r.findings) : '')
  assert.ok(STATED.length >= 3, 'every surface that states the number must be listed')
})

// ⛔ FOUND BY CLEAN-ROOM: cloning the public repo, installing it, and hiring a desk in a
// FRESH project. `hire` creates tests/desks/, so "there is a tests/ directory" was true in
// every project using this plugin, and every one of them got a permanent amber row about a
// test count they had never stated.
//
// A check that the person seeing it cannot possibly satisfy is worse than no check. It
// teaches them amber means nothing, and the next amber row is a real one.
test('⛔ a project that USES the plugin is not asked about its test count', () => {
  const root = mkdtempSync(join(tmpdir(), 'oa-num-'))
  mkdirSync(join(root, 'tests', 'desks'), { recursive: true })   // exactly what hire() creates
  mkdirSync(join(root, 'desks'), { recursive: true })
  const r = report(root)
  assert.equal(r.applicable, false, 'this question belongs to a repo describing itself')
  assert.doesNotMatch(r.why, /no tests\/ directory/, 'and the reason must be true: there IS one')
})

test('a repo with tests but no stated count is also not asked', () => {
  const root = mkdtempSync(join(tmpdir(), 'oa-num-'))
  mkdirSync(join(root, 'tests'), { recursive: true })
  writeFileSync(join(root, 'tests', 'a.test.mjs'), "test('one', () => {})\n")
  assert.equal(report(root).applicable, false, 'nothing claims a number, so there is nothing to disagree with')
})
