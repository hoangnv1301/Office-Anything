// TWO LIVE COPIES OF ONE BUYER THREAD (2026-10-19): cs-Web-visitor-ffc681 ran
// twice, two writers on one conversation, and nothing said so. The lead had
// LEAD-DUPLICATE; no other name did. Health now says it for every name this
// office owns (a desk, a case session, a wall.aliasNames name) with the pid to
// close. It reads only: closing is the launcher's job, or the case sweep's.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionDuplicates, officeHealth } from '../lib/health.mjs'

const NOW = Date.now()
function office() {
  const root = mkdtempSync(join(tmpdir(), 'oa-sdup-'))
  mkdirSync(join(root, 'desks', 'design'), { recursive: true })
  writeFileSync(join(root, 'desks', 'design', 'desk.json'), JSON.stringify({ name: 'design', kind: 'knowledge', port: 9500, perCase: { kind: 'job', key: '^SC-\\d+$', adapter: 'true' } }))
  const cfg = { roleEnv: 'OFFICE_ROLE', lead: { session: 'lead' }, wall: { aliasNames: ['^cs-'] } }
  writeFileSync(join(root, 'office.json'), JSON.stringify(cfg))
  return { root, cfg }
}
const s = (pid, name, updatedAgo) => ({ pid, name, sessionId: `id-${pid}`, startedAt: NOW - 3600_000, updatedAt: NOW - updatedAgo })

test('SESSION-DUPLICATE: a desk, a case and an alias name carried twice are each one finding, with the pid to close', () => {
  const { root, cfg } = office()
  const sessions = [
    s(1, 'cs-Web-visitor-ffc681', 60_000), s(2, 'cs-Web-visitor-ffc681', 1000),
    s(3, 'desk-design', 1000), s(4, 'desk-design', 90_000),
    s(5, 'desk-design--SC-1', 1000), s(6, 'desk-design--SC-1', 5000),
  ]
  const d = sessionDuplicates(root, cfg, sessions)
  assert.equal(d.length, 3, JSON.stringify(d))
  const cs = d.find((x) => x.name === 'cs-Web-visitor-ffc681')
  assert.equal(cs.type, 'SESSION-DUPLICATE')
  assert.match(cs.line, /keep pid 2 .*close pid 1/, 'the most recently active stays')
  assert.match(d.find((x) => x.name === 'desk-design').line, /keep pid 3 .*close pid 4/)
})

test('one session per name, the lead, and names this office does not own are not findings', () => {
  const { root, cfg } = office()
  assert.deepEqual(sessionDuplicates(root, cfg, [s(1, 'cs-a', 0), s(2, 'cs-b', 0), s(3, 'desk-design', 0)]), [])
  assert.deepEqual(sessionDuplicates(root, cfg, [s(1, 'lead', 0), s(2, 'lead', 0)]), [], 'the lead is LEAD-DUPLICATE\'s, said once')
  assert.deepEqual(sessionDuplicates(root, cfg, [s(1, 'my-dev', 0), s(2, 'my-dev', 0)]), [], 'not this office\'s name')
  assert.deepEqual(sessionDuplicates(root, cfg, [s(1, 'desk-ghost', 0), s(2, 'desk-ghost', 0)]), [], 'no such desk')
  assert.deepEqual(sessionDuplicates(root, { ...cfg, wall: { aliasNames: ['(('] } }, [s(1, 'cs-a', 0), s(2, 'cs-a', 0)]), [], 'a broken pattern matches nothing here; the wall check owns saying so')
})

test('health shows a duplicated session as a finding, so the office is red', () => {
  const { root } = office()
  const home = mkdtempSync(join(tmpdir(), 'oa-sdup-home-'))
  mkdirSync(join(home, '.claude', 'sessions'), { recursive: true })
  const procs = new Map()
  for (const x of [s(11, 'cs-Web-visitor-ffc681', 60_000), s(12, 'cs-Web-visitor-ffc681', 1000), s(13, 'lead', 0)]) {
    writeFileSync(join(home, '.claude', 'sessions', `${x.pid}.json`), JSON.stringify({ ...x, cwd: root }))
    procs.set(x.pid, { pid: x.pid, ppid: 1, ageSec: 3600, cmd: `claude --name ${x.name}` })
  }
  const h = officeHealth(root, { home, procs, now: NOW, checks: false, cwd: () => null })
  const f = h.findings.find((x) => x.short === 'duplicate session')
  assert.ok(f, JSON.stringify(h.findings))
  assert.equal(f.desk, 'cs-Web-visitor-ffc681')
  assert.match(f.say, /close pid 11/)
  assert.equal(h.code, 4)
})
