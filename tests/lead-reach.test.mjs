// THE LEAD, REACHABLE (lead's findings of 2026-10-16): desks could not message
// the lead by name for two days while it was alive. What the plugin can see and
// say: a lead under the wrong name or with a frozen registry entry, the lead's
// doorbell, refusals that name the way out, and whether a message was seen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { leadReach } from '../lib/lead-reach.mjs'
import { officeHealth } from '../lib/health.mjs'
import { bootLines } from '../hooks/desk-boot.mjs'
import { seen, watch } from '../lib/desk-watch.mjs'

const NOW = Date.now()
const ID = '00000000-0000-4000-8000-000000000042'
const slug = (d) => d.replace(/[^A-Za-z0-9]/g, '-')
function office(cfg = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oa-lead-'))
  for (const n of ['design', 'customer']) { mkdirSync(join(root, 'desks', n), { recursive: true }); writeFileSync(join(root, 'desks', n, 'desk.json'), JSON.stringify({ name: n, kind: 'knowledge', port: 9500 + n.length })) }
  const full = { roleEnv: 'OFFICE_ROLE', lead: { session: '工厂ERP', aliases: [] }, launch: { flags: ['--dangerously-skip-permissions'] }, ...cfg }
  writeFileSync(join(root, 'office.json'), JSON.stringify(full))
  return { root, cfg: full, cc: mkdtempSync(join(tmpdir(), 'oa-lead-cc-')) }
}
function transcript(cc, cwd, id, lines, mtime = NOW) {
  mkdirSync(join(cc, 'projects', slug(cwd)), { recursive: true })
  const f = join(cc, 'projects', slug(cwd), `${id}.jsonl`)
  writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  utimesSync(f, new Date(mtime), new Date(mtime))
}

test('LEAD-UNREACHABLE: the lead under a name office.json does not give it, with the exact command to run', () => {
  const o = office()
  const p = leadReach(o.root, o.cfg, { sessions: [{ pid: 19402, name: 'lead', cwd: o.root, sessionId: ID, updatedAt: NOW }], configDir: o.cc, now: NOW })
  assert.equal(p.length, 1)
  assert.equal(p[0].type, 'LEAD-UNREACHABLE')
  assert.match(p[0].line, /runs as "lead" \(pid 19402\), but office.json names the lead "工厂ERP"/)
  assert.match(p[0].line, new RegExp(`Close it \\(/exit\\) and run: cd '${o.root}' && OFFICE_ROLE='工厂ERP' claude --name '工厂ERP' --dangerously-skip-permissions --resume ${ID}$`))
  // desk-watch raises it, and health says it
  assert.ok(watch(o.root, { cfg: o.cfg, configDir: o.cc, sessions: [{ pid: 19402, name: 'lead', cwd: o.root, sessionId: ID, updatedAt: NOW }], now: NOW, runChecks: false }).problems.some((x) => x.key === 'LEAD-UNREACHABLE:name'))
  // an alias is a name the office gives it: reachable
  assert.deepEqual(leadReach(o.root, { ...o.cfg, lead: { session: '工厂ERP', aliases: ['lead'] } }, { sessions: [{ pid: 1, name: 'lead', cwd: o.root, sessionId: ID, updatedAt: NOW }], configDir: o.cc, now: NOW }), [])
  // no lead declared: nothing to judge
  assert.deepEqual(leadReach(o.root, {}, { sessions: [], configDir: o.cc, now: NOW }), [])
  assert.match(leadReach(o.root, o.cfg, { sessions: [], configDir: o.cc, now: NOW })[0].line, /no live session is named "工厂ERP".*Run: cd /)
})

test('LEAD-UNREACHABLE: a registry entry frozen while the conversation moves on; a fresh one is fine', () => {
  const o = office()
  const lead = { pid: 19402, name: '工厂ERP', cwd: o.root, sessionId: ID }
  transcript(o.cc, o.root, ID, [{ type: 'user', timestamp: new Date(NOW).toISOString(), message: { content: 'hi' } }], NOW - 5 * 60_000)
  const frozen = leadReach(o.root, o.cfg, { sessions: [{ ...lead, updatedAt: NOW - 3 * 24 * 3600_000 }], configDir: o.cc, now: NOW })
  assert.equal(frozen.length, 1)
  assert.match(frozen[0].line, /registry entry stopped updating at .*other sessions no longer list it.*--resume 0{8}/)
  assert.deepEqual(leadReach(o.root, o.cfg, { sessions: [{ ...lead, updatedAt: NOW - 6 * 60_000 }], configDir: o.cc, now: NOW }), [])
})

