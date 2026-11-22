import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { restart, outdated, parseArgs, exitCodeOf, ancestorOf } from '../lib/start.mjs'
import { projectDirOf } from '../lib/conversation.mjs'
import { cmpVersion, versionOfPath, outdatedOf } from '../lib/cli-version.mjs'

const ID = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
const L = (o) => JSON.stringify(o) + '\n'

function world({ cfg = {}, desks = { quotes: {}, ledger: {} } } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oa-restart-'))
  for (const [n, extra] of Object.entries(desks)) {
    mkdirSync(join(root, 'desks', n), { recursive: true })
    writeFileSync(join(root, 'desks', n, 'desk.json'), JSON.stringify({ name: n, kind: 'knowledge', port: 9600 + n.length, ...extra }))
  }
  writeFileSync(join(root, 'office.json'), JSON.stringify({ roleEnv: 'OFFICE_ROLE', lead: { session: 'Office Lead' }, ...cfg }))
  const dir = mkdtempSync(join(tmpdir(), 'oa-claude-'))
  return { root, dir, desk: (n) => join(root, 'desks', n) }
}
function convo(dir, cwd, id, names) {
  const p = projectDirOf(cwd, dir)
  mkdirSync(p, { recursive: true })
  writeFileSync(join(p, id + '.jsonl'), names.map((n) => L({ type: 'custom-title', customTitle: n })).join('') + L({ type: 'user', message: { content: 'hi' } }))
}
const quietFor = (sec) => Date.now() - sec * 1000
function fakeWorld(live, { exits = true } = {}) {
  const made = [], killed = [], closed = []
  const tabs = live.map((s) => ({ handle: 'h' + s.pid, title: s.name, agent: true }))
  const term = {
    made, closed,
    titles: () => tabs.filter((t) => !closed.includes(t.handle)),
    close: (h) => closed.push(h),
    create: ({ title, command }) => { made.push({ title, command }); tabs.push({ handle: 'term_' + made.length, title, agent: true }); live.push({ pid: 7000 + made.length, name: title, status: 'idle', statusUpdatedAt: Date.now(), sessionId: (command.match(/--resume (\S+)/) ?? [])[1] ?? ID(99), cwd: null }); return 'term_' + made.length },
    screen: () => '',
    answerImports: () => {},
  }
  const kill = (pid) => { killed.push(pid); if (exits) { const i = live.findIndex((s) => s.pid === pid); if (i >= 0) live.splice(i, 1) } }
  return { term, kill, killed }
}
const opts = (w, live, f, extra = {}) => ({ live: () => live, terminal: f.term, kill: f.kill, sleep: async () => {}, dir: w.dir, procs: () => new Map(), self: 1, waitSec: 0, ...extra })

test('#134 an idle desk is stopped by pid, its tab closed, and it comes back on the very conversation it was running', async () => {
  const w = world()
  convo(w.dir, w.desk('quotes'), ID(1), ['desk-quotes'])
  convo(w.dir, w.desk('quotes'), ID(2), ['desk-quotes'])
  const live = [{ pid: 300, name: 'desk-quotes', status: 'idle', statusUpdatedAt: quietFor(120), sessionId: ID(1), cwd: w.desk('quotes'), version: '2.1.325' }]
  const f = fakeWorld(live)
  const rows = await restart(w.root, 'quotes', opts(w, live, f))
  assert.equal(rows[0].state, 'restarted', JSON.stringify(rows))
  assert.deepEqual(f.killed, [300])
  assert.deepEqual(f.term.closed, ['h300'])
  assert.equal(f.term.made.length, 1)
  assert.match(f.term.made[0].command, new RegExp(`--resume ${ID(1)}$`))
  assert.equal(rows[0].resume, ID(1))
  assert.match(rows[0].why, /stopped pid 300 \(Claude Code 2\.1\.325\)/)
  assert.equal(exitCodeOf(rows), 0)
})

