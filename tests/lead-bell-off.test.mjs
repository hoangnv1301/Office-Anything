// office.json lead.bell.enabled false: the lead runs no doorbell (owner, 2026-11-20)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { bootLines } from '../hooks/desk-boot.mjs'
import { allLeads, leadBellOn } from '../lib/departments.mjs'
import { kickoffFor } from '../lib/start.mjs'

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..')
function office(lead = {}, extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oa-bell-off-'))
  mkdirSync(join(root, '.office'), { recursive: true })
  mkdirSync(join(root, 'desks'), { recursive: true })
  const cfg = { roleEnv: 'OFFICE_ROLE', lead: { session: 'lead', wake: 'node {plugin}/lib/lead-bell.mjs', ...lead }, ...extra }
  writeFileSync(join(root, 'office.json'), JSON.stringify(cfg))
  return { root, cfg }
}

test('default is on: no switch keeps the bell and its boot line', () => {
  const { root, cfg } = office()
  assert.equal(leadBellOn(cfg), true)
  assert.match(bootLines(root, { kind: 'lead', role: 'lead' }, cfg, root).join('\n'), /lead-bell\.mjs/)
})

test('lead.bell.enabled false: no wake, no boot line, no kickoff', () => {
  const { root, cfg } = office({ bell: { enabled: false } })
  assert.equal(allLeads(cfg)[0].wake, null)
  assert.doesNotMatch(bootLines(root, { kind: 'lead', role: 'lead' }, cfg, root).join('\n'), /lead-bell|doorbell/i)
  assert.doesNotMatch(String(kickoffFor(root, cfg, { isLead: true, tag: 'lead', name: 'lead' }) ?? ''), /lead-bell/)
})

test('a department switch wins for that department only', () => {
  const { cfg } = office({ bell: { enabled: false } }, { departments: { a: { lead: 'a-lead', bell: { enabled: true } }, b: { lead: 'b-lead' } } })
  assert.equal(leadBellOn(cfg, 'a'), true)
  assert.equal(leadBellOn(cfg, 'b'), false)
  assert.equal(leadBellOn(cfg), false)
})

test('lead-bell.mjs refuses to start when off, saying why', () => {
  const { root } = office({ bell: { enabled: false } })
  const r = spawnSync(process.execPath, [join(PLUGIN, 'lib', 'lead-bell.mjs'), root, '--once'], { encoding: 'utf8' })
  assert.equal(r.status, 2)
  assert.match(r.stderr, /lead\.bell\.enabled is false/)
})

// cheap wakes (owner 2026-11-20: "retain the wake … make it really small amount of token")
import { poll } from '../lib/lead-bell.mjs'
import { wakeModeOf } from '../lib/bell-wait.mjs'
const T0 = Date.parse('2026-11-20T08:00:00Z')
const runOut = (out) => () => ({ status: 0, stdout: out.v })

test('classes: quiet never rings alone and rides the next ring as one count line; batch waits for batchSec or a now line', () => {
  const asks = [{ name: 'inbox', command: 'x' }]
  const { root, cfg } = office({ bell: { asks, batchSec: 120, classes: [{ match: 'CODE TASK', class: 'quiet' }, { match: 'approval', class: 'batch' }] } })
  const out = { v: 'LM-1\tCODE TASK merged\n' }
  let r = poll(root, cfg, { now: T0, state: null, run: runOut(out) })
  assert.deepEqual(r.lines, [])
  out.v += 'LM-2\tapproval wanted\n'
  r = poll(root, cfg, { now: T0 + 1000, state: r.state, run: runOut(out) })
  assert.deepEqual(r.lines, [], 'batch waits')
  out.v += 'LM-3\tbuyer replied BT-1\n'
  r = poll(root, cfg, { now: T0 + 2000, state: r.state, run: runOut(out) })
  assert.deepEqual(r.lines, ['inbox: buyer replied BT-1', 'inbox: approval wanted', 'quiet: 1 more item(s) waiting in your inbox, nothing urgent'])
  out.v += 'LM-4\tapproval two\n'
  r = poll(root, cfg, { now: T0 + 3000, state: r.state, run: runOut(out) })
  assert.deepEqual(r.lines, [])
  r = poll(root, cfg, { now: T0 + 3000 + 120_000, state: r.state, run: runOut(out) })
  assert.deepEqual(r.lines, ['inbox: approval two'], 'a batch goes out after batchSec on its own')
})

test('a long line is cut to lineMax', () => {
  const { root, cfg } = office({ bell: { asks: [{ name: 'inbox', command: 'x' }], lineMax: 80 } })
  const r = poll(root, cfg, { now: T0, state: null, run: runOut({ v: 'LM-9\t' + 'x'.repeat(500) + '\n' }) })
  assert.equal(r.lines[0].length, 80)
})

test('lead.bell.wakeMode moves only the lead', () => {
  const cfg = { boot: { wakeMode: 'tee' }, lead: { bell: { wakeMode: 'wait' } } }
  assert.equal(wakeModeOf(cfg), 'tee')
  assert.equal(wakeModeOf(cfg, { lead: true }), 'wait')
  const { root, cfg: c2 } = office({ bell: { wakeMode: 'wait' } }, { boot: { wakeMode: 'tee' } })
  assert.match(bootLines(root, { kind: 'lead', role: 'lead' }, c2, root).join('\n'), /bell-wait\.mjs wait/)
})
