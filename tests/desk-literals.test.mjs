// ⛔ THE RATCHET MUST EQUAL THE MEASUREMENT, IN BOTH DIRECTIONS.
//
// Growth spends what somebody else saved; an unbanked improvement is a loose
// ratchet, and a loose ratchet is a dead letter with a filename. Both are
// findings on purpose.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { report, measure, RATCHET } from '../checks/desk-literals.mjs'

const world = ({ testSrc = '', ratchet = undefined } = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'oa-lit-'))
  mkdirSync(join(root, 'desks', 'billing'), { recursive: true })
  writeFileSync(join(root, 'desks', 'billing', 'desk.json'),
    JSON.stringify({ name: 'billing', kind: 'knowledge', port: 9231, live: false }))
  mkdirSync(join(root, 'tests'))
  writeFileSync(join(root, 'tests', 'a.test.mjs'), testSrc)
  if (ratchet !== undefined) writeFileSync(join(root, RATCHET), JSON.stringify(ratchet))
  return root
}

test('a clean suite with no ratchet has nothing to pin', () => {
  const r = report(world({ testSrc: "import x from './x.mjs'\n" }))
  assert.equal(r.code, 0)
  assert.match(r.why, /nothing to pin/i)
})

test('literals with no ratchet INVITE adoption rather than ambushing', () => {
  const r = report(world({ testSrc: "const d = 'billing'\n" }))
  assert.equal(r.code, 0, 'a repo that has not adopted must not be failed')
  assert.match(r.why, /write tests\/desk-literals\.json/i)
})

test('a comment naming a desk is not a literal. Comments do not break', () => {
  const r = report(world({ testSrc: "// retired like 'billing' was\nconst x = 1\n", ratchet: { files: {} } }))
  assert.equal(r.code, 0)
})

test('pinned equal to measured is clean', () => {
  const r = report(world({ testSrc: "const d = 'billing'\n", ratchet: { files: { 'tests/a.test.mjs': 1 } } }))
  assert.equal(r.code, 0)
})

test('⛔ growth over the pin is a finding', () => {
  const r = report(world({ testSrc: "const d = 'billing'; const e = 'billing'\n", ratchet: { files: { 'tests/a.test.mjs': 1 } } }))
  assert.equal(r.code, 4)
  assert.match(r.findings[0].say, /grew/)
})

test('⛔ an unbanked improvement is a finding too, or the ratchet goes loose', () => {
  const r = report(world({ testSrc: "const d = 'billing'\n", ratchet: { files: { 'tests/a.test.mjs': 3 } } }))
  assert.equal(r.code, 4)
  assert.match(r.findings[0].say, /bank it/i)
})

test('a NEW offender not in the ratchet is a finding', () => {
  const r = report(world({ testSrc: "const d = 'billing'\n", ratchet: { files: {} } }))
  assert.equal(r.code, 4)
  assert.match(r.findings[0].say, /NEW/)
})

test('a stale row for a file now clean is a finding', () => {
  const r = report(world({ testSrc: 'const x = 1\n', ratchet: { files: { 'tests/gone.test.mjs': 2 } } }))
  assert.equal(r.code, 4)
  assert.match(r.findings[0].say, /stale ratchet|now clean/i)
})

test('an unreadable ratchet is UNKNOWN, never clean', () => {
  const root = world({ testSrc: "const d = 'billing'\n" })
  writeFileSync(join(root, RATCHET), '{not json')
  assert.equal(report(root).code, 7)
})

test('measure sees quoted names and quoted desk paths, nothing else', () => {
  const root = world({ testSrc: "join(ROOT, 'desks/billing/state')\nconst d = 'billing'\nconst notit = 'billingham'\n" })
  assert.deepEqual(measure(root, ['billing']), { 'tests/a.test.mjs': 2 })
})