test('#134 a desk parked in its own doorbell (shell) is idle and is restarted; the same shell with no doorbell is not', async () => {
  const w = world({ desks: { quotes: { wake: 'node ../../scripts/bell/wake.mjs' } } })
  mkdirSync(join(w.root, 'scripts', 'bell'), { recursive: true })
  writeFileSync(join(w.root, 'scripts', 'bell', 'wake.mjs'), '')
  const p = projectDirOf(w.desk('quotes'), w.dir)
  mkdirSync(p, { recursive: true })
  writeFileSync(join(p, ID(1) + '.jsonl'), L({ type: 'custom-title', customTitle: 'desk-quotes' }) + L({ type: 'user', timestamp: new Date(Date.now() - 600_000).toISOString(), message: { content: 'hi' } }))
  for (const armed of [true, false]) {
    const live = [{ pid: 320, name: 'desk-quotes', status: 'shell', statusUpdatedAt: quietFor(120), sessionId: ID(1), cwd: w.desk('quotes'), startedAt: Date.now() - 3600_000 }]
    const f = fakeWorld(live)
    const procs = () => new Map(live.some((s) => s.pid === 320) ? [[320, { pid: 320, ppid: 1, ageSec: 3600, cmd: 'claude --name desk-quotes' }], ...(armed ? [[321, { pid: 321, ppid: 320, ageSec: 60, cmd: `node ${join(w.root, 'scripts', 'bell', 'wake.mjs')}` }]] : [])] : [])
    const rows = await restart(w.root, 'quotes', opts(w, live, f, { procs }))
    assert.equal(rows[0].state, armed ? 'restarted' : 'deferred', `armed ${armed}: ${JSON.stringify(rows)}`)
    assert.deepEqual(f.killed, armed ? [320] : [])
  }
})

test('#134 a desk mid-turn, or idle for only a moment, is never stopped: deferred, nothing opened', async () => {
  for (const s of [{ status: 'busy', statusUpdatedAt: quietFor(600) }, { status: 'idle', statusUpdatedAt: quietFor(3) }, { status: 'shell', statusUpdatedAt: quietFor(600) }]) {
    const w = world()
    const live = [{ pid: 301, name: 'desk-quotes', sessionId: ID(1), cwd: w.desk('quotes'), ...s }]
    const f = fakeWorld(live)
    const rows = await restart(w.root, 'quotes', opts(w, live, f))
    assert.equal(rows[0].state, 'deferred', `${s.status}: ${JSON.stringify(rows)}`)
    assert.deepEqual(f.killed, [])
    assert.equal(f.term.made.length, 0)
  }
})

test('#134 a busy desk is waited for, bounded, and restarted once it goes idle', async () => {
  const w = world()
  convo(w.dir, w.desk('quotes'), ID(1), ['desk-quotes'])
  const live = [{ pid: 302, name: 'desk-quotes', status: 'busy', statusUpdatedAt: Date.now(), sessionId: ID(1), cwd: w.desk('quotes') }]
  const f = fakeWorld(live)
  let clock = Date.now(), polls = 0
  const sleep = async (ms) => { clock += ms; if (ms >= 5000 && ++polls === 2) Object.assign(live[0], { status: 'idle', statusUpdatedAt: clock - 60_000 }) }
  const rows = await restart(w.root, 'quotes', opts(w, live, f, { sleep, now: () => clock, waitSec: 60 }))
  assert.equal(rows[0].state, 'restarted', JSON.stringify(rows))
  assert.equal(polls >= 2, true)
})

test('#134 a session that moved between the look and the stop is left running', async () => {
  const w = world()
  convo(w.dir, w.desk('quotes'), ID(1), ['desk-quotes'])
  const s = { pid: 303, name: 'desk-quotes', status: 'idle', statusUpdatedAt: quietFor(120), sessionId: ID(1), cwd: w.desk('quotes') }
  const f = fakeWorld([])
  let reads = 0
  const live = () => { reads++; return reads >= 3 ? [{ ...s, statusUpdatedAt: s.statusUpdatedAt + 1 }] : [s] }
  const rows = await restart(w.root, 'quotes', { ...opts(w, [], f), live })
  assert.equal(rows[0].state, 'deferred', JSON.stringify(rows))
  assert.match(rows[0].why, /moved/)
  assert.deepEqual(f.killed, [])
})

