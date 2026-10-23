// THE CONTEXT CAP (lib/context.mjs): what office.json says becomes
// CLAUDE_CODE_AUTO_COMPACT_WINDOW on the launch line, per desk, lead and
// teammate; no key, no variable (the rollback); desk-watch warns against it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { contextCap } from '../lib/context.mjs'
import { launchCommand, targetsOf } from '../lib/start.mjs'
import { profilesOf, roleCommand } from '../lib/role.mjs'
import { watch } from '../lib/desk-watch.mjs'

const cfg = { context: { capTokens: 700000, lead: 800000, teammates: 400000, perDesk: { billing: 500000 } } }

test('the cap per session: office-wide, per desk, lead, teammates; a bad value refuses', () => {
  assert.equal(contextCap(cfg, { desk: 'customer' }), 700000)
  assert.equal(contextCap(cfg, { desk: 'billing' }), 500000)
  assert.equal(contextCap(cfg, { isLead: true }), 800000)
  assert.equal(contextCap(cfg, { desk: 'billing', teammate: true }), 400000)
  assert.equal(contextCap({ context: { capTokens: 700000, perDesk: { billing: 500000 } } }, { desk: 'billing', teammate: true }), 500000, 'a teammate without its own cap takes its desk\'s')
  assert.equal(contextCap({}, { desk: 'x' }), null)
  for (const bad of [10, 700000.5, '700000', 5_000_000]) assert.throws(() => contextCap({ context: { capTokens: bad } }, { desk: 'x' }), /not a whole number/)
})

test('the launch line carries CLAUDE_CODE_AUTO_COMPACT_WINDOW; without the key it does not (the rollback)', () => {
  const t = { name: 'customer', tag: 'desk-customer', isLead: false, dir: '/o/desks/customer' }
  assert.match(launchCommand({ cfg, target: t }), /&& CLAUDE_CODE_AUTO_COMPACT_WINDOW=700000 claude --name/)
  assert.match(launchCommand({ cfg, target: { ...t, name: 'billing', teammate: true, tag: 'cs-Ann' } }), /CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000 claude/)
  assert.match(launchCommand({ cfg, target: { name: 'lead', tag: 'lead', isLead: true, dir: '/o' } }), /CLAUDE_CODE_AUTO_COMPACT_WINDOW=800000 claude/)
  assert.doesNotMatch(launchCommand({ cfg: {}, target: t }), /AUTO_COMPACT/)
  assert.throws(() => launchCommand({ cfg: { context: { capTokens: 'big' } }, target: t }), /not a whole number/)
})

test('desk-watch DESK-CONTEXT follows the cap: 75% of it unless maxContextPerCall is set', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'oa-ctx-'))), cc = mkdtempSync(join(tmpdir(), 'oa-ctx-cc-'))
  const cwd = join(root, 'desks', 'a'); mkdirSync(cwd, { recursive: true })
  writeFileSync(join(cwd, 'desk.json'), JSON.stringify({ name: 'a', kind: 'knowledge', port: 9101 }))
  const p = join(cc, 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-')); mkdirSync(p, { recursive: true })
  const now = Date.now()
  writeFileSync(join(p, 's.jsonl'), [1, 2, 3, 4].map((i) => JSON.stringify({ type: 'assistant', timestamp: new Date(now - i * 60e3).toISOString(), message: { id: 'm' + i, model: 'x', usage: { cache_read_input_tokens: 400_000 }, content: [] } })).join('\n'))
  const run = (c) => watch(root, { cfg: c, configDir: cc, sessions: [{ pid: 1, sessionId: 's', cwd, name: 'desk-a', status: 'idle' }], now, runChecks: false }).problems
  assert.equal(run({}).length, 1, '400K is over the plain 300K')
  assert.deepEqual(run({ context: { capTokens: 700000 } }), [], '400K is under 75% of 700K (525K)')
  assert.match(run({ context: { capTokens: 500000 } })[0].line, /limit 375K, 75% of its 500K cap/)
  assert.equal(run({ context: { capTokens: 700000 }, deskWatch: { maxContextPerCall: 350000 } }).length, 1, 'an explicit limit wins')
})

// ⛔ A LEAD COMPACTS BY ITSELF (the owner, 2026-10-23: "the lead should compact
// itself when needed"). Every road that starts a department lead (start and the
// watchdog's restart, which runs start; /role) carries context.lead from office.json
test('⛔ a department lead started by start or by /role carries context.lead as its compact window', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'oa-ctx-lead-')))
  mkdirSync(join(root, 'departments', 'local-ops', 'inventory'), { recursive: true })
  writeFileSync(join(root, 'departments', 'local-ops', 'inventory', 'desk.json'), JSON.stringify({ name: 'inventory', kind: 'knowledge', port: 9102 }))
  const office = { roleEnv: 'OFFICE_ROLE', context: { capTokens: 300000, lead: 500000 }, departments: { 'local-ops': { lead: 'ERP', desks: ['inventory'] } }, profiles: { erp: { department: 'local-ops' } } }
  writeFileSync(join(root, 'office.json'), JSON.stringify(office))
  mkdirSync(join(root, '.office')); writeFileSync(join(root, '.office', 'local.json'), JSON.stringify({ departments: ['local-ops'] }))
  const t = targetsOf(root, office, 'ERP')
  assert.equal(t.length, 1)
  assert.match(launchCommand({ cfg: office, target: t[0] }), /CLAUDE_CODE_AUTO_COMPACT_WINDOW=500000 claude --name 'ERP'/)
  const p = profilesOf(root, office).list.find((x) => x.name === 'erp')
  assert.match(roleCommand(root, office, p, { home: mkdtempSync(join(tmpdir(), 'oa-ctx-lead-h-')) }), /CLAUDE_CODE_AUTO_COMPACT_WINDOW=500000 claude --name 'ERP'/)
  // the desk keeps its own
  assert.match(launchCommand({ cfg: office, target: targetsOf(root, office, 'inventory')[0] }), /CLAUDE_CODE_AUTO_COMPACT_WINDOW=300000 claude/)
})
