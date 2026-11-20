// A DESK WHOSE CLAUDE EXITED LEAVES NO SHELL BEHIND, AND COMES BACK ON ITS OWN MODEL (0.28.2).
// David, 2026-11-16: "the office desk session sometimes be closed, but the
// terminal still open". His design-quotation tab showed claude's exit line
// ("Resume this session with: claude --model sonnet … --resume …") over a zsh
// prompt, and nothing restarted the desk. Seen the same way on the owner's Mac:
// heal's idle-close stopped desk-customer at 2026-11-15T06:28:47Z and its tab,
// which Orca listed as "orphaned", stayed at the prompt; the closers only
// looked at the tabs Orca does not call orphaned, and swallowed every failure.
//   - every closer looks at orphaned tabs too, and heal.log says what became of the tab
//   - health lists a desk's tab left at a shell prompt; heal closes it on a fresh look
//   - a desk's own session runs on desk.json "mainModel" ("model" is its case runs')
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { officeHealth } from '../lib/health.mjs'
import { heal } from '../lib/heal.mjs'
import { strayTabs, STRAY_QUIET_MS } from '../lib/procs.mjs'
import { closeStaleTabs, tabsSaid, orcaTerminal, targetsOf, launchCommand, start } from '../lib/start.mjs'
import { projectDirOf } from '../lib/conversation.mjs'

const NOW = Date.now()
const MIN = 60_000
const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..')