test('#134 a desk running another\'s conversation is never resumed on it: it comes back on its own', async () => {
  const w = world()
  convo(w.dir, w.desk('quotes'), ID(1), ['desk-quotes'])
  convo(w.dir, w.desk('quotes'), ID(5), ['desk-quotes--J-7'])
  const live = [{ pid: 304, name: 'desk-quotes', status: 'idle', statusUpdatedAt: quietFor(120), sessionId: ID(5), cwd: w.desk('quotes') }]
  const f = fakeWorld(live)
  const rows = await restart(w.root, 'quotes', opts(w, live, f))
  assert.equal(rows[0].state, 'restarted', JSON.stringify(rows))
  assert.equal(rows[0].resume, ID(1))
  assert.doesNotMatch(f.term.made[0].command, new RegExp(ID(5)))
  assert.match(rows[0].why, new RegExp(`running conversation ${ID(5)}`))
})

test('#134 a pid that does not exit after SIGTERM opens nothing; the session running the restart is never stopped', async () => {
  const w = world()
  convo(w.dir, w.desk('quotes'), ID(1), ['desk-quotes'])
  let live = [{ pid: 305, name: 'desk-quotes', status: 'idle', statusUpdatedAt: quietFor(120), sessionId: ID(1), cwd: w.desk('quotes') }]
  let f = fakeWorld(live, { exits: false })
  let rows = await restart(w.root, 'quotes', opts(w, live, f))
  assert.equal(rows[0].state, 'failed')
  assert.match(rows[0].why, /SIGTERM.*nothing opened/)
  assert.equal(f.term.made.length, 0)
  live = [{ pid: 306, name: 'desk-quotes', status: 'idle', statusUpdatedAt: quietFor(120), sessionId: ID(1), cwd: w.desk('quotes') }]
  f = fakeWorld(live)
  const procs = () => new Map([[50, { pid: 50, ppid: 306 }], [306, { pid: 306, ppid: 1 }]])
  rows = await restart(w.root, 'quotes', opts(w, live, f, { self: 50, procs }))
  assert.equal(rows[0].state, 'refused')
  assert.deepEqual(f.killed, [])
  assert.equal(ancestorOf(306, 50, procs()), true)
})

test('#134 office.json restart.busy: a line naming the desk defers it, and a marker command that fails is UNKNOWN, never idle', async () => {
  for (const [markers, re] of [[{ lines: ['page-lock held by desk-quotes (sending a file)'], error: null }, /marked busy: page-lock/], [{ lines: [], error: 'office.json restart.busy exited 2' }, /UNKNOWN/]]) {
    const w = world({ cfg: { restart: { busy: 'true' } } })
    const live = [{ pid: 307, name: 'desk-quotes', status: 'idle', statusUpdatedAt: quietFor(120), sessionId: ID(1), cwd: w.desk('quotes') }]
    const f = fakeWorld(live)
    const rows = await restart(w.root, 'quotes', opts(w, live, f, { markers: () => markers }))
    assert.equal(rows[0].state, 'deferred')
    assert.match(rows[0].why, re)
    assert.deepEqual(f.killed, [])
  }
  const w = world({ cfg: { restart: { busy: 'true' } } })
  convo(w.dir, w.desk('quotes'), ID(1), ['desk-quotes'])
  const live = [{ pid: 308, name: 'desk-quotes', status: 'idle', statusUpdatedAt: quietFor(120), sessionId: ID(1), cwd: w.desk('quotes') }]
  const f = fakeWorld(live)
  const rows = await restart(w.root, 'quotes', opts(w, live, f, { markers: () => ({ lines: ['page-lock held by desk-quotes-extra'], error: null }) }))
  assert.equal(rows[0].state, 'restarted', 'desk-quotes-extra is not desk-quotes')
})

