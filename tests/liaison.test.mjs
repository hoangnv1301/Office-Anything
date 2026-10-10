// THE LIAISON KIND (2026-10-10, the lead's ruling for local-cabinets-ops): a desk
// that talks to the TEAM on a channel (coworkers, partners), never to customers.
// It was refused by readDesk as "not one of channel, knowledge, lead", which made
// desk health call a working desk unreadable and stop watching it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KINDS, ISSUE, readDesk, mayHold } from '../lib/desk.mjs'
import { inferKind, agreeOnKind } from '../lib/hire.mjs'

const GATE = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'send-wall-gate.mjs')
const deskAt = (kind, live) => {
  const root = mkdtempSync(join(tmpdir(), 'oa-liaison-'))
  mkdirSync(join(root, 'desks', 'd'), { recursive: true })
  writeFileSync(join(root, 'desks', 'd', 'desk.json'), JSON.stringify({ name: 'd', kind, port: 9300, live }))
  return root
}
const gate = (root) => {
  try { execFileSync('node', [GATE], { input: JSON.stringify({ tool_input: { file_path: join(root, 'desks', 'd', 'runtime', 'send', 'post.mjs') } }), stdio: 'pipe' }); return 0 }
  catch (e) { return e.status }
}

test('liaison is a kind, and a liaison desk.json loads', () => {
  assert.ok(KINDS.includes('liaison'))
  assert.equal(readDesk(join(deskAt('liaison', false), 'desks', 'd')).kind, 'liaison')
})

test('a liaison desk sends only when live, like a channel desk', () => {
  assert.equal(ISSUE.liaison.sender, 'only when live')
  assert.equal(gate(deskAt('liaison', false)), 2, 'a dark liaison desk gets no sender')
  assert.equal(gate(deskAt('liaison', true)), 0)
})

test('the gate reads the issue table: every kind never issued a sender is blocked, the lead included', () => {
  // the gate named knowledge and channel by hand; a lead desk walked through it
  for (const k of KINDS) if (mayHold(k, 'sender') === false) assert.equal(gate(deskAt(k, true)), 2, k)
})

test('the second reader knows a team-channel desk when it reads one', () => {
  const d = 'Team liaison desk: the office teammate on the owner Discord team channel; asks coworkers and partners short questions'
  assert.equal(inferKind(d).kind, 'liaison')
  assert.equal(agreeOnKind('liaison', d).ok, true)
  // and a customer-facing description is still not a liaison
  assert.equal(agreeOnKind('liaison', 'answers customer messages and replies to buyers in the inbox').ok, false)
})