function office({ cfg = {}, desks = { inventory: {}, ledger: {} } } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oa-exit-'))
  const home = mkdtempSync(join(tmpdir(), 'oa-exit-home-'))
  mkdirSync(join(home, '.claude', 'sessions'), { recursive: true })
  for (const [n, extra] of Object.entries(desks)) {
    mkdirSync(join(root, 'desks', n), { recursive: true })
    writeFileSync(join(root, 'desks', n, 'desk.json'), JSON.stringify({ name: n, kind: 'knowledge', port: 9400 + n.length, ...extra }))
  }
  writeFileSync(join(root, 'work.txt'), '')
  writeFileSync(join(root, 'office.json'), JSON.stringify({ roleEnv: 'OFFICE_ROLE', start: 'echo started {desk} >> started.txt', openWork: 'cat work.txt', closeWhenIdle: { inventory: 30 }, ...cfg }))
  // never empty: an empty table makes liveSessions ask the real machine about the pid
  const procs = new Map([[1, { pid: 1, ppid: 0, ageSec: 1e6, cmd: 'launchd' }]])
  const live = (name, { pid = 700, idleMin = 40, status = 'idle' } = {}) => {
    const cwd = join(root, 'desks', name)
    const sid = `00000000-0000-4000-8000-00000000${pid}`
    writeFileSync(join(home, '.claude', 'sessions', `${pid}.json`), JSON.stringify({ pid, name: 'desk-' + name, cwd, sessionId: sid, status, statusUpdatedAt: NOW - idleMin * MIN, startedAt: NOW - 7200_000 }))
    procs.set(pid, { pid, ppid: 1, ageSec: 7200, cmd: `claude --name desk-${name}` })
    const p = projectDirOf(cwd, join(home, '.claude'))
    mkdirSync(p, { recursive: true })
    const f = join(p, sid + '.jsonl')
    writeFileSync(f, JSON.stringify({ type: 'assistant', timestamp: new Date(NOW - idleMin * MIN).toISOString(), message: { content: [{ type: 'tool_use', id: 'x', name: 'Read', input: {} }] } }) + '\n')
    utimesSync(f, new Date(NOW - idleMin * MIN), new Date(NOW - idleMin * MIN))
  }
  const health = (terminal = null) => officeHealth(root, { home, procs, now: NOW, checks: false, cwd: () => null, terminal })
  const row = (h, name) => h.desks.find((d) => d.name === name)
  return { root, home, procs, live, health, row }
}
// a terminal like Orca's: orphaned tabs only when asked for, close removes the tab
function fakeTerm(tabs, { closeFails = false } = {}) {
  const closed = [], asked = []
  return {
    closed, asked, tabs,
    titles: ({ orphaned = false } = {}) => { asked.push(orphaned); return tabs.filter((t) => orphaned || !t.orphaned) },
    close: (h) => { if (closeFails) throw new Error('orca: terminal not found'); closed.push(h); const i = tabs.findIndex((t) => t.handle === h); if (i >= 0) tabs.splice(i, 1) },
  }
}
const healOpts = (o, extra = {}) => ({ home: o.home, now: NOW, kill: () => {}, freshProcs: () => o.procs, cwd: () => null, terminal: fakeTerm([]), ...extra })
const healLog = (root) => readFileSync(join(root, '.office', 'heal.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const shell = (handle, title, extra = {}) => ({ handle, title, agent: false, orphaned: true, quietMs: 30 * MIN, ...extra })

test('⛔ the Orca adapter lists orphaned tabs only when a closer asks, with how long each has been quiet', () => {
  const list = { result: { terminals: [
    { handle: 'term_live', title: '✳ desk-inventory', connected: true, orphaned: false, agentIdentity: { kind: 'claude' }, lastOutputAt: Date.now() },
    { handle: 'term_shell', title: 'desk-customer', connected: true, orphaned: true, agentIdentity: null, lastOutputAt: Date.now() - 10 * MIN },
    { handle: 'term_gone', title: 'desk-ledger', connected: false, orphaned: true },
  ] } }
  const run = (_bin, args) => JSON.stringify(args[0] === 'worktree' ? { result: { worktrees: [{ path: '/office' }] } } : list)
  const term = orcaTerminal('/office', run)
  assert.deepEqual(term.titles().map((t) => t.handle), ['term_live'], 'typing paths see the tabs Orca holds, as before')
  const all = term.titles({ orphaned: true })
  assert.deepEqual(all.map((t) => t.handle), ['term_live', 'term_shell'])
  const s = all.find((t) => t.handle === 'term_shell')
  assert.equal(s.agent, false); assert.equal(s.orphaned, true); assert.equal(s.title, 'desk-customer')
  assert.ok(s.quietMs >= 10 * MIN - 1000 && s.quietMs < 11 * MIN, String(s.quietMs))
})

test('closeStaleTabs: an orphaned tab at a shell is closed; one with an agent is left unless the closer just stopped it; failures are said', () => {
  const tabs = [shell('term_a', 'desk-customer'), { handle: 'term_b', title: 'desk-customer', agent: true, orphaned: false }, shell('term_c', 'desk-other')]
  let t = fakeTerm([...tabs])
  let c = closeStaleTabs(t, (x) => x === 'desk-customer')
  assert.deepEqual(c.closed, ['term_a']); assert.equal(c.running, 1)
  assert.match(tabsSaid(c), /closed its tab term_a; 1 tab\(s\) under its name still show an agent/)
  t = fakeTerm([...tabs])
  c = closeStaleTabs(t, (x) => x === 'desk-customer', { evenWithAgent: true })
  assert.deepEqual(c.closed, ['term_a', 'term_b'])
  t = fakeTerm([...tabs], { closeFails: true })
  c = closeStaleTabs(t, (x) => x === 'desk-customer')
  assert.match(tabsSaid(c), /could not close term_a \(orca: terminal not found\)/)
  assert.match(tabsSaid(closeStaleTabs(null, () => true)), /no terminal adapter/)
  assert.equal(tabsSaid(closeStaleTabs(fakeTerm([]), () => true)), 'no tab under its name')
})

test('⛔ idle-close closes the desk\'s tab though Orca calls it orphaned, and heal.log says so', () => {
  const o = office()
  o.live('inventory')
  const killed = []
  const terminal = fakeTerm([{ handle: 'term_inv', title: 'desk-inventory', agent: true, orphaned: true }, shell('term_old', 'desk-inventory')])
  heal(o.root, o.health(), healOpts(o, { kill: (p) => killed.push(p), terminal }))
  assert.deepEqual(killed, [700])
  assert.deepEqual(terminal.closed.sort(), ['term_inv', 'term_old'])
  const line = healLog(o.root).find((a) => a.act === 'idle-close')
  assert.equal(line.ok, true)
  assert.match(line.tab, /closed its tab term_inv, term_old/)
  // a close that fails is no longer silent
  const o2 = office(); o2.live('inventory')
  heal(o2.root, o2.health(), healOpts(o2, { terminal: fakeTerm([{ handle: 'term_x', title: 'desk-inventory', agent: true, orphaned: true }], { closeFails: true }) }))
  assert.match(healLog(o2.root).find((a) => a.act === 'idle-close').tab, /could not close term_x/)
})

test('strayTabs: no session, no claude launching under its names, no agent, quiet two minutes: all four, or it is no stray', () => {
  const names = ['desk-inventory', 'inventory']
  const tab = shell('term_s', 'desk-inventory')
  const procs = new Map([[1, { pid: 1, cmd: 'launchd' }]])
  assert.deepEqual(strayTabs(names, [tab], [], procs).map((t) => t.handle), ['term_s'])
  assert.deepEqual(strayTabs(names, [tab], [{ name: 'desk-inventory', pid: 9 }], procs), [], 'its session is live')
  assert.deepEqual(strayTabs(names, [tab], [], new Map([[9, { pid: 9, cmd: "claude --name 'desk-inventory' --model opus" }]])), [], 'a claude is launching under its name')
  assert.deepEqual(strayTabs(names, [{ ...tab, agent: true }], [], procs), [], 'an agent runs in it')
  assert.deepEqual(strayTabs(names, [{ ...tab, agent: undefined }], [], procs), [], 'a terminal that cannot say')
  assert.deepEqual(strayTabs(names, [{ ...tab, quietMs: STRAY_QUIET_MS - 1 }], [], procs), [], 'still printing')
  assert.deepEqual(strayTabs(names, [{ ...tab, quietMs: null }], [], procs), [], 'quiet unknown')
  assert.deepEqual(strayTabs(names, [{ ...tab, title: 'desk-inventory--SO-1' }], [], procs), [], 'a case tab is not the desk\'s')
})

test('⛔ health: a dead desk whose tab sits at a shell prompt says so; heal closes the tab on a fresh look and restarts the desk', () => {
  const o = office()
  o.live('inventory', { idleMin: 1 })
  const terminal = fakeTerm([shell('term_ledger', 'desk-ledger')])
  const h = o.health(terminal)
  const r = o.row(h, 'ledger')
  assert.equal(r.session.state, 'dead')
  assert.deepEqual(r.strays.map((x) => x.handle), ['term_ledger'])
  assert.ok(h.findings.some((f) => f.desk === 'ledger' && /term_ledger is at a shell prompt/.test(f.say)), JSON.stringify(h.findings))
  assert.equal(o.row(h, 'inventory').strays, undefined, 'a live desk has no stray')
  const res = heal(o.root, h, healOpts(o, { terminal }))
  assert.deepEqual(terminal.closed, ['term_ledger'])
  const close = res.acts.find((a) => a.act === 'stray-tab')
  assert.ok(close?.ok, JSON.stringify(res.acts))
  assert.match(close.why, /closed term_ledger "desk-ledger": at a shell prompt, quiet 30 min, its claude had exited \(Orca: orphaned\)/)
  assert.ok(res.acts.some((a) => a.act === 'restart' && a.desk === 'ledger' && a.ok), JSON.stringify(res.acts))
  assert.match(readFileSync(join(o.root, 'started.txt'), 'utf8'), /started ledger/)
})

test('heal leaves a "stray" alone when the fresh look disagrees, or a start was moments ago', () => {
  // between health and heal, a claude came up in it
  let o = office()
  let terminal = fakeTerm([shell('term_ledger', 'desk-ledger')])
  let h = o.health(terminal)
  terminal.tabs[0].agent = true
  let res = heal(o.root, h, healOpts(o, { terminal }))
  assert.deepEqual(terminal.closed, [])
  assert.match(res.acts.find((a) => a.act === 'stray-tab').why, /not a stray on a fresh look/)
  // started 30 s ago: its tab may still be launching
  o = office()
  terminal = fakeTerm([shell('term_ledger', 'desk-ledger')])
  h = o.health(terminal)
  mkdirSync(join(o.root, '.office'), { recursive: true })
  writeFileSync(join(o.root, '.office', 'heal-state.json'), JSON.stringify({ heals: {}, notified: {}, restarted: { ledger: NOW - 30_000 }, down: {} }))
  res = heal(o.root, h, healOpts(o, { terminal }))
  assert.deepEqual(terminal.closed, [])
  assert.match(res.acts.find((a) => a.act === 'stray-tab').why, /started 30s ago/)
})

test('an idled desk\'s tab left at a shell is closed and it stays idled: closeWhenIdle is not undone', () => {
  const o = office()
  o.live('inventory')
  heal(o.root, o.health(), healOpts(o))             // idle-close; its tab close found nothing (the fake lists none)
  o.procs.delete(700)
  const terminal = fakeTerm([shell('term_inv', 'desk-inventory')])
  const h = o.health(terminal)
  assert.equal(o.row(h, 'inventory').session.state, 'idled')
  assert.match(h.line, /amber: .*desk-inventory old tab term_inv at a shell prompt \(idled\)/)
  assert.ok(h.warnings.some((w) => w.desk === 'desk-inventory') && !h.findings.some((f) => f.desk === 'desk-inventory'), 'a stray tab is amber, never red')
  const res = heal(o.root, h, healOpts(o, { terminal }))
  assert.deepEqual(terminal.closed, ['term_inv'])
  assert.ok(!res.acts.some((a) => (a.act === 'restart' || a.act === 'wake') && a.desk === 'inventory'), JSON.stringify(res.acts))
})

test('⛔ start closes EVERY stale tab under the desk\'s names, orphaned ones too, then opens a fresh one', async () => {
  const o = office()
  const live = []
  const tabs = [shell('term_1', 'desk-ledger'), shell('term_2', 'desk-ledger', { orphaned: false })]
  const term = { ...fakeTerm(tabs), create: ({ title }) => { live.push({ pid: 5001, name: title, status: 'idle', sessionId: '00000000-0000-4000-8000-000000000099', cwd: null }); return 'term_new' }, screen: () => '', answerImports: () => {} }
  term.close = (h) => { term.closed.push(h); const i = tabs.findIndex((t) => t.handle === h); if (i >= 0) tabs.splice(i, 1) }
  const rows = await start(o.root, 'ledger', { live: () => live, terminal: term, sleep: async () => {}, dir: join(o.home, '.claude') })
  assert.equal(rows[0].state, 'up', JSON.stringify(rows))
  assert.deepEqual(term.closed.sort(), ['term_1', 'term_2'])
  assert.match(rows[0].why, /stale tab term_1, term_2/)
})

test('⛔ a desk\'s own session launches on desk.json "mainModel"; "model" stays its case runs\'; neither falls back to launch.model', () => {
  const o = office({ cfg: { launch: { model: 'sonnet', flags: ['--dangerously-skip-permissions'] } }, desks: { quotes: { model: 'sonnet', mainModel: 'opus', perCase: { kind: 'job', key: '^J-\\d+$' } }, ledger: { model: 'haiku' }, plain: {} } })
  const cfg = JSON.parse(readFileSync(join(o.root, 'office.json'), 'utf8'))
  const model = (n) => targetsOf(o.root, cfg, n)[0].model
  assert.equal(model('quotes'), 'opus')
  assert.equal(model('ledger'), 'haiku')
  assert.equal(model('plain'), null)
  assert.match(launchCommand({ cfg, target: targetsOf(o.root, cfg, 'quotes')[0] }), /claude --name 'desk-quotes' --model opus /)
  assert.match(launchCommand({ cfg, target: targetsOf(o.root, cfg, 'plain')[0] }), /--model sonnet /)
  // the case runs keep desk.json "model" (lib/cases.mjs builds its target from desk.model)
  assert.match(readFileSync(join(PLUGIN, 'lib', 'cases.mjs'), 'utf8'), /model: desk\.model \?\? null/)
  // a mainModel that is not a model name is refused, never put on a command line
  const bad = office({ desks: { quotes: { mainModel: 'opus; rm -rf ~' } } })
  const bcfg = JSON.parse(readFileSync(join(bad.root, 'office.json'), 'utf8'))
  assert.throws(() => launchCommand({ cfg: bcfg, target: targetsOf(bad.root, bcfg, 'quotes')[0] }), /not a model name/)
})
