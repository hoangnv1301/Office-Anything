// EVERY DESK CARRIES THE OFFICE'S OWN WALL HOOK, AND HEALTH SAYS WHEN ONE DOES
// NOT (0.19.4). local-cabinets-ops audited it in desks/checks/write-wall.mjs,
// which ran only when somebody ran it; its rfq desk had no settings at all.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deskHookProblem } from '../lib/desk-hook.mjs'
import { officeHealth } from '../lib/health.mjs'
import { officeRoster } from '../lib/desk.mjs'

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WALL = 'R="${CLAUDE_PROJECT_DIR%%/departments/*}"; R="${R%%/desks/*}"; [ "$R" != "$CLAUDE_PROJECT_DIR" ] || exit 2; node "$R/desks/hooks/write-wall.mjs" || exit 2'
const MATCH = 'Bash|Read|Grep|Glob|Write|Edit|MultiEdit|NotebookEdit'

function office(hooks, { deskHook = 'office/hooks/write-wall.mjs' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oa-dhook-'))
  mkdirSync(join(root, 'office', 'hooks'), { recursive: true })
  writeFileSync(join(root, 'office', 'hooks', 'write-wall.mjs'), '')
  mkdirSync(join(root, 'desks'))
  symlinkSync('../office/hooks', join(root, 'desks', 'hooks'))
  for (const [id, h] of Object.entries(hooks)) {
    const dir = join(root, 'departments', 'aics', id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'desk.json'), JSON.stringify({ name: id, kind: 'knowledge', port: 9500 + id.length }))
    if (h === undefined) continue
    mkdirSync(join(dir, '.claude'))
    writeFileSync(join(dir, '.claude', 'settings.json'), typeof h === 'string' ? h : JSON.stringify({ hooks: { PreToolUse: h } }))
  }
  writeFileSync(join(root, 'office.json'), JSON.stringify({ roleEnv: 'OFFICE_ROLE', departments: { aics: { lead: 'AICS', desks: Object.keys(hooks) } }, wall: deskHook ? { deskHook } : {} }))
  return root
}
const entry = (command, matcher = MATCH) => [{ matcher, hooks: [{ type: 'command', command }] }]
const why = (root, id) => deskHookProblem(root, officeRoster(root).desks.find((d) => d.name === id), 'office/hooks/write-wall.mjs')

test('⛔ a desk passes with the office hook through the desks/hooks link, or with the plugin\'s own wall', () => {
  const root = office({ a: entry(WALL), b: entry('node "${CLAUDE_PLUGIN_ROOT}/hooks/desk-wall.mjs"'), c: entry(`node "${join('$R', 'office', 'hooks', 'write-wall.mjs')}" || exit 2`, '*') })
  for (const id of ['a', 'b', 'c']) assert.equal(why(root, id), null, id)
})

test('⛔ and fails for no settings, a hook elsewhere, a matcher that misses Write, a swallowed refusal, or a broken file', () => {
  const root = office({
    none: undefined,
    other: entry('node "$R/desks/hooks/tell-lead.mjs" || exit 2'),
    // a copy in the desk's own folder is not the office's wall
    planted: entry('node "$CLAUDE_PROJECT_DIR/office/hooks/write-wall.mjs" || exit 2'),
    narrow: entry(WALL, 'Bash|Read'),
    soft: entry(WALL.replace(/\|\| exit 2$/, '|| true')),
    broken: '{ not json',
  })
  assert.match(why(root, 'none'), /no \.claude\/settings\.json/)
  assert.match(why(root, 'other'), /runs no PreToolUse hook resolving to office\/hooks\/write-wall\.mjs/)
  assert.match(why(root, 'planted'), /runs no PreToolUse hook/)
  assert.match(why(root, 'narrow'), /does not cover Bash, Write and Edit/)
  assert.match(why(root, 'soft'), /swallows its own refusal/)
  assert.match(why(root, 'broken'), /cannot be read/)
})

const look = (root) => officeHealth(root, { home: mkdtempSync(join(tmpdir(), 'oa-dhook-h-')), procs: new Map([[1, { pid: 1, ppid: 0, ageSec: 1e6, cmd: 'launchd' }]]), checks: false, cwd: () => null, pluginRoot: PLUGIN })
const hookFindings = (h) => h.findings.filter((f) => f.short === 'no wall hook')

test('⛔ health is red for each desk without it, and asks nothing of an office that names no deskHook', () => {
  const h = look(office({ good: entry(WALL), rfq: undefined }))
  assert.deepEqual(hookFindings(h).map((f) => f.desk), ['rfq'])
  assert.match(h.line, /rfq no wall hook/)
  assert.deepEqual(hookFindings(look(office({ rfq: undefined }, { deskHook: null }))), [])
  const gone = office({ good: entry(WALL) }, { deskHook: 'office/hooks/missing.mjs' })
  assert.match(hookFindings(look(gone))[0].say, /not a file in the office/)
})
