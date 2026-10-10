// GAPS FOUND WHILE AN OFFICE ADOPTED THE WALL (local-cabinets-ops, 2026-10-10).
// (a) a desk could not message `lead`: a recipient name had to be a session
//     identity, which would wall the repo-root developer session called lead
// (b) a desk session resumed at the root, its office module missing, got
//     through: the session's name was read only after the module loaded
// (c) an alias() that throws or hangs refused EVERY named session, the lead
//     and a developer included: nobody could repair the office
// (d) the module's worker ran for every named session on every call
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'desk-wall.mjs')
function office(wall, module = null) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'oa-adopt-')))
  for (const n of ['inventory', 'support']) {
    mkdirSync(join(root, 'desks', n, 'runtime'), { recursive: true })
    writeFileSync(join(root, 'desks', n, 'desk.json'), JSON.stringify({ name: n, kind: 'knowledge', port: 9700 + n.length }))
  }
  mkdirSync(join(root, 'lib'), { recursive: true })
  if (module) { mkdirSync(join(root, 'desks', 'hooks'), { recursive: true }); writeFileSync(join(root, 'desks', 'hooks', 'extra.mjs'), module) }
  writeFileSync(join(root, 'office.json'), JSON.stringify({ roleEnv: 'OFFICE_ROLE', lead: { session: 'Office Lead' }, wall }))
  return root
}
// a session registered under this test's pid (an ancestor of the hook), at `cwd`
function as(root, name, tool_name, tool_input, { cwd = root, role = null } = {}) {
  const cfg = mkdtempSync(join(tmpdir(), 'oa-cfg-'))
  mkdirSync(join(cfg, 'sessions'))
  if (name) writeFileSync(join(cfg, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, name }))
  const env = { ...process.env, CLAUDE_CONFIG_DIR: cfg }; delete env.OFFICE_ROLE; delete env.CLAUDE_PROJECT_DIR
  if (role) env.OFFICE_ROLE = role
  const t0 = Date.now()
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name, tool_input, cwd }), encoding: 'utf8', env, cwd, timeout: 15000 })
  return { code: r.status, ms: Date.now() - t0 }
}

test('(a) wall.messageTo: names a desk may message that are not session identities', () => {
  const root = office({ messageTo: ['lead'] })
  assert.equal(as(root, null, 'SendMessage', { to: 'lead', message: 'x' }, { cwd: join(root, 'desks', 'inventory') }).code, 0)
  assert.equal(as(root, null, 'SendMessage', { to: 'lead [71b9]', message: 'x' }, { cwd: join(root, 'desks', 'inventory') }).code, 0)
  assert.equal(as(root, null, 'SendMessage', { to: 'leader', message: 'x' }, { cwd: join(root, 'desks', 'inventory') }).code, 2)
  // and a session NAMED lead is not walled as the lead: it is a developer at the root
  assert.equal(as(root, 'lead', 'Write', { file_path: join(root, 'lib', 'x.mjs') }).code, 0)
})

test('(b) a desk session at the root with its office module missing is refused, by name', () => {
  const root = office({ module: 'desks/hooks/nope.mjs', aliasNames: ['^cs-'] })
  assert.equal(as(root, 'desk-inventory', 'Bash', { command: 'ls' }).code, 2)
  assert.equal(as(root, 'desk-support--T-1', 'Bash', { command: 'ls' }).code, 2)
  assert.equal(as(root, 'cs-Someone', 'Bash', { command: 'ls' }).code, 2, 'a name the office declares desk-shaped')
})

test('(c) a broken alias() refuses only desk-shaped names; the lead and a developer can still repair', () => {
  for (const module of ['export function alias() { throw new Error("boom") }', 'export function alias() { for (;;) {} }']) {
    const root = office({ module: 'desks/hooks/extra.mjs', aliasNames: ['^cs-'] }, module)
    assert.equal(as(root, 'cs-Someone', 'Bash', { command: 'ls' }).code, 2)
    // desk-<x> needs no alias: a broken alias() is not its failure, and ls is allowed
    assert.equal(as(root, 'desk-inventory', 'Bash', { command: 'ls' }).code, 0)
    assert.equal(as(root, 'desk-inventory', 'Write', { file_path: join(root, 'lib', 'x.mjs') }).code, 2)
    assert.equal(as(root, 'repo-dev-12', 'Write', { file_path: join(root, 'lib', 'x.mjs') }).code, 0, 'a developer at the root')
    assert.equal(as(root, 'Office Lead', 'Bash', { command: 'ls' }, { role: 'Office Lead' }).code, 0, 'the lead')
  }
})

test('(d) a session the module cannot concern starts no worker', () => {
  // the module would hang; only a session that needs it may wait on it
  const root = office({ module: 'desks/hooks/extra.mjs', aliasNames: ['^cs-'] }, 'export function alias() { for (;;) {} }\nexport function judge() { return null }')
  const dev = as(root, 'repo-dev-12', 'Bash', { command: 'ls' })
  assert.equal(dev.code, 0)
  assert.ok(dev.ms < 1800, `a developer waited ${dev.ms} ms on a module that is not about it`)
})

test('(review) a desk-shaped name the module cannot resolve is refused, not waved through as a developer', () => {
  const root = office({ module: 'desks/hooks/extra.mjs', aliasNames: ['^cs-'] }, 'export function alias(n) { return n === "cs-Known" ? "desk-support--T-1" : null }')
  assert.equal(as(root, 'cs-Unknown', 'Write', { file_path: join(root, 'lib', 'x.mjs') }).code, 2)
  assert.equal(as(root, 'repo-dev-12', 'Write', { file_path: join(root, 'lib', 'x.mjs') }).code, 0)
})

test('(review) a module judge() that throws on one call still denies the lead that call', () => {
  const root = office({ module: 'desks/hooks/extra.mjs' }, 'export function judge(p) { if (p.tool_input?.command === "boom") throw new Error("x"); return null }')
  assert.equal(as(root, 'Office Lead', 'Bash', { command: 'boom' }, { role: 'Office Lead' }).code, 2)
  assert.equal(as(root, 'Office Lead', 'Bash', { command: 'ls' }, { role: 'Office Lead' }).code, 0)
})

test('(review) a broken aliasNames pattern is not silently dropped: only the lead goes on until it is fixed', () => {
  // the office says some names are desks; a pattern that does not compile
  // used to vanish, and those desk sessions passed as developers
  const root = office({ module: 'desks/hooks/extra.mjs', aliasNames: ['^cs-('] }, 'export function alias() { return null }')
  assert.equal(as(root, 'cs-Someone', 'Bash', { command: 'ls' }).code, 2)
  assert.equal(as(root, 'repo-dev-12', 'Bash', { command: 'ls' }).code, 2)
  assert.equal(as(root, 'Office Lead', 'Bash', { command: 'ls' }, { role: 'Office Lead' }).code, 0)
})
