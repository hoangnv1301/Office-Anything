// ⛔ ADOPTION IS A COMMIT, AND THE GATE STARTS THERE. History before the
// marker is somebody else's style: a check that lands red on three hundred
// old commits gets disabled, not obeyed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { report, checkSubject, MARKER, TYPES } from '../checks/commit-convention.mjs'

const sh = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
const repo = () => {
  const root = mkdtempSync(join(tmpdir(), 'oa-cc-'))
  sh(root, ['init', '-q'])
  sh(root, ['config', 'user.email', 'x@y.z']); sh(root, ['config', 'user.name', 'x'])
  const commit = (msg, file = 'f.txt') => {
    writeFileSync(join(root, file), msg + Math.random())
    sh(root, ['add', '.']); sh(root, ['commit', '-q', '-m', msg])
  }
  return { root, commit }
}
const adopt = (r) => { writeFileSync(join(r.root, MARKER), '{"commits":"conventional"}\n'); sh(r.root, ['add', MARKER]); sh(r.root, ['commit', '-q', '-m', 'chore: adopt conventional commits']) }

test('the subject grammar: every type, a scope, and the bang', () => {
  for (const t of TYPES) assert.ok(checkSubject(`${t}: does a thing`), t)
  assert.ok(checkSubject('feat(checks): scoped'))
  assert.ok(checkSubject('fix!: breaking'))
  assert.ok(!checkSubject('Feat: capitalized type'))
  assert.ok(!checkSubject('feat:no space'))
  assert.ok(!checkSubject('feat: '))
  assert.ok(!checkSubject('the old narrative style, which the body still welcomes'))
  assert.ok(checkSubject('Merge branch main'), 'git speaks its own subjects')
})

test('a repo without the marker is not applicable, never failed', () => {
  const r = repo(); r.commit('anything goes here')
  const out = report(r.root)
  assert.equal(out.applicable, false)
})

test('history BEFORE adoption is left alone', () => {
  const r = repo()
  r.commit('written long before anyone chose a convention')
  adopt(r)
  r.commit('feat: first typed commit')
  const out = report(r.root)
  assert.equal(out.code, 0, JSON.stringify(out))
})

test('⛔ an untyped commit AFTER adoption is a finding that names the sha', () => {
  const r = repo(); adopt(r)
  r.commit('forgot the prefix entirely')
  const out = report(r.root)
  assert.equal(out.code, 4)
  assert.equal(out.findings.length, 1)
  assert.match(out.findings[0].say, /forgot the prefix/)
})

test('a marker on disk that was never committed is UNKNOWN', () => {
  const r = repo(); r.commit('feat: something')
  writeFileSync(join(r.root, MARKER), '{"commits":"conventional"}\n')
  assert.equal(report(r.root).code, 7)
})

test('an unparseable marker is UNKNOWN, not "not adopted"', () => {
  const r = repo(); r.commit('feat: something')
  writeFileSync(join(r.root, MARKER), '{broken')
  assert.equal(report(r.root).code, 7)
})
