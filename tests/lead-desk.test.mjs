// ⛔ A KIND WITH NOWHERE TO LIVE IS A HOLE IN THE CONTRACT. "lead" existed in
// ISSUE from the start while roster() walked only desks/ — so the one real
// deployment's lead sat outside every check and the board could not mirror
// its browser. leadDesk() is the home; these pin its rules.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { leadDesk } from '../lib/desk.mjs'

const world = (json) => {
  const root = mkdtempSync(join(tmpdir(), 'oa-lead-'))
  if (json !== undefined) writeFileSync(join(root, 'desk.json'), json)
  return root
}

test('no root desk.json means no lead declared, quietly', () => {
  assert.equal(leadDesk(world()), null)
})

test('a lead at the root declares its port, folder name waived', () => {
  const d = leadDesk(world(JSON.stringify({ name: 'team-lead', kind: 'lead', port: 9229 })))
  assert.equal(d.name, 'team-lead')
  assert.equal(d.port, 9229)
  assert.equal(d.live, false, 'a lead is never live; absent means false')
})

test('⛔ a root desk.json of any other kind is refused loudly', () => {
  assert.throws(() => leadDesk(world(JSON.stringify({ name: 'x', kind: 'channel', port: 9231 }))), /must be kind "lead"/)
})

test('a broken root desk.json is an error, never a silent null', () => {
  assert.throws(() => leadDesk(world('{nope')), /not valid JSON/)
})
