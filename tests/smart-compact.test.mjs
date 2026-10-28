// SMART COMPACT (0.21.0). A cheap watcher picks fat, idle desks and leads; a
// small model reads the tail and says whether to compact and what to keep;
// the keep line is typed as /compact <keep>. Dry run by default.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { smartConfig, smartLive, smartVerdict, sessionTail, keepLine, judge, smartPass, panelItems, readLog, condensedTail, PROMPT_FILE, KEEP_MAX } from '../lib/smart-compact.mjs'
import { officeHealth } from '../lib/health.mjs'
import { panelsOf } from '../board/serve.mjs'
import { projectDirOf } from '../lib/conversation.mjs'

const NOW = Date.now()
const MIN = 60_000
const PROMPT = ['⏺ Done.', '', '────────', '❯ ', '────────'].join('\n')
const TYPING = ['⏺ Done.', '', '────────', '❯ half a messa', '────────'].join('\n')

function office(smart = { enable: true }, extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oa-smart-'))
  const home = mkdtempSync(join(tmpdir(), 'oa-smart-home-'))
  mkdirSync(join(home, '.claude', 'sessions'), { recursive: true })
  mkdirSync(join(root, 'desks', 'inventory'), { recursive: true })
  writeFileSync(join(root, 'desks', 'inventory', 'desk.json'), JSON.stringify({ name: 'inventory', kind: 'knowledge', port: 9701 }))
  writeFileSync(join(root, 'office.json'), JSON.stringify({ lead: { session: 'Office Lead' }, context: { capTokens: 300_000 }, compact: { smart }, ...extra }))
  const procs = new Map([[1, { pid: 1, ppid: 0, ageSec: 1e6, cmd: 'launchd' }]])
  const live = (name, cwd, pid, { idleMin = 45, ctx = 200_000, status = 'idle', pending = false, queued = 0, tool = null, boundaryAfter = null } = {}) => {
    const sid = `00000000-0000-4000-8000-00000000${pid}`
    writeFileSync(join(home, '.claude', 'sessions', `${pid}.json`), JSON.stringify({ pid, name, cwd, sessionId: sid, status, statusUpdatedAt: NOW - idleMin * MIN, updatedAt: NOW, startedAt: NOW - 7200_000 }))
    procs.set(pid, { pid, ppid: 1, ageSec: 7200, cmd: `claude --name ${name}` })
    const p = projectDirOf(cwd, join(home, '.claude'))
    mkdirSync(p, { recursive: true })
    const at = new Date(NOW - idleMin * MIN).toISOString()
    const content = pending ? [{ type: 'tool_use', id: 'q', name: 'AskUserQuestion', input: {} }] : tool ? [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: tool } }] : [{ type: 'text', text: 'Saved the reply for buyer B-17. Standing by.' }]
    const turns = [
      { type: 'user', timestamp: at, message: { content: 'draft a reply to B-17, $4,200 was quoted' } },
      { type: 'assistant', timestamp: at, message: { usage: { input_tokens: 2, cache_read_input_tokens: ctx - 1002, cache_creation_input_tokens: 1000 }, content } },
      ...(tool && !pending ? [{ type: 'user', timestamp: at, message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'queued' }] } }, { type: 'assistant', timestamp: at, message: { usage: { input_tokens: 2, cache_read_input_tokens: ctx - 1002, cache_creation_input_tokens: 1000 }, content: [{ type: 'text', text: 'Queued.' }] } }] : []),
      ...Array.from({ length: queued }, () => ({ type: 'queue-operation', operation: 'enqueue', timestamp: at, content: 'WAKE' })),
      ...(boundaryAfter != null ? [{ type: 'system', subtype: 'compact_boundary', timestamp: at, compactMetadata: { trigger: 'auto', preTokens: ctx, postTokens: boundaryAfter } }] : []),
    ]
    writeFileSync(join(p, sid + '.jsonl'), turns.map((t) => JSON.stringify(t)).join('\n') + '\n')
    return JSON.parse(readFileSync(join(home, '.claude', 'sessions', `${pid}.json`), 'utf8'))
  }
  const typed = []
  const term = (screen = PROMPT, titles = [{ handle: 't-inv', title: 'desk-inventory' }, { handle: 't-lead', title: 'Office Lead' }]) => ({ titles: () => titles, send: (h, text) => typed.push({ h, text }), screen: () => screen })
  const asks = []
  const answer = (o) => (cmd, args, opt) => { asks.push({ cmd, args, input: opt.input, cwd: opt.cwd }); return { status: 0, stdout: JSON.stringify({ is_error: false, total_cost_usd: 0.0012, usage: { input_tokens: 10, cache_creation_input_tokens: 5000, output_tokens: 200 }, structured_output: o }) } }
  const pass = (o = {}) => smartPass(root, { home, procs, freshProcs: () => procs, now: NOW, force: true, terminal: term(o.screen, o.titles), run: o.run ?? answer({ compact_now: true, reason: 'between jobs', keep: 'Keep: buyer B-17, $4,200 quoted, waiting on his reply; Drop: tool output.' }), ...o })
  return { root, home, procs, live, typed, asks, answer, pass, desk: join(root, 'desks', 'inventory') }
}

