import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { report } from '../checks/send-wall.mjs'
import { portCollisions, nextFreePort, readDesk } from '../lib/desk.mjs'

// ⛔ A TEST THAT HAS NEVER FAILED HAS NEVER BEEN CHECKED. Every case below builds a
// world where the guarantee is BROKEN and asserts the check notices. Asserting only
// that a correct tree passes proves nothing: a check that returns 0 unconditionally
// passes that test too.

function world(desks) {
  const root = mkdtempSync(join(tmpdir(), 'remit-'))
  for (const d of desks) {
    const dir = join(root, 'desks', d.name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'desk.json'), JSON.stringify({ ...d, sender: undefined }))
    if (d.sender) {
      const sub = join(dir, 'runtime', d.sender)
      mkdirSync(sub, { recursive: true })
      writeFileSync(join(sub, 'send.mjs'), '// a way out')
    }
  }
  return root
}
const clean = (r) => rmSync(r, { recursive: true, force: true })

test('an install with no desks/ is NOT APPLICABLE, and is never reported as a pass', () => {
  const root = mkdtempSync(join(tmpdir(), 'remit-'))
  const r = report(root)
  assert.equal(r.applicable, false, 'a check with nothing to guard must say so')
  assert.equal(r.code, 0, 'and must not block anyone')
  clean(root)
})

test('⛔ a desks/ directory holding nothing is UNKNOWN, never clean', () => {
  const root = mkdtempSync(join(tmpdir(), 'remit-'))
  mkdirSync(join(root, 'desks'), { recursive: true })
  const r = report(root)
  assert.equal(r.code, 7, 'an empty walk has not passed, it has failed to look')
  clean(root)
})

test('⛔ a knowledge desk with a sender FAILS', () => {
  const root = world([{ name: 'pricing', kind: 'knowledge', port: 9223, sender: 'send' }])
  const r = report(root)
  assert.equal(r.code, 4)
  assert.match(r.findings[0].say, /never issued one/)
  clean(root)
})

test('⛔ and it fails through relay/ too, not only send/', () => {
  const root = world([{ name: 'pricing', kind: 'knowledge', port: 9223, sender: 'relay' }])
  assert.equal(report(root).code, 4, 'a second transport is still a way out')
  clean(root)
})

test('⛔ THE OTHER DIRECTION: a LIVE channel desk with no sender FAILS', () => {
  const root = world([{ name: 'chat', kind: 'channel', port: 9224, live: true }])
  const r = report(root)
  assert.equal(r.code, 4, 'a live desk that cannot reply means someone is being ignored')
  assert.match(r.findings[0].say, /being ignored/)
  clean(root)
})

test('a dark channel desk that grew a sender FAILS', () => {
  const root = world([{ name: 'chat', kind: 'channel', port: 9224, live: false, sender: 'send' }])
  assert.equal(report(root).code, 4, 'going live must be a reviewed edit, not a file appearing')
  clean(root)
})

test('a correct team passes: dark channel with no sender, live channel with one', () => {
  const root = world([
    { name: 'chat', kind: 'channel', port: 9224, live: true, sender: 'send' },
    { name: 'mail', kind: 'channel', port: 9225, live: false },
    { name: 'pricing', kind: 'knowledge', port: 9226 },
  ])
  const r = report(root)
  assert.equal(r.code, 0, r.findings ? JSON.stringify(r.findings) : '')
  clean(root)
})

// ── the contract itself ──────────────────────────────────────────────────────

test('⛔ two desks claiming one port is a NAMED failure', () => {
  const c = portCollisions([
    { name: 'billing', port: 9231 }, { name: 'support', port: 9231 },
  ])
  assert.equal(c.length, 1)
  assert.deepEqual(c[0].desks, ['billing', 'support'], 'both desks must be named, not just the port')
})

test('hiring and firing never renumber anyone, because ports are declared', () => {
  const before = [{ name: 'chat', port: 9223 }, { name: 'pricing', port: 9224 }]
  const p = nextFreePort(before)
  assert.equal(p, 9225)
  // "billing" sorts BEFORE both. Under index-based allocation this is exactly the bug.
  const after = [...before, { name: 'billing', port: p }]
  for (const d of before) {
    assert.equal(after.find(x => x.name === d.name).port, d.port,
      `${d.name} moved when billing was hired. That is the defect this contract exists to remove.`)
  }
})

test('⛔ a malformed desk.json throws, and is never a silently skipped desk', () => {
  const root = mkdtempSync(join(tmpdir(), 'remit-'))
  const dir = join(root, 'desks', 'broken')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'desk.json'), '{ "name": "broken", "kind": "channel" }')   // no port
  assert.throws(() => readDesk(dir), /has no "port"/,
    'a desk that fails to load is a desk every check reports clean on')
  clean(root)
})
