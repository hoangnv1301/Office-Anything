// AN OFFICE HOLDS ITS PLUGIN VERSION (alert first). On 2026-10-10 Claude
// Code's background auto-update installed a new wall onto a live office five
// minutes after a merge, and nothing said so. office.json
// "plugin": { "approved": [...], "enforce": false } makes every session that
// loads an unapproved version say so, and puts a typed VERSION line in the
// lead's alert log. Refusing desk sessions on it is opt-in (enforce): with
// background updates, a fail-closed default would stop every desk silently.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const LOADED = JSON.parse(readFileSync(join(REPO, '.claude-plugin', 'plugin.json'), 'utf8')).version
function office(plugin, extra = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'oa-pin-')))
  mkdirSync(join(root, 'desks', 'inventory'), { recursive: true })
  writeFileSync(join(root, 'desks', 'inventory', 'desk.json'), JSON.stringify({ name: 'inventory', kind: 'knowledge', port: 9951 }))
  mkdirSync(join(root, 'lib'), { recursive: true })
  writeFileSync(join(root, 'office.json'), JSON.stringify({ roleEnv: 'OFFICE_ROLE', lead: { session: 'Office Lead' }, ...(plugin ? { plugin } : {}), ...extra }))
  return root
}
const env0 = () => { const e = { ...process.env, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'oa-cfg-')) }; delete e.OFFICE_ROLE; delete e.CLAUDE_PROJECT_DIR; return e }
const boot = (root, cwd = join(root, 'desks', 'inventory'), env = env0()) =>
  spawnSync(process.execPath, [join(REPO, 'hooks', 'desk-boot.mjs')], { input: JSON.stringify({ cwd }), encoding: 'utf8', env, cwd }).stdout
const wall = (root, who, tool_name, tool_input) => {
  const env = env0(); let cwd = join(root, 'desks', 'inventory')
  if (who === 'lead') { env.OFFICE_ROLE = 'Office Lead'; cwd = root }
  return spawnSync(process.execPath, [join(REPO, 'hooks', 'desk-wall.mjs')], { input: JSON.stringify({ tool_name, tool_input, cwd }), encoding: 'utf8', env, cwd }).status
}

test('a session on an unapproved version is told, and the lead gets one typed VERSION line', () => {
  const root = office({ approved: ['0.0.1'] }, { alerts: { file: 'desks/lead-alerts.log' } })
  const out = boot(root)
  assert.match(out, new RegExp(`office-anything ${LOADED.replace(/\./g, '\\.')}.*not approved.*0\\.0\\.1`))
  const log = readFileSync(join(root, 'desks', 'lead-alerts.log'), 'utf8').trim().split('\n')
  assert.equal(log.length, 1)
  assert.match(log[0], new RegExp(`^\\d{4}-\\d\\d-\\d\\dT\\S+ VERSION - office-anything loaded ${LOADED.replace(/\./g, '\\.')}, approved 0\\.0\\.1`))
  boot(root)
  assert.equal(readFileSync(join(root, 'desks', 'lead-alerts.log'), 'utf8').trim().split('\n').length, 1, 'one alert per version, not one per session start')
})

test('an approved version, or an office that names none, is quiet', () => {
  const ok = office({ approved: [LOADED] })
  assert.doesNotMatch(boot(ok), /not approved/)
  assert.equal(existsSync(join(ok, '.office', 'alerts.log')), false)
  const none = office(null)
  assert.doesNotMatch(boot(none), /not approved/)
})

test('the alert goes to .office/alerts.log when the office names no file, and stays inside the office', () => {
  const root = office({ approved: ['0.0.1'] }, { alerts: { file: '../../outside.log' } })
  boot(root)
  assert.ok(existsSync(join(root, '.office', 'alerts.log')), 'a file outside the office falls back to .office/alerts.log')
})

test('enforce is opt-in: desks are refused on an unapproved version only when the office says so; the lead never is', () => {
  const alert = office({ approved: ['0.0.1'] }, { wall: {} })
  assert.equal(wall(alert, null, 'Bash', { command: 'ls' }), 0)
  const enforce = office({ approved: ['0.0.1'], enforce: true }, { wall: {} })
  assert.equal(wall(enforce, null, 'Bash', { command: 'ls' }), 2)
  assert.equal(wall(enforce, 'lead', 'Bash', { command: 'ls' }), 0)
  const fine = office({ approved: [LOADED], enforce: true }, { wall: {} })
  assert.equal(wall(fine, null, 'Bash', { command: 'ls' }), 0)
})

test('status: loaded vs approved vs the latest release; a release that cannot be fetched is unknown, not "up to date"', async () => {
  const { pluginStatus } = await import('../lib/status.mjs')
  const root = office({ approved: ['0.0.1', LOADED] })
  const s = await pluginStatus(root, { fetchLatest: async () => '9.9.9' })
  assert.equal(s.loaded, LOADED)
  assert.deepEqual(s.approved, ['0.0.1', LOADED])
  assert.equal(s.approvedOk, true)
  assert.equal(s.latest, '9.9.9')
  assert.match(s.line, /loaded .* approved .* latest release 9\.9\.9/)
  const u = await pluginStatus(root, { fetchLatest: async () => { throw new Error('offline') } })
  assert.equal(u.latest, null)
  assert.match(u.line, /latest release unknown/)
})