test('config: off unless compact.smart.enable is true; dry run unless dry_run is false; the lead is stricter', () => {
  assert.equal(smartConfig({}), null)
  assert.equal(smartConfig({ compact: { smart: {} } }), null)
  assert.equal(smartConfig({ compact: { smart: { enable: 'yes' } } }), null)
  const c = smartConfig({ compact: { smart: { enable: true } } })
  assert.equal(c.dryRun, true, 'dry run is the default')
  assert.equal(c.model, 'claude-haiku-5-5')
  assert.ok(c.lead.ratio > c.desk.ratio && c.lead.minK > c.desk.minK && c.lead.idleMin > c.desk.idleMin, 'the lead needs more before it is asked')
  assert.equal(smartConfig({ compact: { smart: { enable: true, dry_run: false } } }).dryRun, false)
  assert.equal(smartLive({ compact: { smart: { enable: true } } }), false)
  assert.equal(smartLive({ compact: { smart: { enable: true, dry_run: false } } }), true)
  assert.equal(smartConfig({ compact: { smart: { enable: true, model: 'x; rm -rf /' } } }).model, 'claude-haiku-5-5', 'a model name is a word, never a command')
  assert.equal(smartConfig({ compact: { smart: { enable: true, desk: { ratio: 7 } } } }).desk.ratio, 0.4, 'out of range is the default')
})

test('the gates: size against the session\'s OWN window, idle, nothing open, nothing queued, once per everyHours, asking rate-limited', () => {
  const conf = smartConfig({ compact: { smart: { enable: true, doneMatch: 'queue-draft', doneIdleMin: 3 } } })
  const x = (o = {}) => ({ role: 'desk', status: 'idle', idleSince: NOW - 45 * MIN, max: 500_000, tail: { ctx: 250_000, pending: false, queued: 0, lastTools: [], lastAt: NOW - 45 * MIN, ...(o.tail ?? {}) }, ...o, ...(o.tail ? { tail: { ctx: 250_000, pending: false, queued: 0, lastTools: [], lastAt: NOW - 45 * MIN, ...o.tail } } : {}) })
  assert.equal(smartVerdict(conf, x(), { now: NOW }).verdict, 'ask')
  // the same 150K is small in a 500K window and large in a 200K one
  assert.match(smartVerdict(conf, x({ tail: { ctx: 150_000 } }), { now: NOW }).why, /150K of 500K, under 200K/)
  assert.equal(smartVerdict(conf, x({ max: 200_000, tail: { ctx: 150_000 } }), { now: NOW }).verdict, 'ask')
  // the lead: a larger share of its window
  assert.match(smartVerdict(conf, x({ role: 'lead' }), { now: NOW }).why, /under 300K/)
  assert.match(smartVerdict(conf, x({ status: 'busy', idleSince: null }), { now: NOW }).why, /running a turn/)
  assert.match(smartVerdict(conf, x({ tail: { pending: true } }), { now: NOW }).why, /tool call or question is open/)
  assert.match(smartVerdict(conf, x({ tail: { queued: 2 } }), { now: NOW }).why, /2 message\(s\) queued/)
  assert.match(smartVerdict(conf, x({ idleSince: NOW - 5 * MIN, tail: { lastAt: NOW - 5 * MIN } }), { now: NOW }).why, /idle 5 of 20 min/)
  // a unit of work just finished: the short idle is enough
  assert.equal(smartVerdict(conf, x({ idleSince: NOW - 5 * MIN, tail: { lastAt: NOW - 5 * MIN, lastTools: ['Bash {"command":"queue-draft B-17"}'] } }), { now: NOW }).verdict, 'ask')
  assert.match(smartVerdict(conf, x(), { now: NOW, lastSent: NOW - 60 * MIN }).why, /compacted 60 min ago \(once per 4 h\)/)
  assert.match(smartVerdict(conf, x(), { now: NOW, asked: { at: NOW - 20 * MIN, ctx: 240_000 } }).why, /judge said no 20 min ago/)
  assert.equal(smartVerdict(conf, x(), { now: NOW, asked: { at: NOW - 20 * MIN, ctx: 200_000 } }).verdict, 'ask', 'grown 25% since: asked again')
})

