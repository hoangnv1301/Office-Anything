// A SESSION WITH A DOORBELL ARMS IT WITHOUT ANYBODY TYPING (0.18.5). The
// watchdog started ERP (2026-10-23) and it sat idle with its bell unarmed,
// deaf to 71 open messages, until the lead messaged it. Now its start carries
// a kickoff as its first message, heal types the same line into a lead found
// unarmed, and health is red meanwhile. Nothing real is launched or typed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { start, KICKOFF, kickoffFor } from '../lib/start.mjs'
import { heal } from '../lib/heal.mjs'
import { officeHealth } from '../lib/health.mjs'

const PROMPT = ['⏺ Ready.', '', '────────', '❯ ', '────────'].join('\n')
function world({ lead = { session: 'ERP', wake: 'node bell.mjs' }, desks = { inventory: { wake: 'node wake.mjs' }, ledger: {} } } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oa-kick-'))
  for (const [n, extra] of Object.entries(desks)) {
    mkdirSync(join(root, 'desks', n), { recursive: true })
    writeFileSync(join(root, 'desks', n, 'desk.json'), JSON.stringify({ name: n, kind: 'knowledge', port: 9700 + n.length, ...extra }))
  }
  writeFileSync(join(root, 'office.json'), JSON.stringify({ roleEnv: 'OFFICE_ROLE', lead }))
  return { root, dir: mkdtempSync(join(tmpdir(), 'oa-kick-claude-')) }
}