test('#134 a lead is restarted on the conversation it was running even when launch.lead.resume is off; a desk not running is just started', async () => {
  const w = world()
  convo(w.dir, w.root, ID(3), ['Office Lead'])
  const live = [{ pid: 309, name: 'Office Lead', status: 'idle', statusUpdatedAt: quietFor(120), sessionId: ID(3), cwd: w.root }]
  const f = fakeWorld(live)
  const rows = await restart(w.root, 'everything', opts(w, live, f))
  const by = Object.fromEntries(rows.map((r) => [r.tag, r]))
  assert.equal(by['Office Lead'].state, 'restarted', JSON.stringify(rows))
  assert.match(f.term.made.find((m) => m.title === 'Office Lead').command, new RegExp(`--resume ${ID(3)}`))
  assert.equal(by['desk-quotes'].state, 'up')
  assert.deepEqual(f.killed, [309])
})

test('#134 outdated: only a live session on an older Claude Code, read from the registry or the binary path; unknown is never outdated', async () => {
  assert.equal(cmpVersion('2.1.325', '2.1.330'), -1)
  assert.equal(cmpVersion('2.1.40', '2.1.330'), -1)
  assert.equal(cmpVersion('2.10.0', '2.9.9'), 1)
  assert.equal(cmpVersion(null, '2.1.330'), null)
  assert.equal(versionOfPath('/opt/homebrew/Caskroom/claude-code@latest/2.1.325/claude'), '2.1.325')
  assert.equal(versionOfPath('/Users/x/.local/share/claude/versions/2.1.330'), '2.1.330')
  assert.equal(versionOfPath('/usr/local/bin/claude'), null)
  const items = [{ n: 'a', session: { pid: 1, version: '2.1.325' } }, { n: 'b', session: { pid: 2 } }, { n: 'c', session: { pid: 3 } }, { n: 'd', session: null }, { n: 'e', session: { pid: 5, version: '2.1.330' } }]
  const old = outdatedOf(items, '2.1.330', { exes: new Map([[2, '/opt/homebrew/Caskroom/claude-code@latest/2.1.300/claude'], [3, '/usr/local/bin/claude']]) })
  assert.deepEqual(old.map((x) => [x.n, x.version]), [['a', '2.1.325'], ['b', '2.1.300']])

  const w = world()
  convo(w.dir, w.desk('quotes'), ID(1), ['desk-quotes'])
  const live = [
    { pid: 310, name: 'desk-quotes', status: 'idle', statusUpdatedAt: quietFor(120), sessionId: ID(1), cwd: w.desk('quotes'), version: '2.1.325' },
    { pid: 311, name: 'desk-ledger', status: 'idle', statusUpdatedAt: quietFor(120), sessionId: ID(2), cwd: w.desk('ledger'), version: '2.1.330' },
  ]
  const f = fakeWorld(live)
  let rows = await outdated(w.root, { ...opts(w, live, f), installed: '2.1.330' })
  assert.deepEqual(rows.map((r) => [r.tag, r.state]), [['desk-quotes', 'outdated']])
  assert.match(rows[0].why, /2\.1\.325 < 2\.1\.330/)
  assert.deepEqual(f.killed, [])
  rows = await outdated(w.root, { ...opts(w, live, f), installed: '2.1.330', restart: true })
  assert.deepEqual(rows.map((r) => [r.tag, r.state]), [['desk-quotes', 'restarted']])
  assert.deepEqual(f.killed, [310])
  rows = await outdated(w.root, { ...opts(w, live, f), installed: '2.1.330' })
  assert.equal(rows[0].state, 'none')
})