test('⛔ a compaction after the last turn IS the size now (Claude Code compacts idle sessions itself)', () => {
  const o = office()
  const s = o.live('desk-inventory', o.desk, 801, { ctx: 207_000, boundaryAfter: 20_000 })
  assert.equal(sessionTail(o.home, s).ctx, 20_000)
  const q = o.live('desk-inventory', o.desk, 802, { ctx: 207_000, queued: 2 })
  assert.equal(sessionTail(o.home, q).queued, 2)
})

test('keep: one line (a newline would press Enter half way), no control characters, cut at a word', () => {
  assert.equal(keepLine('Keep: B-17\nDrop: logs\u001b[B'), 'Keep: B-17 Drop: logs [B')
  const long = keepLine('word '.repeat(400), 200)
  assert.ok(long.length <= 200 && !long.endsWith(' '))
  assert.ok(keepLine('x'.repeat(5000)).length <= KEEP_MAX)
})

test('the judge: runs outside the office with no tools, reads the prompt file; any doubt is a no', () => {
  const conf = smartConfig({ compact: { smart: { enable: true } } })
  const seen = []
  const ok = judge(conf, 'Session: desk-inventory', 'tail', { run: (cmd, args, opt) => { seen.push({ cmd, args, opt }); return { status: 0, stdout: JSON.stringify({ total_cost_usd: 0.001, usage: { input_tokens: 5, output_tokens: 9 }, structured_output: { compact_now: true, reason: 'done', keep: 'Keep: buyer B-17 and the $4,200 quote.\nDrop: logs' } }) } } })
  assert.equal(ok.compact_now, true)
  assert.equal(ok.keep, 'Keep: buyer B-17 and the $4,200 quote. Drop: logs')
  assert.equal(ok.cost, 0.001)
  const a = seen[0].args
  assert.equal(seen[0].cmd, 'claude')
  for (const f of ['-p', '--no-session-persistence', '--strict-mcp-config', '--json-schema']) assert.ok(a.includes(f), f)
  assert.equal(a[a.indexOf('--tools') + 1], '', 'no tools')
  assert.equal(a[a.indexOf('--setting-sources') + 1], '', 'no office settings or hooks')
  assert.equal(a[a.indexOf('--system-prompt-file') + 1], PROMPT_FILE)
  assert.ok(existsSync(PROMPT_FILE))
  assert.ok(!seen[0].opt.cwd.startsWith(process.cwd()), 'never inside the office')
  const no = (r) => judge(conf, 'h', 't', { run: () => r })
  assert.equal(no({ error: Object.assign(new Error('t'), { code: 'ETIMEDOUT' }) }).compact_now, false)
  assert.equal(no({ status: 1, stdout: 'not json' }).compact_now, false)
  assert.equal(no({ status: 0, stdout: JSON.stringify({ is_error: true, result: 'overloaded' }) }).compact_now, false)
  assert.equal(no({ status: 0, stdout: JSON.stringify({ structured_output: { compact_now: 'yes' } }) }).compact_now, false)
  assert.match(no({ status: 0, stdout: JSON.stringify({ structured_output: { compact_now: true, reason: 'r', keep: '' } }) }).why, /no keep instruction/)
})

test('⛔ dry run (the default): the judge is asked and the decision logged, nothing is typed', () => {
  const o = office()
  o.live('desk-inventory', o.desk, 811, { ctx: 250_000 })
  const r = o.pass()
  assert.equal(r.ran, true)
  assert.equal(o.typed.length, 0)
  assert.equal(o.asks.length, 1)
  assert.match(o.asks[0].input, /Session: desk-inventory\nRole: desk\nContext: 250K tokens of its 300K maximum/)
  assert.match(o.asks[0].input, /B-17/, 'the tail reaches the judge')
  const d = readLog(o.root).at(-1)
  assert.equal(d.decision, 'would-compact')
  assert.equal(d.dryRun, true)
  assert.match(d.keep, /B-17/)
  assert.equal(d.judge.cost_usd, 0.0012)
  assert.match(panelItems(o.root)[0].title, /would-compact \(dry run\) at 250K of 300K/)
})