test('⛔ start gives a lead or desk with a doorbell its kickoff as the first message; busy on it is up; no doorbell, no message', async () => {
  const w = world()
  const live = [], made = []
  // the CLI, given a first message, registers busy working on it
  const term = { titles: () => [], screen: () => '', answerImports: () => {}, create: ({ title, command }) => { made.push({ title, command }); live.push({ pid: 6000 + made.length, name: title, status: / 'Start your doorbell now/.test(command) ? 'busy' : 'idle', sessionId: '00000000-0000-4000-8000-0000000000' + String(made.length).padStart(2, '0'), cwd: w.root }); return 'h' + made.length } }
  const rows = await start(w.root, 'everything', { live: () => live, terminal: term, sleep: async () => {}, dir: w.dir })
  const by = Object.fromEntries(rows.map((r) => [r.tag, r]))
  assert.equal(by.ERP.state, 'up', by.ERP.why)
  assert.match(by.ERP.why, /given its first message/)
  assert.match(made.find((m) => m.title === 'ERP').command, / 'Start your doorbell now: Monitor \(timeout_ms 1800000\) running `node bell\.mjs`, and start it again every time it expires\. Then carry on as your instructions say\.'$/)
  assert.match(made.find((m) => m.title === 'desk-inventory').command, /running `node wake\.mjs`/)
  assert.doesNotMatch(made.find((m) => m.title === 'desk-ledger').command, /Start your doorbell/, 'no wake, no first message')
  assert.equal(kickoffFor(w.root, { lead: { session: 'X' } }, { isLead: true, tag: 'X' }), null)
})

// ⛔ the CLI as it really parses (0.18.8): --remote-control takes an optional
// [name], so a kickoff written right after it became the Remote Control name
// and ERP sat deaf while start said "given its first message"
const words = (cmd) => { const out = []; let cur = null; for (let i = 0; i < cmd.length; i++) { const c = cmd[i]; if (c === "'") { const j = cmd.indexOf("'", i + 1); cur = (cur ?? '') + cmd.slice(i + 1, j); i = j } else if (c === '\\') { cur = (cur ?? '') + cmd[++i] } else if (c === ' ') { if (cur != null) out.push(cur); cur = null } else cur = (cur ?? '') + c } if (cur != null) out.push(cur); return out }
const VALUE = new Set(['--name', '--model', '--settings', '--resume']), OPTIONAL = new Set(['--remote-control'])
function firstMessage(cmd) {
  const w = words(cmd.slice(cmd.indexOf(' claude ') + 1)).slice(1)
  for (let i = 0; i < w.length; i++) {
    if (w[i] === '--') return w[i + 1] ?? null
    if (VALUE.has(w[i])) { i++; continue }
    if (OPTIONAL.has(w[i])) { if (w[i + 1] != null && !w[i + 1].startsWith('-')) i++; continue }
    if (!w[i].startsWith('-')) return w[i]
  }
  return null
}
test('⛔ the kickoff reaches the CLI as its first message after any flag, even one with an optional value', async () => {
  const w = world({ desks: {} })
  writeFileSync(join(w.root, 'office.json'), JSON.stringify({ roleEnv: 'OFFICE_ROLE', lead: { session: 'ERP', wake: 'node bell.mjs' }, launch: { flags: ['--dangerously-skip-permissions'], lead: { flags: ['--remote-control'] } } }))
  const live = [], made = []
  const term = { titles: () => [], screen: () => '', answerImports: () => {}, create: ({ title, command }) => { made.push(command); live.push({ pid: 6100, name: title, status: firstMessage(command)?.startsWith('Start your doorbell') ? 'busy' : 'idle', sessionId: '00000000-0000-4000-8000-000000006100', cwd: w.root }); return 'h' } }
  const rows = await start(w.root, 'lead', { live: () => live, terminal: term, sleep: async () => {}, dir: w.dir })
  assert.equal(firstMessage(made[0]), KICKOFF('node bell.mjs'), made[0])
  assert.match(rows[0].why, /given its first message/)
  assert.equal(firstMessage("x && claude --name 'ERP' --remote-control 'Start your doorbell now'"), null, 'the stub is the CLI: written bare, the flag takes it')
})

test('⛔ start says "given its first message" only when it saw the session work on it', async () => {
  const w = world({ desks: {} })
  const live = []
  let t = 0
  const term = { titles: () => [], screen: () => '', answerImports: () => {}, create: ({ title }) => { live.push({ pid: 6200, name: title, status: 'idle', sessionId: '00000000-0000-4000-8000-000000006200', cwd: w.root }); return 'h' } }
  const rows = await start(w.root, 'lead', { live: () => live, terminal: term, sleep: async () => { t += 1000 }, now: () => t, dir: w.dir })
  assert.equal(rows[0].state, 'up')
  assert.doesNotMatch(rows[0].why, /given its first message/)
  assert.match(rows[0].why, /first message was not seen running/)
})

// heal: a lead found unarmed, idle at its prompt
function office({ status = 'idle', screen = PROMPT, tabs } = {}) {
  const w = world()
  const home = mkdtempSync(join(tmpdir(), 'oa-kick-home-'))
  mkdirSync(join(home, '.claude', 'sessions'), { recursive: true })
  const NOW = Date.now()
  const s = { pid: 7101, name: 'ERP', cwd: w.root, sessionId: '00000000-0000-4000-8000-000000007101', status, statusUpdatedAt: NOW - 60_000, updatedAt: NOW, startedAt: NOW - 11 * 60_000 }
  writeFileSync(join(home, '.claude', 'sessions', '7101.json'), JSON.stringify(s))
  const procs = new Map([[1, { pid: 1, ppid: 0, ageSec: 1e6, cmd: 'launchd' }], [7101, { pid: 7101, ppid: 1, ageSec: 11 * 60 + 5, cmd: 'claude --name ERP' }]])
  const typed = []
  const term = { all: () => tabs ?? [{ handle: 't-erp', title: '✳ ERP', agent: true, path: w.root }], titles: () => [], send: (h, text) => typed.push({ h, text }), screen: () => screen }
  const h = { leads: [{ name: 'ERP', label: 'ERP', wake: 'node bell.mjs', session: { pid: 7101, name: 'ERP' }, doorbell: { state: 'unarmed', sinceStartSec: 660 }, reach: [] }], desks: [], checks: [] }
  // the process ages with the clock, as a real one does
  const procsAt = (t) => new Map([...procs].map(([k, v]) => [k, k === 7101 ? { ...v, ageSec: v.ageSec + Math.round((t - NOW) / 1000) } : v]))
  const run = (t = NOW) => heal(w.root, h, { home, now: t, kill: () => {}, freshProcs: () => procsAt(t), cwd: () => null, terminal: term })
  return { w, home, procs, typed, run, NOW }
}

test('⛔ heal types the kickoff into a lead found unarmed, once per 30 minutes, only at an empty prompt', () => {
  const o = office()
  const r = o.run()
  assert.deepEqual(o.typed, [{ h: 't-erp', text: KICKOFF('node bell.mjs') }])
  assert.ok(r.acts.some((a) => a.act === 'bell-kick' && a.ok))
  o.run(o.NOW + 10 * 60_000)
  assert.equal(o.typed.length, 1, 'not again within 30 minutes')
  o.run(o.NOW + 31 * 60_000)
  assert.equal(o.typed.length, 2, 'still unarmed half an hour later: once more')
  for (const [label, opt, why] of [['busy', { status: 'busy' }, /busy/], ['a menu', { screen: 'What do you want to do?\n❯ 1. Yes\n2. No' }, /prompt is not on screen/], ['no tab', { tabs: [] }, /no tab titled ERP/]]) {
    const x = office(opt)
    const rr = x.run()
    assert.equal(x.typed.length, 0, label)
    assert.match(rr.acts.find((a) => a.act === 'bell-kick').why, why, label)
  }
})

test('⛔ health is red while a lead that has been up 10 minutes has no doorbell', () => {
  const o = office()
  const h = officeHealth(o.w.root, { home: o.home, procs: o.procs, now: o.NOW, checks: false, cwd: () => null })
  assert.equal(h.code, 4)
  assert.match(h.line, /ERP doorbell unarmed|lead doorbell unarmed/)
  assert.equal(h.leads[0].doorbell.state, 'unarmed')
})
