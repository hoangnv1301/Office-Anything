// BROKEN SESSIONS NOBODY KNEW ABOUT (0.32.0). The owner, 2026-11-20, with an Orca
// screenshot: "why there are broken session that we don't know". That day:
//   - a "desk-inventory" tab sat at zsh for five days beside the live desk
//     (pid 67926, another tab): a restart on 11-15 Ctrl-C'd its claude and
//     reopened the desk in a new tab, and health/heal only looked for such a
//     tab when the desk had NO live session
//   - health was RED only for ~140 "T-… stale" lines, mostly done tasks
//   - AICS ran as a Claude Code background job at the repo root (no tab, its
//     conversation under the root's project), and start opened every lead at
//     the root while /role opened it in its department's folder
//   - a launch that exited at once was a line in a log nobody reads
// Each one is driven here through a fake registry, process table and terminal.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { officeHealth } from '../lib/health.mjs'
import { heal } from '../lib/heal.mjs'
import { strayTabs } from '../lib/procs.mjs'
import { start, launchConfig, holderOf, readLaunchFailures, noteLaunch } from '../lib/start.mjs'
import { projectDirOf, newerElsewhere } from '../lib/conversation.mjs'
import { openRole } from '../lib/role.mjs'

const NOW = Date.now()
const MIN = 60_000
const ID = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
const L = (o) => JSON.stringify(o) + '\n'

