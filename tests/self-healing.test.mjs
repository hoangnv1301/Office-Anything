// CORE SELF-HEALING (lead's request, 2026-10-18): the watchdog is installed and
// checked by the plugin itself, restarts the lead as well as the desks (never a
// second lead), and a desk that stays down is said, with how long, to the lead.
// Every test injects launchctl, the process table and the clock.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { watchdogWanted, watchdogStatus, ensureWatchdog } from '../lib/watchdog.mjs'
import { officeHealth } from '../lib/health.mjs'
import { heal } from '../lib/heal.mjs'

const MIN = 60_000
function office(cfg = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oa-sh-'))
  const home = mkdtempSync(join(tmpdir(), 'oa-sh-home-'))
  mkdirSync(join(root, 'desks', 'bell'), { recursive: true })
  writeFileSync(join(root, 'desks', 'bell', 'desk.json'), JSON.stringify({ name: 'bell', kind: 'knowledge', port: 9301 }))
  writeFileSync(join(root, 'office.json'), JSON.stringify({ start: 'echo started {desk} >> started.txt', lead: { session: 'Lead', aliases: ['lead'], start: 'echo lead >> lead.txt' }, watchdog: { notify: 'lead' }, ...cfg }))
  return { root, home }
}
const lc = (status = 0) => { const calls = []; const f = (a) => { calls.push(a); return { status, stderr: '' } }; f.calls = calls; return f }
const read = (root, f) => existsSync(join(root, f)) ? readFileSync(join(root, f), 'utf8') : ''
const alerts = (root) => read(root, '.office/alerts.log').trim().split('\n').filter(Boolean)
const aliveDesk = { name: 'bell', session: { state: 'alive', pid: 10 }, doorbell: { state: 'none' } }
const deadDesk = { name: 'bell', session: { state: 'dead' }, doorbell: { state: 'down' } }
const H = (over = {}) => ({ code: 0, desks: [aliveDesk], checks: [], orphans: [], lead: { session: { pid: 5, name: 'Lead' }, reach: [] }, ...over })
const noLead = (reach = ['LEAD-UNREACHABLE:none']) => ({ session: null, reach })
const opts = (o, extra = {}) => ({ home: o.home, kill: () => { throw new Error('must not kill') }, freshProcs: () => new Map(), cwd: () => null, ...extra })

test('watchdogWanted: "watchdog": true or watchdog.install: true; the existing object form alone does not install anything', () => {
  assert.equal(watchdogWanted({ watchdog: true }), true)
  assert.equal(watchdogWanted({ watchdog: { install: true } }), true)
  assert.equal(watchdogWanted({ watchdog: { maxHealsPerHour: 3, notify: 'lead' } }), false)
  assert.equal(watchdogWanted({ watchdog: false }), false)
  assert.equal(watchdogWanted({}), false)
})

test('ensureWatchdog: installs once, then only verifies; a plist that is not loaded is loaded again; not wanted touches nothing', () => {
  const o = office({ watchdog: true })
  const l = lc()
  const base = { home: o.home, launchctl: l, uid: 501, allowTempRoot: true, platform: 'darwin' }
  assert.equal(ensureWatchdog(o.root, { ...base, wanted: false }).action, 'not wanted')
  assert.equal(l.calls.length, 0)
  const first = ensureWatchdog(o.root, base)
  assert.equal(first.action, 'installed', JSON.stringify(first))
  assert.ok(l.calls.some((a) => a[0] === 'bootstrap'))
  const n = l.calls.length
  const second = ensureWatchdog(o.root, base)
  assert.equal(second.action, 'ok', 'idempotent')
  assert.ok(!l.calls.slice(n).some((a) => a[0] === 'bootstrap' || a[0] === 'bootout'), 'verifying does not reinstall')
  // plist present, agent not loaded (launchctl print fails): load it again
  const notLoaded = ensureWatchdog(o.root, { ...base, launchctl: (a) => ({ status: a[0] === 'print' ? 113 : 0, stderr: '' }) })
  assert.equal(notLoaded.action, 'installed')
  // an office that cannot have one says why instead of pretending
  const fresh = office({ watchdog: true })
  const temp = ensureWatchdog(fresh.root, { ...base, home: fresh.home, allowTempRoot: false })
  assert.equal(temp.action, 'failed')
  assert.match(temp.why, /temp folder/)
  assert.equal(watchdogStatus(o.root, { ...base, platform: 'linux' }).state, 'unsupported')
})

test('health: "watchdog": true and none installed is a finding naming the one command, and the office is red', () => {
  const o = office({ watchdog: true })
  const h = officeHealth(o.root, { home: o.home, procs: new Map(), checks: false, launchctl: lc(), platform: 'darwin' })
  const f = h.findings.find((x) => x.desk === 'watchdog')
  assert.ok(f, JSON.stringify(h.findings))
  assert.equal(f.short, 'watchdog not installed')
  assert.match(f.say, /node '[^']*health\.mjs' '[^']*' --install-watchdog/, 'paths quoted: an office can live on a disk with a space in its name')
  assert.equal(h.code, 4)
  // installed: no finding
  ensureWatchdog(o.root, { home: o.home, launchctl: lc(), uid: 501, allowTempRoot: true, platform: 'darwin' })
  const ok = officeHealth(o.root, { home: o.home, procs: new Map(), checks: false, launchctl: lc(), platform: 'darwin' })
  assert.ok(!ok.findings.some((x) => x.desk === 'watchdog'), JSON.stringify(ok.findings))
  // not asked for: never a finding
  const quiet = office()
  assert.ok(!officeHealth(quiet.root, { home: quiet.home, procs: new Map(), checks: false, launchctl: lc(), platform: 'darwin' }).findings.some((x) => x.desk === 'watchdog'))
})