test('⛔ live: /compact <keep> typed once into the session\'s own tab, then not again within everyHours', () => {
  const o = office({ enable: true, dry_run: false })
  o.live('desk-inventory', o.desk, 821, { ctx: 250_000 })
  o.pass()
  assert.deepEqual(o.typed, [{ h: 't-inv', text: '/compact Keep: buyer B-17, $4,200 quoted, waiting on his reply; Drop: tool output.' }])
  assert.equal(readLog(o.root).at(-1).sent, true)
  o.typed.length = 0
  const again = o.pass()
  assert.equal(o.typed.length, 0)
  assert.match(again.decisions[0].reason, /compacted 0 min ago/)
})

test('⛔ never over the input line, never a guessed tab, a judge "no" types nothing', () => {
  const o = office({ enable: true, dry_run: false })
  o.live('desk-inventory', o.desk, 831, { ctx: 250_000 })
  o.pass({ screen: TYPING })
  assert.equal(o.typed.length, 0)
  assert.equal(o.asks.length, 0, 'a screen that is not empty costs no model call')
  assert.match(readLog(o.root).at(-1).reason, /input line is not seen empty/)
  o.pass({ titles: [{ handle: 'a', title: 'desk-inventory' }, { handle: 'b', title: 'desk-inventory' }] })
  assert.equal(o.typed.length, 0)
  assert.match(readLog(o.root).at(-1).reason, /2 tabs are titled desk-inventory/)
  o.pass({ run: o.answer({ compact_now: false, reason: 'mid-task: a draft is half written', keep: '' }) })
  assert.equal(o.typed.length, 0)
  assert.equal(readLog(o.root).at(-1).decision, 'no')
})

test('only desks and leads: a teammate (<desk>--<key>) and a stranger session are never judged', () => {
  const o = office()
  o.live('desk-inventory--B-17', o.desk, 841, { ctx: 290_000 })
  o.live('someone', o.root, 842, { ctx: 290_000, idleMin: 300 })
  o.live('Office Lead', o.root, 843, { ctx: 290_000, idleMin: 300 })
  const r = o.pass()
  assert.deepEqual(r.decisions.map((d) => d.session), ['Office Lead'])
})

test('cadence: a pass runs every everyMin, not every watchdog tick', () => {
  const o = office({ enable: true, everyMin: 12 })
  assert.equal(o.pass().ran, true)
  const r = o.pass({ force: false, now: NOW + 5 * MIN })
  assert.equal(r.ran, false)
  assert.match(r.why, /not due/)
})

test('the tail the judge reads starts after the last compaction and cuts tool output', () => {
  const o = office()
  const s = o.live('desk-inventory', o.desk, 851, { ctx: 250_000, tool: 'queue-draft B-17' })
  const t = condensedTail(o.home, s)
  assert.match(t, /USER: draft a reply to B-17/)
  assert.match(t, /TOOL Bash: \{"command":"queue-draft B-17"\}/)
  assert.match(t, /RESULT: queued/)
})

test('⛔ one compactor: while smart compact types, the fixed-focus compact steps aside; in a dry run it carries on', () => {
  const run = (smart) => {
    const o = office(smart, {})
    writeFileSync(join(o.root, 'office.json'), JSON.stringify({ lead: { session: 'Office Lead' }, compact: { aboveK: 150, smart } }))
    o.live('desk-inventory', o.desk, 861, { ctx: 400_000 })
    return officeHealth(o.root, { home: o.home, procs: o.procs, now: NOW, checks: false, cwd: () => null }).desks[0].compact
  }
  assert.equal(run({ enable: true }).verdict, 'compact')
  assert.deepEqual([run({ enable: true, dry_run: false }).verdict, run({ enable: true, dry_run: false }).why], ['keep', 'compact.smart decides'])
})

test('the board shows the log as its own panel while compact.smart is on', () => {
  const o = office()
  assert.ok(panelsOf(o.root).some((p) => p.id === 'smart-compact' && /smart-compact\.mjs' '.*' panel$/.test(p.command)))
  writeFileSync(join(o.root, 'office.json'), JSON.stringify({ compact: {} }))
  assert.ok(!panelsOf(o.root).some((p) => p.id === 'smart-compact'))
})
