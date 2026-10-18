// A DUPLICATE LEAD (2026-10-18): a working session named "lead" while office.json
// named the lead "工厂ERP", and a second lead was started. Start already refuses
// to open one; this pins that two live lead sessions are SAID, by health and by
// --recover, with both pids and which one to close.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { leadReach } from '../lib/lead-reach.mjs'
import { officeHealth } from '../lib/health.mjs'
import { start } from '../lib/start.mjs'

const NOW = Date.now()
function office() {
  const root = mkdtempSync(join(tmpdir(), 'oa-dup-'))
  mkdirSync(join(root, 'desks', 'design'), { recursive: true })
  writeFileSync(join(root, 'desks', 'design', 'desk.json'), JSON.stringify({ name: 'design', kind: 'knowledge', port: 9500 }))
  const cfg = { roleEnv: 'OFFICE_ROLE', lead: { session: '工厂ERP', aliases: ['lead'] }, launch: { flags: ['--dangerously-skip-permissions'] } }
  writeFileSync(join(root, 'office.json'), JSON.stringify(cfg))
  return { root, cfg }
}
const two = (root) => [
  { pid: 111, name: 'lead', cwd: root, sessionId: 'a', startedAt: NOW - 7200_000, updatedAt: NOW - 1000 },
  { pid: 222, name: '工厂ERP', cwd: root, sessionId: 'b', startedAt: NOW - 3600_000, updatedAt: NOW - 90_000 },
]

test('LEAD-DUPLICATE: two live sessions under lead names are one finding naming both pids and which to close', () => {
  const o = office()
  const p = leadReach(o.root, o.cfg, { sessions: two(o.root), configDir: mkdtempSync(join(tmpdir(), 'oa-dup-cc-')), now: NOW })
  const d = p.filter((x) => x.type === 'LEAD-DUPLICATE')
  assert.equal(d.length, 1, JSON.stringify(p))
  assert.match(d[0].line, /pid 111 "lead".*pid 222 "工厂ERP"|pid 222 "工厂ERP".*pid 111 "lead"/)
  assert.match(d[0].line, /keep pid 111/, 'the one that is working is kept')
  assert.match(d[0].line, /close pid 222/)
  // one live lead is not a duplicate, whichever name it runs under
  assert.deepEqual(leadReach(o.root, o.cfg, { sessions: [two(o.root)[0]], configDir: '/nonexistent', now: NOW }), [])
  // a session with another name is not a lead
  assert.deepEqual(leadReach(o.root, o.cfg, { sessions: [two(o.root)[0], { pid: 9, name: 'ops-construction', cwd: o.root, updatedAt: NOW }], configDir: '/nonexistent', now: NOW }), [])
})

test('health shows the duplicate lead as a finding, so the office is red', () => {
  const o = office()
  const home = mkdtempSync(join(tmpdir(), 'oa-dup-home-'))
  mkdirSync(join(home, '.claude', 'sessions'), { recursive: true })
  const procs = new Map()
  for (const s of two(o.root)) {
    writeFileSync(join(home, '.claude', 'sessions', `${s.pid}.json`), JSON.stringify(s))
    procs.set(s.pid, { pid: s.pid, ppid: 1, ageSec: Math.round((NOW - s.startedAt) / 1000), cmd: `claude --name ${s.name}` })
  }
  const h = officeHealth(o.root, { home, procs, now: NOW, checks: false })
  const f = h.findings.find((x) => x.desk === 'lead' && x.short === 'duplicate lead')
  assert.ok(f, JSON.stringify(h.findings))
  assert.match(f.say, /keep pid 111.*close pid 222/)
  assert.equal(h.code, 4)
})

test('--recover and start lead say which duplicate to close, and open nothing', async () => {
  const o = office()
  const made = []
  const term = { titles: () => [], screen: () => '', answerImports: () => {}, create: ({ title }) => { made.push(title); return 't' } }
  const rows = await start(o.root, 'lead', { cfg: o.cfg, live: () => two(o.root), terminal: term, sleep: async () => {}, dir: mkdtempSync(join(tmpdir(), 'oa-dup-d-')) })
  assert.equal(rows[0].state, 'clash')
  assert.match(rows[0].why, /keep pid 111/)
  assert.match(rows[0].why, /close pid 222/)
  assert.deepEqual(made, [])
})

test('the README says it, and the command a stranger reads says clash', async () => {
  const { readFileSync } = await import('node:fs')
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  assert.match(readme, /`LEAD-DUPLICATE`/)
  assert.match(readFileSync(new URL('../commands/desk-recover.md', import.meta.url), 'utf8'), /`clash`/)
})
