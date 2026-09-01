import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hire } from '../lib/hire.mjs'
import { fire } from '../lib/fire.mjs'
import { rosterSafe } from '../lib/desk.mjs'
import { report as deskReadable } from '../checks/desk-readable.mjs'
import { report as sendWall } from '../checks/send-wall.mjs'

// ⛔ EVERY CASE HERE IS A REAL FAULT FOUND BY USING THE PLUGIN, NOT BY READING IT.
// Each one shipped, each was found by hiring desks and trying to break them.

const fresh = () => mkdtempSync(join(tmpdir(), 'oa-rb-'))
const clean = (r) => rmSync(r, { recursive: true, force: true })
const badDesk = (root, folder, json) => {
  mkdirSync(join(root, 'desks', folder), { recursive: true })
  writeFileSync(join(root, 'desks', folder, 'desk.json'), JSON.stringify(json))
}

test('⛔ a 200-character desk name is refused', () => {
  const root = fresh()
  assert.throws(() => hire(root, { name: 'a'.repeat(200), kind: 'knowledge' }), /40 characters at most/,
    'a name goes into a path, a port map and a docs table; 200 breaks all three')
  assert.doesNotThrow(() => hire(root, { name: 'a'.repeat(40), kind: 'knowledge' }), 'and 40 is still fine')
  clean(root)
})

test('⛔ firing the same name twice in a day NEVER overwrites the first archive', () => {
  const root = fresh()
  for (let i = 0; i < 3; i++) {
    hire(root, { name: 'probe', kind: 'knowledge' })
    fire(root, 'probe', { reason: 'removing this desk again for the test', date: '2026-09-01' })
  }
  const kept = readdirSync(join(root, 'bk'))
  assert.equal(kept.length, 3,
    'an archive is the only copy of a desk that ever existed. Overwriting one is a deletion.')
  clean(root)
})

test('⛔ desk.json and its folder must agree on the name', () => {
  const root = fresh()
  badDesk(root, 'renamed', { name: 'OLDNAME', kind: 'knowledge', port: 9227 })
  const { broken } = rosterSafe(join(root, 'desks'))
  assert.equal(broken.length, 1, 'two statements of one fact that disagree')
  assert.match(broken[0].why, /says "OLDNAME" but sits in a folder called "renamed"/)
  clean(root)
})

test('⛔ ONE broken desk does not blind the checks against the healthy ones', () => {
  const root = fresh()
  hire(root, { name: 'support', kind: 'channel' })
  hire(root, { name: 'pricing', kind: 'knowledge' })
  badDesk(root, 'broken', { name: 'broken', kind: 'knowledge', port: '9226' })   // port as string

  assert.equal(deskReadable(root).code, 4, 'the broken one is named')
  const w = sendWall(root)
  assert.equal(w.code, 0, 'and the two healthy desks were still examined')
  assert.match(w.why, /2 desk/)
  clean(root)
})

test('⛔ ONE fault produces ONE finding, not one per check', () => {
  const root = fresh()
  hire(root, { name: 'support', kind: 'channel' })
  badDesk(root, 'broken', { name: 'broken', kind: 'knowledge', port: '9226' })
  // send-wall must stay silent about it: desk-readable owns that finding.
  const w = sendWall(root)
  assert.ok(!JSON.stringify(w.findings ?? []).includes('port must be an integer'),
    'a fault reported by four checks is how a board stops being read')
  clean(root)
})

test('⛔ two desks claiming one port is caught and BOTH are named', () => {
  const root = fresh()
  badDesk(root, 'a', { name: 'a', kind: 'knowledge', port: 9223 })
  badDesk(root, 'b', { name: 'b', kind: 'knowledge', port: 9223 })
  const r = deskReadable(root)
  assert.equal(r.code, 4)
  assert.match(r.findings[0].desk, /a and b/, 'naming one of them leaves you hunting for the other')
  clean(root)
})

test('findings carry paths relative to the project, not absolute ones', () => {
  const root = fresh()
  badDesk(root, 'broken', { name: 'broken', kind: 'knowledge', port: '9226' })
  const r = deskReadable(root)
  assert.ok(!r.findings[0].say.includes(root), 'an absolute temp path wraps three lines and hides the point')
  assert.match(r.findings[0].say, /^desks\/broken/)
  clean(root)
})

test('⛔ an empty desks/ produces ONE unknown across the whole run, not one per check', async () => {
  const { collect } = await import('../checks/run.mjs')
  const root = fresh()
  mkdirSync(join(root, 'desks'), { recursive: true })
  const r = collect(root)
  assert.equal(r.unknown.length, 1, 'four checks saying one thing is how a board stops being read')
  assert.equal(r.unknown[0].name, 'desk-readable', 'and the one that says it owns the question')
  clean(root)
})

test('⛔ the board column is derived from the longest name, not a literal', async () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'checks', 'run.mjs'), 'utf8')
  // ⛔ STRIP COMMENTS FIRST. The first version of this test failed on the COMMENT that
  // explains the fix, which cites the old padEnd(12) and padEnd(14) as prose. A matcher
  // that cannot tell code from an explanation of code will fire on every file that
  // documents the thing it forbids.
  const code = src.split('\n').filter(l => !l.trimStart().startsWith('//')).join('\n')
  assert.doesNotMatch(code, /padEnd\(\d+\)/,
    'a hardcoded width breaks silently the day somebody adds a longer check name, and it has twice')
  assert.match(src, /Math\.max\(\.\.\.r\.rows\.map/)
})

// ⛔ FOUND BY SWEEPING EVERY CHECK ACROSS SIX WORLDS. Firing your last desk leaves an empty
// desks/, and the board answered "nothing was examined" — an alarm, at somebody who had just
// followed the tool's own instructions. A check that reads as a fault when you did the right
// thing is a check you learn to ignore, and the next one is real.
//
// The VERDICT does not change: an empty walk is still UNKNOWN, because a hire that failed
// halfway leaves exactly this state too. Only the explanation changes.
test('⛔ firing the last desk is still UNKNOWN, but the message says it looks deliberate', async () => {
  const { report } = await import('../checks/desk-readable.mjs')
  const root = fresh()
  hire(root, { name: 'gone', kind: 'knowledge' })
  fire(root, 'gone', { reason: 'the last desk in this office goes', date: '2026-09-01' })
  const r = report(root)
  assert.equal(r.code, 7, 'an empty walk has not passed, and that rule does not bend')
  assert.match(r.why, /archived in bk\/.*deliberate/, 'but it must not read as breakage')
  clean(root)
})

test('an empty desks/ with no archives still reads as unexplained', async () => {
  const { report } = await import('../checks/desk-readable.mjs')
  const root = fresh()
  mkdirSync(join(root, 'desks'), { recursive: true })
  assert.match(report(root).why, /nothing was examined/, 'no archives means nothing explains the emptiness')
  clean(root)
})
