// ⛔ A WRONG DOLLAR IS WORSE THAN A TOKEN COUNT. The math has one owner and
// these numbers are checked against the reference table (as-of 2026-06-24).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { costOf, ratesFor, AS_OF } from '../lib/rates.mjs'

test('opus 5 arithmetic, to the cent', () => {
  const c = costOf({ model: 'claude-opus-5', input: 1_000_000, output: 200_000, cacheRead: 10_000_000, cacheWrite: 400_000 })
  assert.equal(c.input.toFixed(2), '5.00')
  assert.equal(c.output.toFixed(2), '5.00')          // 0.2M × $25
  assert.equal(c.cacheRead.toFixed(2), '5.00')       // 10M × $0.50
  assert.equal(c.cacheWrite.toFixed(2), '2.50')      // 0.4M × $5 × 1.25
})

test('cache write is 1.25x the input rate', () => {
  const c = costOf({ model: 'claude-sonnet-5', cacheWrite: 1_000_000 })
  assert.equal(c.cacheWrite.toFixed(2), '2.50')      // $2 × 1.25
})

test('⛔ an unknown model gets NO dollars, never a guess', () => {
  assert.equal(costOf({ model: 'claude-next-9', input: 5_000_000 }), null)
  assert.equal(ratesFor('gpt-4o'), null)
})

test('the as-of date rides every cost object', () => {
  assert.equal(costOf({ model: 'claude-haiku-4-5', input: 1 }).asOf, AS_OF)
})
