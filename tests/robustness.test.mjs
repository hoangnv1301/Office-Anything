import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