test('the watchdog restarts a lead that is gone, through start, once, and within the cap', () => {
  const o = office()
  let t = Date.now()
  const r1 = heal(o.root, H({ lead: noLead() }), opts(o, { now: t }))
  assert.ok(r1.acts.some((a) => a.act === 'restart' && a.desk === 'lead' && a.ok), JSON.stringify(r1.acts))
  assert.equal(read(o.root, 'lead.txt').trim(), 'lead', 'the lead start command ran')
  // start returns before the lead registers: a second run must not open a second lead
  const r2 = heal(o.root, H({ lead: noLead() }), opts(o, { now: t + 2 * MIN }))
  assert.match(r2.acts.find((a) => a.desk === 'lead').why, /waiting for it to register/)
  assert.equal(read(o.root, 'lead.txt').trim().split('\n').length, 1)
  // three restarts an hour, then it stops and the lead is told
  t += 6 * MIN; heal(o.root, H({ lead: noLead() }), opts(o, { now: t }))
  t += 6 * MIN; heal(o.root, H({ lead: noLead() }), opts(o, { now: t }))
  t += 6 * MIN; const capped = heal(o.root, H({ lead: noLead() }), opts(o, { now: t }))
  assert.match(capped.acts.find((a) => a.desk === 'lead').why, /cap: 3/)
  assert.equal(read(o.root, 'lead.txt').trim().split('\n').length, 3)
  assert.ok(alerts(o.root).some((l) => /lead is still not running/.test(l)), alerts(o.root).join('\n'))
})

test('⛔ never a second lead: a live lead, a lead under another name, an unreadable entry or a duplicate is not restarted', () => {
  const o = office()
  const t = Date.now()
  const cases = {
    'alive': H(),
    'running under a name office.json does not give it': H({ lead: noLead(['LEAD-UNREACHABLE:name']) }),
    'registry entry unreadable (alive and invisible)': H({ lead: noLead(['LEAD-UNREACHABLE:unreadable']) }),
    'two leads': H({ lead: { session: { pid: 5, name: 'Lead' }, reach: ['LEAD-DUPLICATE:duplicate'] } }),
    'a health object that says nothing about the lead': { ...H(), lead: undefined },
  }
  for (const [label, h] of Object.entries(cases)) {
    const r = heal(o.root, h, opts(o, { now: t }))
    assert.ok(!r.acts.some((a) => a.desk === 'lead'), label + ': ' + JSON.stringify(r.acts))
  }
  assert.equal(read(o.root, 'lead.txt'), '')
  // and an office can opt out
  const off = office({ watchdog: { restartLead: false }, lead: { session: 'Lead', start: 'echo lead >> lead.txt' } })
  assert.ok(!heal(off.root, H({ lead: noLead() }), opts(off, { now: t })).acts.some((a) => a.desk === 'lead'))
})

test('the plugin\'s own start is the default way back for the lead, and it is named in the log', () => {
  const o = office({ lead: { session: 'Lead' } })
  const r = heal(o.root, H({ lead: noLead() }), opts(o, { now: Date.now() }))
  const a = r.acts.find((x) => x.desk === 'lead')
  assert.ok(a, JSON.stringify(r.acts))
  assert.match(read(o.root, '.office/heal.log'), /"desk":"lead"/)
})

test('a desk that stays down is said to the lead with how long, and health says how long it has been down', () => {
  const o = office()
  const t = Date.now()
  heal(o.root, H({ desks: [deadDesk] }), opts(o, { now: t }))
  assert.ok(!alerts(o.root).some((l) => /down/.test(l)), 'not yet: a restart is under way')
  const later = heal(o.root, H({ desks: [deadDesk] }), opts(o, { now: t + 7 * MIN }))
  assert.ok(alerts(o.root).some((l) => /desk-bell has been down 7 min/.test(l)), alerts(o.root).join('\n'))
  assert.ok(later.acts.some((a) => a.act === 'notify'))
  // health reads the same record: red, with the minutes
  const h = officeHealth(o.root, { home: o.home, procs: new Map(), checks: false, now: t + 7 * MIN })
  const f = h.findings.find((x) => x.desk === 'bell')
  assert.match(f.say, /not running.*down 7m/)
  assert.equal(h.code, 4)
  // it comes back: the clock resets
  heal(o.root, H(), opts(o, { now: t + 8 * MIN }))
  assert.ok(!('bell' in JSON.parse(read(o.root, '.office/heal-state.json')).down))
})

test('start and health --heal call the plugin\'s own ensure, and the docs say so', () => {
  const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
  assert.match(src('lib/start.mjs'), /ensureWatchdog\(/)
  assert.match(src('lib/health.mjs'), /ensureWatchdog\(/)
  const readme = src('README.md')
  assert.match(readme, /"watchdog": true/)
  assert.match(readme, /watchdog not installed/)
  assert.match(readme, /restartLead/)
})
