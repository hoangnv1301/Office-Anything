// THE NATIVE SANDBOX PER DESK (lib/sandbox.mjs). What a scratch office proved
// on Claude Code 2.1.289 is pinned here as settings: the escape hatch off, the
// network strict, other desks' runtime/ and Claude Code's folder unreadable,
// and an office under the session's temp folder refused.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { sandboxSettings, setSandbox, underSessionTmp } from '../lib/sandbox.mjs'
import { launchCommand } from '../lib/start.mjs'

function office() {
  // outside the session's TMPDIR on purpose (that folder is always writable)
  const root = realpathSync(mkdtempSync('/private/tmp/oa-sbx-test-'))
  for (const n of ['dashboard', 'customer']) {
    mkdirSync(join(root, 'desks', n, 'runtime'), { recursive: true })
    writeFileSync(join(root, 'desks', n, 'desk.json'), JSON.stringify({ name: n, kind: 'knowledge', port: 9990 + n.length, ...(n === 'dashboard' ? { hosts: ['api.example.org'] } : {}) }))
  }
  mkdirSync(join(root, 'desks', 'runtime'), { recursive: true })
  writeFileSync(join(root, 'office.json'), JSON.stringify({ sandbox: { hosts: ['sheets.example.com'] } }))
  return root
}

test('a desk\'s sandbox: hatch off, strict network, writes in its folder, no other desk\'s runtime, Claude Code\'s folder closed but its own tree', () => {
  const root = office()
  const s = sandboxSettings(root, 'dashboard').sandbox
  assert.equal(s.enabled, true)
  assert.equal(s.allowUnsandboxedCommands, false, 'the escape hatch is real by default')
  assert.equal(s.failIfUnavailable, true)
  assert.equal(s.network.strictAllowlist, true, 'without it curl got through the proxy')
  assert.deepEqual(s.network.allowedDomains, ['localhost', '127.0.0.1', 'sheets.example.com', 'api.example.org'])
  assert.ok(s.filesystem.allowWrite.includes(join(root, 'desks', 'dashboard')))
  assert.ok(s.filesystem.denyRead.includes(join(root, 'desks', 'customer', 'runtime')))
  assert.ok(s.filesystem.denyRead.includes(join(root, 'desks', 'runtime')), 'a shared runtime folder (the lead\'s token) is closed too')
  assert.ok(!s.filesystem.denyRead.includes(join(root, 'desks', 'dashboard', 'runtime')), 'the desk reads its own token')
  assert.ok(s.filesystem.denyRead.includes(join(homedir(), '.claude')))
  assert.ok(s.filesystem.allowRead.some((p) => p.endsWith(join('projects', join(root, 'desks', 'dashboard').replace(/[^A-Za-z0-9]/g, '-')))))
})

test('an office under the session\'s temp folder is refused: every sandboxed session may write there', () => {
  const inTmp = realpathSync(mkdtempSync(join(tmpdir(), 'oa-sbx-in-tmp-')))
  mkdirSync(join(inTmp, 'desks', 'd'), { recursive: true })
  writeFileSync(join(inTmp, 'desks', 'd', 'desk.json'), JSON.stringify({ name: 'd', kind: 'knowledge', port: 9999 }))
  assert.equal(underSessionTmp(inTmp), true)
  assert.throws(() => sandboxSettings(inTmp, 'd'), /temp folder/)
})

test('opt-in and rollback: on/off flip desk.json; a sandboxed desk starts with --settings, others do not', () => {
  const root = office()
  setSandbox(root, 'dashboard', true)
  assert.equal(JSON.parse(readFileSync(join(root, 'desks', 'dashboard', 'desk.json'), 'utf8')).sandbox, true)
  const t = { name: 'dashboard', tag: 'desk-dashboard', isLead: false, dir: join(root, 'desks', 'dashboard'), sandboxFile: join(root, '.office', 'sandbox', 'dashboard.json') }
  assert.match(launchCommand({ cfg: {}, target: t }), /--settings '.*\/\.office\/sandbox\/dashboard\.json'/)
  assert.doesNotMatch(launchCommand({ cfg: {}, target: { ...t, sandboxFile: undefined } }), /--settings/)
  assert.match(setSandbox(root, 'dashboard', false), /sandbox off.*\/desk-start dashboard/)
  assert.equal(JSON.parse(readFileSync(join(root, 'desks', 'dashboard', 'desk.json'), 'utf8')).sandbox, false)
})

test('a sandboxed desk is told what "Operation not permitted" means, so it does not loop', async () => {
  const { bootLines } = await import('../hooks/desk-boot.mjs')
  const root = office()
  setSandbox(root, 'dashboard', true)
  const lines = bootLines(root, { kind: 'desk', desk: 'dashboard', dir: join(root, 'desks', 'dashboard') }, { boot: {} }, join(root, 'desks', 'dashboard'))
  assert.ok(lines.some((l) => /sandbox.*Operation not permitted.*do not retry/.test(l)))
})