test('the lead\'s doorbell (office.json lead.wake): its boot text arms it, and health says when it is unarmed', () => {
  const o = office({ lead: { session: '工厂ERP', wake: 'node scripts/lead-bell.mjs' } })
  const lines = bootLines(o.root, { kind: 'lead' }, o.cfg, o.root).join('\n')
  assert.match(lines, /start your doorbell with Monitor, timeout_ms 1800000.*`node scripts\/lead-bell\.mjs` \(run in the office root\)/)
  assert.match(lines, /When its expiry notice arrives, start it again at once/)
  const home = mkdtempSync(join(tmpdir(), 'oa-lead-home-'))
  mkdirSync(join(home, '.claude', 'sessions'), { recursive: true })
  writeFileSync(join(home, '.claude', 'sessions', '777.json'), JSON.stringify({ pid: 777, name: '工厂ERP', cwd: o.root, sessionId: ID, startedAt: NOW - 3600_000, updatedAt: NOW }))
  const procs = new Map([[777, { pid: 777, ppid: 1, ageSec: 3600, cmd: 'claude --name 工厂ERP' }]])
  const h = officeHealth(o.root, { home, procs, now: NOW, checks: false })
  assert.ok(h.findings.some((f) => f.desk === 'lead' && f.short === 'doorbell unarmed'), JSON.stringify(h.findings))
  procs.set(800, { pid: 800, ppid: 777, ageSec: 60, cmd: 'node scripts/lead-bell.mjs' })
  assert.ok(!officeHealth(o.root, { home, procs, now: NOW, checks: false }).findings.some((f) => f.desk === 'lead'))
})

test('the wall\'s refusals name the way out: a socket address, the fallback, and where a desk may write', () => {
  const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'desk-wall.mjs')
  const o = office({ wall: { failClosed: true, messageFallback: 'node scripts/desk/ops.mjs tell-lead "<text>"' } })
  const cwd = join(o.root, 'desks', 'design')
  const env = { ...process.env, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'oa-lead-cfg-')), OFFICE_ROLE: 'desk-design' }
  const gate = (tool_name, tool_input) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name, tool_input, cwd }), encoding: 'utf8', env, cwd })
  const uds = gate('SendMessage', { to: 'uds:/tmp/cc-socks/19402.sock', message: 'x' })
  assert.equal(uds.status, 2)
  assert.match(uds.stderr, /never by socket or address.*send to the lead as 工厂ERP\. If the lead is not reachable by name: node scripts\/desk\/ops\.mjs tell-lead/)
  assert.match(gate('SendMessage', { to: 'someone', message: 'x' }).stderr, /If the lead is not reachable by name: node scripts/)
  const cp = gate('Bash', { command: 'cp contract.png /Users/x/Desktop/contract.png' })
  assert.equal(cp.status, 2)
  assert.match(cp.stderr, new RegExp(`writes only inside its own folder ${cwd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(or a temp dir\\), not /Users/x/Desktop/contract\\.png`))
})

test('seen: not seen, delivered, read, answered, from the desk\'s own transcript', () => {
  const o = office()
  const cwd = join(o.root, 'desks', 'design')
  const at = (m) => new Date(NOW - m * 60_000).toISOString()
  const msg = { type: 'user', timestamp: at(30), message: { content: '<cross-session-message from="uds:/tmp/cc-socks/1.sock" from-name="工厂ERP">\nplease quote job SC-1\n</cross-session-message>' } }
  const turn = { type: 'assistant', timestamp: at(20), message: { id: 'a', content: [{ type: 'text', text: 'working' }] } }
  const reply = { type: 'assistant', timestamp: at(10), message: { id: 'b', content: [{ type: 'tool_use', name: 'SendMessage', input: { to: '工厂ERP', message: 'done' } }] } }
  const sessions = [{ pid: 9, name: 'desk-design', cwd, sessionId: ID }]
  const run = (lines, frag = 'quote job SC-1') => { transcript(o.cc, cwd, ID, lines); return seen(o.root, 'design', frag, { configDir: o.cc, sessions, now: NOW }).state }
  assert.equal(run([turn]), 'not seen')
  assert.equal(run([msg]), 'delivered')
  assert.equal(run([msg, turn]), 'read')
  assert.equal(run([msg, turn, reply]), 'answered')
  assert.equal(run([msg, turn, reply], 'some other text'), 'not seen')
})

test('LEAD-UNREACHABLE: the lead\'s registry entry is not valid JSON (a stray "}"): Claude Code skips it, the plugin says so, and leaves the file alone', async () => {
  const { readFileSync } = await import('node:fs')
  const o = office()
  const home = mkdtempSync(join(tmpdir(), 'oa-lead-home-'))
  mkdirSync(join(home, '.claude', 'sessions'), { recursive: true })
  const f = join(home, '.claude', 'sessions', '19402.json')
  const text = JSON.stringify({ pid: 19402, name: 'lead', cwd: o.root, sessionId: ID, startedAt: NOW - 3600_000, status: 'busy' }) + '}'
  writeFileSync(f, text)
  const procs = new Map([[19402, { pid: 19402, ppid: 1, ageSec: 3600, cmd: 'claude --teammate-mode auto' }]])
  const h = officeHealth(o.root, { home, procs, now: NOW, checks: false })
  const say = h.findings.find((x) => x.desk === 'lead')?.say ?? ''
  assert.match(say, /19402\.json is not valid JSON .*no other session lists the lead \(pid 19402, named "lead"\).*--resume 0{8}-0000-4000-8000-000000000042$/)
  assert.equal(readFileSync(f, 'utf8'), text, 'the registry is only read')
  // a dead pid's broken file is not the lead
  procs.delete(19402); procs.set(1, { pid: 1, ppid: 0, ageSec: 9, cmd: 'launchd' })
  assert.match(officeHealth(o.root, { home, procs, now: NOW, checks: false }).findings.find((x) => x.desk === 'lead')?.say ?? '', /no live session is named/)
})