function office({ cfg = {}, desks = { inventory: {}, ledger: {} }, machine = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oa-broken-'))
  const home = mkdtempSync(join(tmpdir(), 'oa-broken-home-'))
  const reg = join(home, '.claude', 'sessions')
  mkdirSync(reg, { recursive: true })
  for (const [n, extra] of Object.entries(desks)) {
    mkdirSync(join(root, 'desks', n), { recursive: true })
    writeFileSync(join(root, 'desks', n, 'desk.json'), JSON.stringify({ name: n, kind: 'knowledge', port: 9500 + n.length, ...extra }))
  }
  writeFileSync(join(root, 'office.json'), JSON.stringify({ roleEnv: 'OFFICE_ROLE', start: 'echo started {desk} >> started.txt', ...cfg }))
  if (machine) { mkdirSync(join(root, '.office'), { recursive: true }); writeFileSync(join(root, '.office', 'local.json'), JSON.stringify(machine)) }
  const procs = new Map([[1, { pid: 1, ppid: 0, ageSec: 1e6, cmd: 'launchd' }]])
  const live = (name, { pid = 700, cwd = join(root, 'desks', name.replace(/^desk-/, '')), kind = 'interactive', sid = `00000000-0000-4000-8000-00000000${pid}`, transcript = false } = {}) => {
    writeFileSync(join(reg, `${pid}.json`), JSON.stringify({ pid, name, cwd, sessionId: sid, kind, status: 'idle', statusUpdatedAt: NOW, updatedAt: NOW, startedAt: NOW - 7200_000 }))
    procs.set(pid, { pid, ppid: 1, ageSec: 7200, cmd: `claude --name ${name}` })
    if (transcript) { const p = projectDirOf(cwd, join(home, '.claude')); mkdirSync(p, { recursive: true }); writeFileSync(join(p, sid + '.jsonl'), L({ type: 'custom-title', customTitle: name })) }
  }
  const health = (terminal = null) => officeHealth(root, { home, procs, now: NOW, checks: false, cwd: () => null, terminal })
  return { root, home, procs, live, health, claude: join(home, '.claude') }
}
const tab = (handle, title, agent, extra = {}) => ({ handle, title, agent, orphaned: false, quietMs: 30 * MIN, ...extra })
function fakeTerm(tabs) {
  const closed = []
  return { closed, tabs, titles: () => tabs, close: (h) => { closed.push(h); const i = tabs.findIndex((t) => t.handle === h); if (i >= 0) tabs.splice(i, 1) } }
}
function convo(dir, cwd, id, names, ageSec) {
  const p = projectDirOf(cwd, dir)
  mkdirSync(p, { recursive: true })
  const f = join(p, id + '.jsonl')
  writeFileSync(f, names.map((n) => L({ type: 'custom-title', customTitle: n })).join('') + L({ type: 'user', message: { content: 'hi' } }))
  const t = new Date(Date.now() - ageSec * 1000); utimesSync(f, t, t)
}

test('⛔ 11-20 replay: an old desk-inventory tab at zsh BESIDE its live session is seen (amber) and heal closes it, never the live tab', () => {
  const o = office({ desks: { inventory: {} } })
  o.live('desk-inventory', { pid: 67926 })
  const terminal = fakeTerm([tab('term_7ced', 'desk-inventory', false), tab('term_ee6b', 'desk-inventory', true, { orphaned: true })])
  const h = o.health(terminal)
  const row = h.desks.find((d) => d.name === 'inventory')
  assert.equal(row.session.state, 'alive')
  assert.deepEqual(row.strays.map((s) => [s.handle, s.beside]), [['term_7ced', 67926]])
  assert.equal(h.code, 0, h.line)
  assert.match(h.line, /^office: amber · desk-inventory old tab term_7ced at a shell prompt beside its live session \(pid 67926\)/)
  const r = heal(o.root, h, { home: o.home, now: NOW, kill: () => { throw new Error('no pid is killed') }, freshProcs: () => o.procs, cwd: () => null, terminal })
  assert.deepEqual(terminal.closed, ['term_7ced'])
  assert.ok(r.acts.some((a) => a.act === 'stray-tab' && a.ok && /the desk is alive/.test(a.why)), JSON.stringify(r.acts))
})

test('a tab at zsh beside a live session is NOT a stray when no tab under the name shows an agent (the live one may be that tab)', () => {
  const sessions = [{ pid: 9, name: 'desk-inventory' }]
  const procs = new Map([[9, { pid: 9, cmd: 'claude --name desk-inventory' }]])
  assert.deepEqual(strayTabs(['desk-inventory'], [tab('t1', 'desk-inventory', false)], sessions, procs), [])
  // another claude under the name, not the live one (a launch in flight): not a stray either
  procs.set(10, { pid: 10, cmd: 'claude --name desk-inventory --resume x' })
  assert.deepEqual(strayTabs(['desk-inventory'], [tab('t1', 'desk-inventory', false), tab('t2', 'desk-inventory', true)], sessions, procs), [])
  procs.delete(10)
  assert.equal(strayTabs(['desk-inventory'], [tab('t1', 'desk-inventory', false), tab('t2', 'desk-inventory', true)], sessions, procs).length, 1)
})

test('⛔ a launch whose resume is held by a live process is refused before any tab opens, and health is red for it until it comes up', async () => {
  const o = office()
  const cwd = join(o.root, 'desks', 'ledger')
  convo(o.claude, cwd, ID(1), ['desk-ledger'], 60)
  const live = [], made = []
  const term = { titles: () => [], create: ({ title, command }) => { made.push(command); live.push({ pid: 5001, name: title, status: 'idle', sessionId: ID(1), cwd }); return 'term_new' }, screen: () => '', answerImports: () => {} }
  // the holder is not in the registry (its entry missing): its command line says it
  const procs = () => new Map([[42, { pid: 42, ppid: 1, ageSec: 99, cmd: `claude --name desk-ledger --model sonnet --resume ${ID(1)}` }]])
  const rows = await start(o.root, 'ledger', { live: () => live, terminal: term, sleep: async () => {}, dir: o.claude, procs, home: o.home })
  assert.equal(rows[0].state, 'clash', JSON.stringify(rows))
  assert.match(rows[0].why, new RegExp(`conversation ${ID(1)} is already open in pid 42`))
  assert.equal(made.length, 0)
  assert.match(readLaunchFailures(o.root)['desk-ledger'].why, /start of desk-ledger refused/)
  const h = o.health()
  assert.equal(h.code, 4)
  assert.ok(h.findings.some((f) => f.desk === 'desk-ledger' && /already open in pid 42/.test(f.say)), JSON.stringify(h.findings))
  // it comes up later: the record is gone and health is not red for it
  const rows2 = await start(o.root, 'ledger', { live: () => live, terminal: term, sleep: async () => {}, dir: o.claude, procs: () => new Map(), home: o.home })
  assert.equal(rows2[0].state, 'up', JSON.stringify(rows2))
  assert.equal(readLaunchFailures(o.root)['desk-ledger'], undefined)
})

test('holderOf: by the registry sessionId first, then by a --resume on a claude command line; nothing else', () => {
  assert.deepEqual(holderOf(ID(3), [{ pid: 7, name: 'desk-x', sessionId: ID(3) }]), { pid: 7, name: 'desk-x', how: 'registry' })
  assert.equal(holderOf(ID(3), [], new Map([[8, { pid: 8, cmd: `less /tmp/${ID(3)}.jsonl --resume` }]])), null)
  assert.equal(holderOf(ID(3), [], new Map([[8, { pid: 8, cmd: `/usr/local/bin/claude --resume ${ID(3)}` }]])).pid, 8)
  assert.equal(holderOf(null, [{ pid: 7, sessionId: null }]), null)
})

test('⛔ a launch whose claude exits at once (its tab back at a prompt, never registered) is "exited" with the screen, and health is red for it', async () => {
  const o = office()
  const term = { titles: () => [{ handle: 'term_x', title: 'desk-ledger', agent: false }], create: () => 'term_x', screen: () => 'Error: that conversation is already open\n(base) airm1@mac ledger %', answerImports: () => {} }
  const rows = await start(o.root, 'ledger', { live: () => [], terminal: term, sleep: async () => {}, dir: o.claude, procs: () => new Map(), home: o.home })
  assert.equal(rows[0].state, 'exited', JSON.stringify(rows))
  assert.match(rows[0].why, /exited at once, before it registered \(screen: Error: that conversation is already open/)
  const h = o.health()
  assert.ok(h.findings.some((f) => f.desk === 'desk-ledger' && /^launch of desk-ledger exited at once/.test(f.say)), JSON.stringify(h.findings))
  // a live session under the name clears it from health even before a new launch record
  o.live('desk-ledger', { pid: 711 })
  assert.ok(!o.health().findings.some((f) => f.desk === 'desk-ledger' && /launch/.test(f.say)))
})

test('a slow shell is not an exit: no agent in the tab and no claude yet is waited out until the floor, then said', async () => {
  const o = office()
  let looks = 0
  const term = { titles: () => { looks++; return [{ handle: 'term_s', title: 'desk-ledger', agent: false }] }, create: () => 'term_s', screen: () => '(base) %', answerImports: () => {} }
  const live = []
  // the claude shows up at poll 8 (a login shell loading nvm) and registers at poll 10
  let polls = 0
  const procs = () => { polls++; return polls >= 8 ? new Map([[61, { pid: 61, cmd: 'claude --name desk-ledger' }]]) : new Map() }
  const rows = await start(o.root, 'ledger', { live: () => { if (polls >= 10 && !live.length) live.push({ pid: 61, name: 'desk-ledger', status: 'idle', sessionId: ID(5), cwd: null }); return live }, terminal: term, sleep: async () => {}, dir: o.claude, procs, home: o.home })
  assert.equal(rows[0].state, 'up', JSON.stringify(rows))
  assert.ok(looks > 0)
})

test('⛔ a launch record never turns red again by itself: another launcher\'s session clears it (heal drops it), an idled desk hides it', () => {
  const o = office({ desks: { inventory: {}, ledger: {} }, cfg: { closeWhenIdle: { ledger: 30 } } })
  noteLaunch(o.root, 'desk-inventory', 'launch of desk-inventory exited at once: x', NOW - 60_000)
  o.live('desk-inventory', { pid: 901 })
  let h = o.health()
  assert.ok(!h.findings.some((f) => f.desk === 'desk-inventory'))
  assert.deepEqual(h.launchCleared, ['desk-inventory'])
  heal(o.root, h, { home: o.home, now: NOW, kill: () => {}, freshProcs: () => o.procs, cwd: () => null, terminal: fakeTerm([]) })
  assert.equal(readLaunchFailures(o.root)['desk-inventory'], undefined, 'heal dropped the record once the desk was up')
  // a record for a desk switched off here is not red: nothing is expected to run
  const o2 = office({ desks: { ledger: { autostart: false } } })
  noteLaunch(o2.root, 'desk-ledger', 'launch of desk-ledger failed: y', NOW)
  assert.ok(!o2.health().findings.some((f) => f.desk === 'desk-ledger'))
})

test('a launch that came up and whose claude was gone within 30 s is "exited", not "up"', async () => {
  const o = office()
  let polls = 0
  const live = []
  const term = { titles: () => [], create: ({ title }) => { live.push({ pid: 5002, name: title, status: 'idle', sessionId: ID(9), cwd: null }); return 'term_y' }, screen: () => 'bye', answerImports: () => {} }
  const rows = await start(o.root, 'ledger', { live: () => { if (++polls > 6) live.length = 0; return live }, terminal: term, sleep: async () => {}, dir: o.claude, procs: () => new Map(), home: o.home })
  assert.equal(rows[0].state, 'exited', JSON.stringify(rows))
  assert.match(rows[0].why, /came up \(pid 5002\) and its claude exited within \d+s/)
  assert.ok(readLaunchFailures(o.root)['desk-ledger'])
})

test('⛔ RED means a desk or session problem: wrong folder and background job are red, with how to fix', () => {
  const o = office()
  o.live('desk-inventory', { pid: 801, cwd: o.root, transcript: true })
  o.live('desk-ledger', { pid: 802, kind: 'bg' })
  const h = o.health()
  const inv = h.findings.find((f) => f.desk === 'inventory')
  assert.ok(inv, JSON.stringify(h.findings))
  assert.match(inv.short, /runs outside its folder/)
  assert.match(inv.say, /lives under .*'s project, not its folder's, so reopening it in its folder starts from older context/)
  const bg = h.findings.find((f) => /background job/.test(f.short))
  assert.match(bg.say, /desk-ledger runs as a background job \(no terminal tab\), pid 802.*claude attach desk-ledger.*claude stop desk-ledger/)
  assert.equal(h.code, 4)
})

const DEPTS = { 'customer-service': { lead: 'AICS', aliases: ['lead'], desks: ['ledger'], dir: 'departments/aics' } }
function deptOffice() {
  const o = office({ desks: {}, machine: { departments: ['customer-service'] }, cfg: { departments: DEPTS, profiles: { aics: { department: 'customer-service' } }, launch: { lead: { resume: true, model: 'opus' } } } })
  mkdirSync(join(o.root, 'departments', 'aics', 'ledger'), { recursive: true })
  writeFileSync(join(o.root, 'departments', 'aics', 'ledger', 'desk.json'), JSON.stringify({ name: 'ledger', kind: 'knowledge', port: 9555 }))
  return o
}

test('⛔ start opens a department lead where its role does (its folder, its --settings), and says when its newest conversation is under the root', async () => {
  const o = deptOffice()
  const dept = join(o.root, 'departments', 'aics')
  convo(o.claude, dept, ID(1), ['AICS'], 11 * 86400)      // 11-09, in its folder
  convo(o.claude, o.root, ID(2), ['AICS'], 3600)          // today, the bg job at the root
  const live = [], made = []
  const term = { titles: () => [], create: ({ title, command }) => { made.push(command); live.push({ pid: 5003, name: title, status: 'idle', sessionId: ID(1), cwd: dept }); return 'term_l' }, screen: () => '', answerImports: () => {} }
  const rows = await start(o.root, 'AICS', { live: () => live, terminal: term, sleep: async () => {}, dir: o.claude, procs: () => new Map(), home: o.home })
  assert.equal(rows[0].state, 'up', JSON.stringify(rows))
  assert.match(made[0], new RegExp(`^cd '${dept}' && OFFICE_PROFILE=aics `))
  assert.match(made[0], /--settings '[^']*aics\.json'/)
  assert.match(made[0], /--model opus/)
  assert.match(made[0], new RegExp(`--resume ${ID(1)}`))
  assert.match(rows[0].why, new RegExp(`its newest conversation ${ID(2).slice(0, 8)} .* is under ${o.root}, not its folder ${dept}: resuming the older ${ID(1).slice(0, 8)}`))
})

test('health: a department lead at the root is red, and the line says its conversation lives under the root', () => {
  const o = deptOffice()
  o.live('AICS', { pid: 46133, cwd: o.root, transcript: true })
  const h = o.health()
  const f = h.findings.find((x) => x.desk === 'AICS' && /outside its folder/.test(x.short))
  assert.ok(f, JSON.stringify(h.findings))
  assert.match(f.say, /Its conversation 00000000 lives under .*, so reopening it in its folder starts from older context\. When it is idle: \/exit it, then node .*role\.mjs' '.*' open aics/)
  // in its folder: nothing to say
  const o2 = deptOffice()
  o2.live('AICS', { pid: 46134, cwd: join(o2.root, 'departments', 'aics') })
  assert.ok(!o2.health().findings.some((x) => /outside its folder/.test(x.short ?? '')))
})

test('⛔ 11-20 replay: a background job has no pid in the registry; the CLI\'s job list says it, and a second holder beside the tab is red', () => {
  const o = deptOffice()
  o.live('AICS', { pid: 80562, cwd: join(o.root, 'departments', 'aics') })
  // what `claude agents --json` printed that day (cut down); the other office's job is not this one's
  const background = [
    { id: '4aa2d5a6', name: 'AICS', cwd: o.root, state: 'blocked', sessionId: '4aa2d5a6-e673-4237-9e34-b77fd321ea54' },
    { id: 'ee0288ef', name: 'AICS', cwd: '/Volumes/Other/office', state: 'blocked' },
    { id: 'aaaa1111', name: 'someone-else', cwd: o.root, state: 'running' },
  ]
  // its process was ended (full, 11-20: `claude stop` could not confirm, the record stays "blocked"): a stale record, amber, not a holder
  let h = officeHealth(o.root, { home: o.home, procs: o.procs, now: NOW, checks: false, cwd: () => null, background })
  assert.ok(!h.findings.some((x) => /background/.test(x.short ?? '')), JSON.stringify(h.findings))
  const w = h.warnings.filter((x) => /background/.test(x.short ?? ''))
  assert.equal(w.length, 1, JSON.stringify(h.warnings))
  assert.match(w[0].short, /^stale background record 4aa2d5a6 \(no process\)$/)
  // a process runs it: red, a second holder beside the tab
  o.procs.set(86986, { pid: 86986, ppid: 1, ageSec: 3000, cmd: 'claude --bg-session 4aa2d5a6-e673-4237-9e34-b77fd321ea54' })
  h = officeHealth(o.root, { home: o.home, procs: o.procs, now: NOW, checks: false, cwd: () => null, background })
  const f = h.findings.filter((x) => /background job/.test(x.short ?? ''))
  assert.equal(f.length, 1, JSON.stringify(h.findings))
  assert.match(f[0].say, /AICS runs as a background job \(no terminal tab\), job 4aa2d5a6 \(blocked\) at .*two holders of one name\. Keep the one in the tab and stop the job: `claude stop 4aa2d5a6`/)
  // alone (no tab), its host up and the job working: attach, or stop and reopen as its role
  const o2 = deptOffice()
  o2.procs.set(86990, { pid: 86990, ppid: 1, ageSec: 3000, cmd: 'claude bg-pty-host --bg-pty-host /tmp/cc/x.sock' })
  const h2 = officeHealth(o2.root, { home: o2.home, procs: o2.procs, now: NOW, checks: false, cwd: () => null, background: [{ ...background[0], cwd: o2.root, state: 'running' }] })
  assert.match(h2.findings.find((x) => /background job/.test(x.short ?? '')).say, /claude attach 4aa2d5a6`, or, to restart it in its folder, `claude stop 4aa2d5a6` then node .*role\.mjs' '.*' open aics/)
})

test('/role refuses to open a second session on a conversation a live process holds', () => {
  const o = deptOffice()
  const dept = join(o.root, 'departments', 'aics')
  convo(o.claude, dept, ID(1), ['AICS'], 600)
  const prev = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = o.claude
  try {
    const made = []
    const term = { create: ({ command }) => { made.push(command); return 'term_r' }, all: () => [] }
    // held by a claude the registry does not list: refused, no tab
    const held = new Map([[44, { pid: 44, cmd: `claude --name AICS --resume ${ID(1)}` }]])
    const r = openRole(o.root, 'aics', { sessions: [], term, run: () => ({ status: 1 }), home: o.home, caller: { kind: 'owner' }, procs: held })
    assert.equal(r.state, 'refused', JSON.stringify(r))
    assert.match(r.why, new RegExp(`conversation ${ID(1)} is already open in pid 44`))
    assert.equal(made.length, 0)
    // nobody holds it: opened, resuming it
    const r2 = openRole(o.root, 'aics', { sessions: [], term, run: () => ({ status: 1 }), home: o.home, caller: { kind: 'owner' }, procs: new Map() })
    assert.equal(r2.state, 'opened', JSON.stringify(r2))
    assert.match(made[0], new RegExp(`--resume ${ID(1)}`))
  } finally { if (prev == null) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev }
})

test('⛔ 0.32.0: a lead started as its role keeps its own flags (--remote-control) and gets its boot lines as the first message on a resume', async () => {
  const o = office({ desks: {}, machine: { departments: ['customer-service'] }, cfg: { departments: DEPTS, profiles: { aics: { department: 'customer-service', flags: ['--remote-control'], resumePromptCommand: "printf 'Boot: reread LEAD.md\\nthen carry on'" } }, launch: { flags: ['--dangerously-skip-permissions'], lead: { resume: true, model: 'opus' } } } })
  const dept = join(o.root, 'departments', 'aics')
  mkdirSync(dept, { recursive: true })
  convo(o.claude, dept, ID(1), ['AICS'], 600)
  const live = [], made = []
  const term = { titles: () => [], create: ({ title, command }) => { made.push(command); live.push({ pid: 5004, name: title, status: 'busy', sessionId: ID(1), cwd: dept }); return 'term_l' }, screen: () => '', answerImports: () => {} }
  const rows = await start(o.root, 'AICS', { live: () => live, terminal: term, sleep: async () => {}, dir: o.claude, procs: () => new Map(), home: o.home })
  assert.equal(rows[0].state, 'up', JSON.stringify(rows))
  assert.match(made[0], / --remote-control /)
  assert.equal(made[0].match(/--dangerously-skip-permissions/g).length, 1, 'a flag is not repeated')
  assert.match(made[0], new RegExp(`--resume ${ID(1)} -- 'Boot: reread LEAD\\.md then carry on'$`))
  // the office typed it: never taken for the owner's words
  assert.match(readFileSync(join(o.root, '.office', 'office-typed.jsonl'), 'utf8'), /"hash"/)
  // a new conversation gets no resume prompt (the SessionStart boot text reaches it)
  const o2 = office({ desks: {}, machine: { departments: ['customer-service'] }, cfg: { departments: DEPTS, profiles: { aics: { department: 'customer-service', resumePrompt: 'Boot' } }, launch: { lead: { resume: true } } } })
  mkdirSync(join(o2.root, 'departments', 'aics'), { recursive: true })
  const made2 = []
  const term2 = { titles: () => [], create: ({ title, command }) => { made2.push(command); return 'term_2' }, screen: () => '', answerImports: () => {} }
  await start(o2.root, 'AICS', { live: () => [{ pid: 5005, name: 'AICS', status: 'idle', cwd: join(o2.root, 'departments', 'aics') }].filter(() => made2.length), terminal: term2, sleep: async () => {}, dir: o2.claude, procs: () => new Map(), home: o2.home })
  assert.doesNotMatch(made2[0], /Boot/)
})

test('a role flag that would start a background job, or is not a plain flag, makes the profile a problem, never a launch', () => {
  const root = mkdtempSync(join(tmpdir(), 'oa-rf-'))
  const cfg = { departments: DEPTS, profiles: { aics: { department: 'customer-service', flags: ['--bg'] }, erp: { session: 'x', flags: ['--x; rm -rf ~'] } } }
  writeFileSync(join(root, 'office.json'), JSON.stringify(cfg))
  return import('../lib/role.mjs').then(({ profilesOf }) => {
    const P = profilesOf(root, cfg)
    assert.equal(P.list.length, 0)
    assert.ok(P.problems.some((p) => /background job/.test(p)) && P.problems.some((p) => /not a plain --flag/.test(p)), JSON.stringify(P.problems))
  })
})

test('newerElsewhere: null when the chosen one is the newest; the root one when it is newer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oa-ne-'))
  convo(dir, '/office/departments/aics', ID(1), ['AICS'], 60)
  convo(dir, '/office', ID(2), ['AICS'], 600)
  assert.equal(newerElsewhere({ tag: 'AICS', cwd: '/office/departments/aics', elsewhere: ['/office'], chosen: ID(1), dir }), null)
  convo(dir, '/office', ID(3), ['AICS'], 5)
  assert.equal(newerElsewhere({ tag: 'AICS', cwd: '/office/departments/aics', elsewhere: ['/office'], chosen: ID(1), dir }).id, ID(3))
  // someone else's conversation at the root is not the lead's
  const dir2 = mkdtempSync(join(tmpdir(), 'oa-ne-'))
  convo(dir2, '/office', ID(4), ['full'], 5)
  assert.equal(newerElsewhere({ tag: 'AICS', cwd: '/office/departments/aics', elsewhere: ['/office'], chosen: null, dir: dir2 }), null)
})

test('⛔ a lead or desk is a tab, never a background job: --bg in office.json launch flags is refused', () => {
  assert.throws(() => launchConfig({ launch: { lead: { flags: ['--bg'] } } }), /background job/)
  assert.throws(() => launchConfig({ launch: { flags: ['--background'] } }), /background job/)
  assert.doesNotThrow(() => launchConfig({ launch: { flags: ['--dangerously-skip-permissions'] } }))
})

test('noteLaunch: written on a failure, removed on success, untouched without a root', () => {
  const o = office()
  noteLaunch(o.root, 'desk-a', 'launch of desk-a failed: x', NOW)
  assert.equal(readLaunchFailures(o.root)['desk-a'].why, 'launch of desk-a failed: x')
  noteLaunch(o.root, 'desk-a', null)
  assert.deepEqual(readLaunchFailures(o.root), {})
  noteLaunch(null, 'desk-a', 'x')
  assert.ok(existsSync(join(o.root, '.office', 'launch-failures.json')))
})