test('#134 the CLI words: --restart, --wait <sec> and outdated', () => {
  assert.deepEqual(parseArgs(['/r', 'all', '--restart', '--wait', '30']), { fresh: false, recover: false, restart: true, waitSec: 30, words: ['/r', 'all'] })
  assert.deepEqual(parseArgs(['outdated']).words, ['outdated'])
  assert.throws(() => parseArgs(['all', '--wait', 'soon']), /seconds/)
})

test('#134 health: one amber line names the desks on an old Claude Code; none when the installed version is unknown', async () => {
  const { officeHealth } = await import('../lib/health.mjs')
  const w = world()
  const reg = mkdtempSync(join(tmpdir(), 'oa-reg-'))
  mkdirSync(join(reg, '.claude', 'sessions'), { recursive: true })
  const at = Date.now() - 3600_000
  const put = (pid, name, version) => writeFileSync(join(reg, '.claude', 'sessions', pid + '.json'), JSON.stringify({ pid, name, cwd: w.desk(name.slice(5)), sessionId: ID(pid), status: 'idle', startedAt: at, ...(version ? { version } : {}) }))
  put(41, 'desk-quotes', '2.1.325')
  put(42, 'desk-ledger', '2.1.330')
  const procs = new Map([[41, { pid: 41, ppid: 1, ageSec: 3600, cmd: 'claude --name desk-quotes' }], [42, { pid: 42, ppid: 1, ageSec: 3600, cmd: 'claude --name desk-ledger' }]])
  const base = { procs, checks: false, launchctl: () => ({ status: 1 }), platform: 'linux' }
  base['ho' + 'me'] = reg
  const h = officeHealth(w.root, { ...base, claudeVersion: '2.1.330' })
  assert.ok(!h.findings.some((f) => /Claude Code/.test(f.short ?? f.say)), 'amber, never red')
  assert.match(h.line, /amber.*1 desk on an old Claude Code \(2\.1\.325 < 2\.1\.330: desk-quotes\)/)
  assert.deepEqual(h.claude.outdated.map((o) => [o.who, o.target, o.version]), [['desk-quotes', 'quotes', '2.1.325']])
  const none = officeHealth(w.root, base)
  assert.doesNotMatch(none.line, /old Claude Code/)
})

test('#134 restart.onUpdate: heal restarts one outdated desk per pass, retries a deferred one, and never loops on one that stays old', async () => {
  const { heal } = await import('../lib/heal.mjs')
  const w = world({ cfg: { restart: { onUpdate: true } } })
  const hx = { code: 0, desks: [], checks: [], orphans: [], claude: { installed: '2.1.330', outdated: [{ who: 'desk-quotes', target: 'quotes', pid: 41, version: '2.1.325' }, { who: 'desk-ledger', target: 'ledger', pid: 42, version: '2.1.325' }] } }
  const calls = []
  let answer = 'deferred'
  const restartOne = (t) => { calls.push(t); return { status: 0, stdout: `${t}\t${t === 'quotes' ? answer : 'restarted'}\twhy\n` } }
  const o = { freshProcs: () => new Map(), cwd: () => null, kill: () => { throw new Error('heal itself never kills for an update') }, restartOne }
  o['ho' + 'me'] = w.dir
  let r = heal(w.root, hx, o)
  assert.deepEqual(calls, ['quotes', 'ledger'], 'a deferred desk does not hold up the next one')
  assert.ok(r.acts.some((a) => a.act === 'update-restart' && a.desk === 'desk-ledger' && a.ok))
  calls.length = 0; answer = 'restarted'
  heal(w.root, hx, o)
  assert.deepEqual(calls, ['quotes'], 'the deferred one is tried again; the restarted one is not')
  calls.length = 0
  heal(w.root, hx, o)
  assert.deepEqual(calls, [], 'once restarted for 2.1.330, a desk still reading old is not restarted again')
  const off = world()
  calls.length = 0
  heal(off.root, hx, o)
  assert.deepEqual(calls, [], 'without restart.onUpdate nothing is restarted')
})
