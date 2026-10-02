// A RESTARTED DESK IS TOLD WHO IT IS AND WHERE ITS MEMORY IS. Its chat may be
// gone; its files are not.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'desk-boot.mjs')
function office(cfg) {
  const root = mkdtempSync(join(tmpdir(), 'oa-boot-'))
  const d = join(root, 'desks', 'quotes')
  mkdirSync(join(d, 'work-sc1'), { recursive: true })
  writeFileSync(join(d, 'desk.json'), JSON.stringify({ name: 'quotes', kind: 'knowledge', port: 9301, wake: 'node ../../scripts/wake.mjs' }))
  writeFileSync(join(d, 'facts.md'), '# facts')
  writeFileSync(join(d, 'notes.txt'), 'not memory')
  writeFileSync(join(d, 'work-sc1', 'brief-sc1.md'), 'brief')
  const old = new Date(Date.now() - 3600_000); utimesSync(join(d, 'facts.md'), old, old)
  if (cfg) writeFileSync(join(root, 'office.json'), JSON.stringify(cfg))
  return root
}
const run = (root, cwd, role) => {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'oa-cfg-')) }
  delete env.OFFICE_ROLE
  if (role) env.OFFICE_ROLE = role
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd }), encoding: 'utf8', env })
  return { code: r.status, out: r.stdout }
}

test('a desk hears who it is, its doorbell, and its memory files newest first', () => {
  const root = office({ roleEnv: 'OFFICE_ROLE', boot: {} })
  const { code, out } = run(root, join(root, 'desks', 'quotes'))
  assert.equal(code, 0)
  const lines = out.trim().split('\n')
  assert.match(lines[0], /^You are desk-quotes \(desks\/quotes\)/)
  assert.match(out, /`node \.\.\/\.\.\/scripts\/wake\.mjs` \(run in desks\/quotes\)/)
  const files = lines.filter((l) => /^- desks\//.test(l))
  assert.deepEqual(files, ['- desks/quotes/work-sc1/brief-sc1.md', '- desks/quotes/facts.md'], 'work briefs are memory too (case-blind), newest first; other files are not')
  assert.ok(!/not loaded/.test(out), 'started in its own folder: no warning')
})

test('a desk resumed at the root is warned its own CLAUDE.md is not loaded', () => {
  const root = office({ roleEnv: 'OFFICE_ROLE', boot: {} })
  const { out } = run(root, root, 'desk-quotes')
  assert.match(out, /Your directory is .*not desks\/quotes.*CLAUDE\.md is not loaded/)
})

test('the office\'s own words: lead lines and text overrides', () => {
  const root = office({ roleEnv: 'OFFICE_ROLE', lead: { session: 'Office Lead' }, boot: { lead: ['Read desks/LEAD.md first.'], text: { intro: '你是 desk-{desk}（{deskRel}）。', outro: '' } } })
  assert.equal(run(root, root, 'Office Lead').out.trim(), 'Read desks/LEAD.md first.')
  const desk = run(root, join(root, 'desks', 'quotes')).out
  assert.match(desk, /^你是 desk-quotes（desks\/quotes）。/)
  assert.ok(!/carry on/.test(desk), 'an emptied line is left out')
})

test('inert: no office.json, no "boot", or a developer session', () => {
  assert.equal(run(office(null), join(mkdtempSync(join(tmpdir(), 'x-')))).out, '')
  const noBoot = office({ roleEnv: 'OFFICE_ROLE' })
  assert.equal(run(noBoot, join(noBoot, 'desks', 'quotes')).out, '')
  const root = office({ boot: {} })
  assert.equal(run(root, root).out, '', 'the root with no role is a developer session')
})
