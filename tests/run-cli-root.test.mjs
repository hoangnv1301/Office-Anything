// ⛔ THE CLI MUST AUDIT THE REPO IT WAS POINTED AT, NOT THE ONE IT STANDS IN.
//
// collect(root) always took a root and the CLI never passed one, so
// `node checks/run.mjs /some/repo` silently audited process.cwd() and printed
// a clean board about the wrong codebase. Found 2026-09-02 from the first repo
// to adopt the contract: pointed at it from a temp directory, the board
// described the temp directory. The README sells auditing "a repo you did not
// write", and that was the one thing the CLI could not do.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const RUN = join(dirname(fileURLToPath(import.meta.url)), '..', 'checks', 'run.mjs')

const cli = (args, cwd) => {
  try { return { out: execFileSync(process.execPath, [RUN, ...args], { cwd, encoding: 'utf8' }), code: 0 } }
  catch (e) { return { out: `${e.stdout ?? ''}${e.stderr ?? ''}`, code: e.status } }
}

test('⛔ THE REGRESSION: an explicit root is audited, not the cwd', () => {
  // Stand in an EMPTY temp dir; point at a repo holding one readable desk.
  // Before the fix this reported "no desks yet" about the temp dir and exited 0.
  const stand = mkdtempSync(join(tmpdir(), 'oa-stand-'))
  const target = mkdtempSync(join(tmpdir(), 'oa-target-'))
  mkdirSync(join(target, 'desks', 'billing'), { recursive: true })
  writeFileSync(join(target, 'desks', 'billing', 'desk.json'),
    JSON.stringify({ name: 'billing', kind: 'knowledge', port: 9231, live: false }))
  const r = cli([target], stand)
  assert.match(r.out, /1 desk/, `the target's one desk was not seen:\n${r.out}`)
  assert.equal(r.code, 0)
})

test('a missing root REFUSES rather than answering about the cwd', () => {
  // Falling back to cwd on a bad argument is the same bug with politeness:
  // you asked about X, it answered about Y.
  const stand = mkdtempSync(join(tmpdir(), 'oa-stand-'))
  const r = cli(['/no/such/place/at/all'], stand)
  assert.equal(r.code, 7, 'a path that does not exist is UNKNOWN, never a clean cwd report')
  assert.match(r.out, /no such directory/i)
})

test('no argument still means the cwd, which is the documented default', () => {
  const empty = mkdtempSync(join(tmpdir(), 'oa-empty-'))
  const r = cli([], empty)
  assert.equal(r.code, 0)
  assert.match(r.out, /nothing applied yet/i)
})
