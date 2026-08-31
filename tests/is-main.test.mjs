import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { isMain } from '../lib/is-main.mjs'

// ⛔ THIS TEST EXISTS BECAUSE THE NAIVE VERSION SHIPPED AND FAILED SILENTLY.
// `import.meta.url === \`file://${process.argv[1]}\`` is wrong on any path with a space:
// the URL percent-encodes it, the raw argv does not, so the CLI block never runs and the
// script exits 0 having printed nothing. Every caller reads that as success.

const SPACED = '/Volumes/Extreme SSD/kit/checks/run.mjs'

test('⛔ a path with a space still matches itself', () => {
  assert.equal(isMain(pathToFileURL(SPACED).href, SPACED), true,
    'this is the exact case that shipped broken: "Extreme SSD" -> "Extreme%20SSD"')
})

test('⛔ and the naive comparison is proven wrong on that same path', () => {
  assert.notEqual(pathToFileURL(SPACED).href, `file://${SPACED}`,
    'if these were equal the bug would not exist and this guard would be pointless')
})

test('a plain path matches', () => {
  const p = '/tmp/kit/run.mjs'
  assert.equal(isMain(pathToFileURL(p).href, p), true)
})

test('a different file does not match', () => {
  assert.equal(isMain(pathToFileURL('/tmp/a.mjs').href, '/tmp/b.mjs'), false)
})

test('⛔ imported with no argv (a worker, a REPL) is NOT main', () => {
  assert.equal(isMain('file:///tmp/a.mjs', undefined), false,
    'undefined argv must not throw and must not read as "yes, run the CLI"')
})
