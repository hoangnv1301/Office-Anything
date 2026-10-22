// USAGE-LIMIT RESUME (0.15.0). A watched session stopped by the Claude usage
// limit is resumed once the limit lifts: at the reset, or as soon as another
// session of the account answers for real. One try, one retry, rung once.
// The banners are the CLI's own entries, copied from real transcripts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { limitsConfig, resetOf, resetFromText, stuckOn, menuOf, atPrompt, tabFor, tmuxPane, dueAt, limitModel, RESUME_TEXT } from '../lib/limits.mjs'
import { officeHealth } from '../lib/health.mjs'
import { heal } from '../lib/heal.mjs'

const MIN = 60_000
// alibaba-98, 2026-10-21T20:41:02Z (CLI 2.1.289): the stop that sat 17 hours
const ALIBABA98 = { parentUuid: 'a70ebd7b-82a5-4db4-90f1-8668f269779b', isSidechain: false, type: 'assistant', uuid: 'fa1b63e9-5f23-487e-b660-19e1b6e54ef6', timestamp: '2026-10-21T20:41:02.185Z', message: { id: '50aa47ff-76dc-4a5c-908a-ce3a975f6c33', model: '<synthetic>', role: 'assistant', stop_reason: 'stop_sequence', stop_sequence: '', type: 'message', usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, content: [{ type: 'text', text: "You've hit your weekly limit · resets Oct 27 at 1pm (Asia/Tokyo)" }] }, requestId: 'req_011CgG2hM5NsTzzkgsPw338G', quotaLimits: { status: 'rejected', resetsAt: 1793073600, unifiedRateLimitFallbackAvailable: false, rateLimitType: 'seven_day', overageStatus: 'rejected', overageDisabledReason: 'org_level_disabled', upgradePaths: ['overage'], isUsingOverage: false }, error: 'rate_limit', isApiErrorMessage: true, apiErrorStatus: 429, entrypoint: 'cli', cwd: '/Volumes/Extreme SSD/external-workspace/alibaba-store-diagnost-ai/bk/alibaba', sessionId: 'b8f5bea5-e63f-49e9-a4f4-36ae3d5b262b', version: '2.1.289' }
// 2026-10-18T13:01:21Z (CLI 2.1.302): the newer shape, with apiErrorParams
const NEWER = { type: 'assistant', isSidechain: false, uuid: '3b32e0bb-51db-47fd-9125-dbdbac92fb31', timestamp: '2026-10-18T13:01:21.481Z', message: { model: '<synthetic>', content: [{ type: 'text', text: "You've hit your weekly limit · resets Oct 23 at 12am (Asia/Tokyo)" }] }, apiError: 'usage_limit_reached', apiErrorParams: { rate_limit_info: { status: 'rejected', resetsAt: 1792681200, rateLimitType: 'seven_day' } }, error: 'rate_limit', isApiErrorMessage: true, apiErrorStatus: 429 }
// the text-only shape (apiError null, no resetsAt), 2026-10-20T18:17Z
const TEXT_ONLY = { type: 'assistant', isSidechain: false, uuid: 'b0000000-0000-4000-8000-000000000001', timestamp: '2026-10-20T18:17:40.000Z', message: { model: '<synthetic>', content: [{ type: 'text', text: "You've hit your session limit · resets 3:50am (Asia/Tokyo)" }] }, error: 'rate_limit', isApiErrorMessage: true }
// the dialogs, as the screen shows them (ops tests/usage-limit-fallback.test.mjs, real)
const OPUS_MENU = ['⏺ Drafting her reply now.', '', '╭────────────────────────────────╮', "│ You've hit your Opus limit     │", '│ What do you want to do?        │', '│ ❯ 1. Stop and wait for limit to reset │', '╰────────────────────────────────╯'].join('\n')
const WEEKLY_MENU = "You've hit your weekly limit · resets Oct 13 at 1pm (Asia/Tokyo)\nWhat do you want to do?\n1. Stop and wait for limit to reset\n3. Switch to usage credits"
const PROMPT = ['⏺ Saved the draft.', '', '────────', '❯ ', '────────', '  ⏵⏵ bypass permissions on'].join('\n')

const at = (iso) => Date.parse(iso)
const real = (iso, text = 'done', model = 'claude-opus-5-5') => ({ type: 'assistant', isSidechain: false, uuid: 'r-' + iso, timestamp: iso, message: { model, content: [{ type: 'text', text }], usage: { input_tokens: 1 } } })
const said = (iso, content) => ({ type: 'user', isSidechain: false, uuid: 'u-' + iso, timestamp: iso, message: { content } })
const enq = (iso, content = '<cross-session-message from="lead">…</cross-session-message>') => ({ type: 'queue-operation', operation: 'enqueue', timestamp: iso, content })

function office({ limits = { sessions: [{ name: 'alibaba-98' }] }, desk = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oa-lim-'))
  const home = mkdtempSync(join(tmpdir(), 'oa-lim-home-'))
  mkdirSync(join(home, '.claude', 'sessions'), { recursive: true })
  mkdirSync(join(root, 'desks', 'inventory'), { recursive: true })
  writeFileSync(join(root, 'desks', 'inventory', 'desk.json'), JSON.stringify({ name: 'inventory', kind: 'knowledge', port: 9701, ...desk }))
  writeFileSync(join(root, 'office.json'), JSON.stringify({ lead: { session: 'lead' }, ...(limits ? { limits } : {}) }))
  const peerDir = mkdtempSync(join(tmpdir(), 'oa-lim-peer-'))
  const reg = new Map()
  const BORN = at('2026-10-21T10:00:00Z')
  // a live session and its transcript (entries); status as the registry says
  const live = (name, cwd, pid, entries, { status = 'busy', tmux = null } = {}) => {
    const sid = `00000000-0000-4000-8000-${String(pid).padStart(12, '0')}`
    const s = { pid, name, cwd, sessionId: sid, status, statusUpdatedAt: BORN, updatedAt: BORN, startedAt: BORN, ...(tmux ? { tmux } : {}) }
    writeFileSync(join(home, '.claude', 'sessions', `${pid}.json`), JSON.stringify(s))
    reg.set(pid, s)
    const p = join(home, '.claude', 'projects', resolve(cwd).replace(/[^A-Za-z0-9]/g, '-'))
    mkdirSync(p, { recursive: true })
    writeFileSync(join(p, sid + '.jsonl'), entries.map((e) => JSON.stringify(e)).join('\n') + '\n')
    return { s, add: (...es) => appendFileSync(join(p, sid + '.jsonl'), es.map((e) => JSON.stringify(e)).join('\n') + '\n') }
  }
  // a process table whose claude processes are as old as the clock says
  const procsAt = (t) => new Map([[1, { pid: 1, ppid: 0, ageSec: 1e7, cmd: 'launchd' }], ...[...reg.values()].map((s) => [s.pid, { pid: s.pid, ppid: 1, ageSec: Math.round((t - BORN) / 1000) + 60, cmd: `claude --name ${s.name}` }])])
  const typed = []
  const term = (tabs, screen = () => PROMPT) => ({ titles: () => tabs, all: () => tabs, close: () => {}, send: (h, text) => typed.push({ h, text }), enter: (h) => typed.push({ h, text: '<Enter>' }), screen })
  const health = (t) => officeHealth(root, { home, procs: procsAt(t), now: t, checks: false, cwd: () => null })
  const healIt = (t, tabs, screen) => heal(root, health(t), { home, now: t, kill: () => {}, freshProcs: () => procsAt(t), cwd: () => null, terminal: term(tabs, screen) })
  const alerts = () => { const f = join(root, '.office', 'alerts.log'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n') : [] }
  return { root, home, peerDir, live, health, healIt, typed, alerts, procsAt, desk: join(root, 'desks', 'inventory') }
}

// the 10-21 night: alibaba-98 stopped at 20:41, 17 messages queued, the lead answering again at 22:57
function night(o, { tabTitle = '✳ Clean worktree and move to backup directory' } = {}) {
  const peer = o.live('alibaba-98', o.peerDir, 22223, [
    said('2026-10-21T20:30:00.000Z', 'push the chat.js honest-states change and report the PR'),
    real('2026-10-21T20:40:58.000Z', 'Pushing now.'),
    { ...ALIBABA98, cwd: o.peerDir },
    ...Array.from({ length: 17 }, (_, i) => enq(new Date(at('2026-10-21T20:43:20Z') + i * 4 * MIN).toISOString())),
  ])
  o.live('lead', o.root, 21202, [said('2026-10-21T22:57:14.000Z', 'we are back'), real('2026-10-21T22:57:40.000Z', 'Back. Picking up the queue.')], { status: 'idle' })
  const tabs = [{ handle: 'term_lead', title: '✳ lead', agent: true, path: o.root }, { handle: 'term_98', title: tabTitle, agent: true, path: o.peerDir }]
  return { peer, tabs }
}

test('config: off without office.json "limits"; on:false is off; bad values are the defaults', () => {
  assert.equal(limitsConfig({}), null)
  assert.equal(limitsConfig({ limits: { on: false } }), null)
  const c = limitsConfig({ limits: { sessions: ['alibaba-98', { name: 'x', tab: 'X tab' }], jitterSec: [5, 1], retryMin: 0, fallback: 'rm -rf' } })
  assert.deepEqual(c.sessions, [{ name: 'alibaba-98', tab: null }, { name: 'x', tab: 'X tab' }])
  assert.deepEqual([c.jitterSec, c.retryMin, c.fallback, c.office, c.text], [[60, 240], 10, 'sonnet', true, RESUME_TEXT])
  assert.equal(limitsConfig({ limits: { fallback: false } }).fallback, null)
})

test('the reset: the CLI\'s own epoch when it wrote one, else the banner text read in its zone', () => {
  assert.equal(new Date(resetOf(ALIBABA98)).toISOString(), '2026-10-27T04:00:00.000Z')
  assert.equal(new Date(resetOf(NEWER)).toISOString(), '2026-10-22T15:00:00.000Z')
  // the text agrees with the epoch on every real banner that carried both
  assert.equal(resetFromText("You've hit your weekly limit · resets Oct 27 at 1pm (Asia/Tokyo)", at(ALIBABA98.timestamp)), 1793073600_000)
  assert.equal(resetFromText("You've hit your weekly limit · resets Oct 23 at 12am (Asia/Tokyo)", at(NEWER.timestamp)), 1792681200_000)
  assert.equal(new Date(resetOf(TEXT_ONLY)).toISOString(), '2026-10-20T18:50:00.000Z', 'a bare time is the next one after the banner')
  assert.equal(new Date(resetFromText('resets 12am (Asia/Tokyo)', at('2026-10-21T22:56:00Z'))).toISOString(), '2026-10-22T15:00:00.000Z')
  assert.equal(resetFromText('resets soon', Date.now()), null)
  assert.equal(resetFromText('resets 1pm', Date.now()), null, 'no zone, no answer')
  assert.equal(limitModel("You've hit your Opus limit"), 'opus')
  assert.equal(limitModel(ALIBABA98.message.content[0].text), null)
})

test('stuck: the last conversational entry is the banner; a real answer or the CLI\'s own continue is not stuck', () => {
  const o = office()
  const { peer } = night(o)
  const l = stuckOn(o.home, peer.s)
  assert.equal(l.uuid, ALIBABA98.uuid)
  assert.equal(l.queued, 17)
  assert.equal(l.kind, 'seven_day')
  assert.equal(l.doing, 'push the chat.js honest-states change and report the PR')
  assert.equal(l.ownModel, 'claude-opus-5-5')
  // a resume that hits the limit again is the SAME stop: same key, same budget
  peer.add(said('2026-10-21T23:10:00.000Z', RESUME_TEXT), { ...ALIBABA98, uuid: 'second-banner', timestamp: '2026-10-21T23:10:02.000Z' })
  assert.equal(stuckOn(o.home, peer.s).uuid, ALIBABA98.uuid)
  assert.equal(stuckOn(o.home, peer.s).last, 'second-banner')
  peer.add(enq('2026-10-27T04:00:40.000Z', 'Your claude.ai usage limit has reset. Continue the task you were working on when the limit was reached; do not repeat work that is already complete.'))
  assert.equal(stuckOn(o.home, peer.s), null, 'the CLI is resuming it itself')
  const o2 = office()
  const n2 = night(o2)
  n2.peer.add(real('2026-10-22T13:58:08.000Z', 'Both department clones stopped mid-task.'))
  assert.equal(stuckOn(o2.home, n2.peer.s), null)
  // other API errors are not limits
  const o3 = office()
  const p3 = o3.live('alibaba-98', o3.peerDir, 5, [real('2026-10-21T20:00:00.000Z'), { ...TEXT_ONLY, error: 'authentication_failed', message: { model: '<synthetic>', content: [{ type: 'text', text: 'Not logged in · Please run /login' }] } }])
  assert.equal(stuckOn(o3.home, p3.s), null)
})

test('⛔ alibaba-98, 10-21: the lead answers again at 22:57, so it is resumed that night, not on Oct 27', () => {
  const o = office()
  const { tabs } = night(o)
  const t1 = at('2026-10-21T23:05:00Z')
  const h = o.health(t1)
  const row = h.limits.find((l) => l.name === 'alibaba-98')
  assert.equal(row.lifted.by, 'lead')
  assert.match(h.line, /usage-limited: alibaba-98 \(seven_day since 2026-10-21 20:41Z, resets 2026-10-27 04:00Z, lifted: lead answered 2026-10-21 22:57Z, resume due .*, 17 queued\)/)
  // first look: the lift is seen and rung; the resume waits out its jitter
  o.healIt(t1, tabs)
  assert.equal(o.typed.length, 0)
  const ring = o.alerts().filter((l) => / USAGE-LIMIT - alibaba-98 /.test(l))
  assert.equal(ring.length, 1)
  assert.match(ring[0], /stopped on its usage limit at 2026-10-21 20:41Z .*17 message\(s\) queued, undelivered; it was on: "push the chat\.js honest-states change and report the PR"; resume planned 2026-10-21 23:0\dZ/)
  // the next heartbeat: typed into its own tab, found by folder (its title is not its name)
  const t2 = t1 + 5 * MIN
  const r = o.healIt(t2, tabs)
  assert.deepEqual(o.typed, [{ h: 'term_98', text: RESUME_TEXT }])
  assert.match(r.acts.find((a) => a.act === 'limit-resume').why, /try 1\/2 via term_98; lifted: lead answered/)
  // no second line while the retry window runs, and one ring only
  o.healIt(t2 + 2 * MIN, tabs)
  assert.equal(o.typed.length, 1)
  assert.equal(o.alerts().filter((l) => / USAGE-LIMIT - alibaba-98 /.test(l)).length, 1)
  // still stopped on it after the retry window: the one retry
  o.healIt(t2 + 11 * MIN, tabs)
  assert.equal(o.typed.length, 2)
  // ⛔ never a third: the lead is told it needs a person, and health is red
  o.healIt(t2 + 30 * MIN, tabs)
  o.healIt(t2 + 60 * MIN, tabs)
  assert.equal(o.typed.length, 2)
  assert.match(o.alerts().join('\n'), /alibaba-98 is still stuck on its usage limit after 2 resumes/)
  const late = o.health(t2 + 60 * MIN)
  assert.equal(late.code, 4)
  assert.match(late.line, /alibaba-98 stuck on its usage limit/)
})

test('⛔ before the limit lifts nothing is typed: no answer elsewhere, the reset days away', () => {
  const o = office()
  const peer = o.live('alibaba-98', o.peerDir, 22223, [real('2026-10-21T20:40:58.000Z'), { ...ALIBABA98, cwd: o.peerDir }])
  o.live('lead', o.root, 21202, [{ ...ALIBABA98, uuid: 'lead-banner', timestamp: '2026-10-21T20:42:00.000Z' }])
  const tabs = [{ handle: 'term_98', title: 'x', agent: true, path: o.peerDir }]
  for (const t of [at('2026-10-21T23:00:00Z'), at('2026-10-24T12:00:00Z')]) o.healIt(t, tabs)
  assert.equal(o.typed.length, 0)
  assert.match(o.alerts().join('\n'), /resume planned 2026-10-27 04:0\dZ/)
  // the reset passes (plus jitter): resumed
  o.healIt(at('2026-10-27T04:05:00Z'), tabs)
  assert.deepEqual(o.typed.map((x) => x.h), ['term_98'])
  assert.ok(peer)
})

test('⛔ the limit\'s own menu is answered only on "Stop and wait"; any other open menu is refused and rung', () => {
  assert.equal(menuOf(PROMPT), null)
  assert.deepEqual(menuOf(OPUS_MENU), { cursor: '❯ 1. Stop and wait for limit to reset', wait: true })
  assert.equal(menuOf(WEEKLY_MENU).wait, false, 'no cursor line: not a known answer')
  assert.equal(menuOf(OPUS_MENU.replace('❯ 1. Stop and wait for limit to reset', '❯ 3. Switch to usage credits')).wait, false)
  // refused: the weekly menu on screen
  const o = office()
  const { tabs } = night(o)
  o.healIt(at('2026-10-21T23:05:00Z'), tabs, () => WEEKLY_MENU)
  const r = o.healIt(at('2026-10-21T23:10:00Z'), tabs, () => WEEKLY_MENU)
  assert.equal(o.typed.length, 0)
  assert.match(r.acts.find((a) => a.act === 'limit-resume').why, /a question is open on its screen/)
  assert.match(o.alerts().join('\n'), /a question is open on its screen; answer it by hand/)
  // answered: Enter on "Stop and wait", the menu closes, then the resume line
  const o2 = office()
  const n2 = night(o2)
  let shown = OPUS_MENU
  o2.healIt(at('2026-10-21T23:05:00Z'), n2.tabs, () => shown)
  heal(o2.root, o2.health(at('2026-10-21T23:10:00Z')), { home: o2.home, now: at('2026-10-21T23:10:00Z'), kill: () => {}, freshProcs: () => o2.procsAt(at('2026-10-21T23:10:00Z')), cwd: () => null,
    terminal: { all: () => n2.tabs, titles: () => n2.tabs, send: (h, text) => o2.typed.push({ h, text }), enter: (h) => { o2.typed.push({ h, text: '<Enter>' }); shown = PROMPT }, screen: () => shown } })
  assert.deepEqual(o2.typed.map((x) => x.text), ['<Enter>', RESUME_TEXT])
})

test('⛔ looked at again before typing: a session that answered since health looked is left alone', () => {
  const o = office()
  const { peer, tabs } = night(o)
  o.healIt(at('2026-10-21T23:05:00Z'), tabs)
  const t = at('2026-10-21T23:10:00Z')
  const h = o.health(t)
  assert.equal(h.limits.length, 1)
  // between health and heal, somebody typed into it and it answered
  peer.add(said('2026-10-21T23:09:30.000Z', 'continue'), real('2026-10-21T23:09:50.000Z', 'Resuming.'))
  const r = heal(o.root, h, { home: o.home, now: t, kill: () => {}, freshProcs: () => o.procsAt(t), cwd: () => null, terminal: { all: () => tabs, titles: () => tabs, send: (hd, text) => o.typed.push({ hd, text }), screen: () => PROMPT } })
  assert.equal(o.typed.length, 0)
  assert.match(r.acts.find((a) => a.act === 'limit-resume').why, /moved since health looked/)
})

test('⛔ never typed blind: an unreadable screen, or no empty prompt on it, types nothing', () => {
  assert.equal(atPrompt(PROMPT), true)
  assert.equal(atPrompt(''), false)
  assert.equal(atPrompt('❯ half a sentence somebody was typing'), false)
  for (const [screen, why] of [[() => '', /could not be read/], [() => '⏺ Working… (esc to interrupt)', /input prompt is not on screen/]]) {
    const o = office()
    const { tabs } = night(o)
    o.healIt(at('2026-10-21T23:05:00Z'), tabs, screen)
    const r = o.healIt(at('2026-10-21T23:10:00Z'), tabs, screen)
    assert.equal(o.typed.length, 0)
    assert.match(r.acts.find((a) => a.act === 'limit-resume').why, why)
  }
})

test('⛔ a tab is never guessed: by name, by a pinned title, or the only agent tab in its folder', () => {
  const s = { name: 'alibaba-98', cwd: '/w/bk/alibaba' }
  assert.deepEqual(tabFor([{ handle: 'a', title: '✳ alibaba-98', agent: true, path: '/w' }], s), { handle: 'a' })
  assert.deepEqual(tabFor([{ handle: 'b', title: 'Clean worktree', agent: true, path: '/w/bk/alibaba' }], s), { handle: 'b' })
  assert.match(tabFor([{ handle: 'b', title: 'one', agent: true, path: '/w/bk/alibaba' }, { handle: 'c', title: 'two', agent: true, path: '/w/bk/alibaba' }], s).why, /2 tabs are agents in/)
  assert.match(tabFor([{ handle: 'd', title: 'Terminal 1', agent: false, path: '/w/bk/alibaba' }], s).why, /no single agent tab/)
  assert.deepEqual(tabFor([{ handle: 'e', title: '✳ My peer', agent: true, path: '/x' }], s, 'My peer'), { handle: 'e' })
  // through heal: two agent tabs in its folder, nothing typed
  const o = office()
  const { tabs } = night(o)
  const two = [...tabs, { handle: 'term_99', title: '✳ other', agent: true, path: o.peerDir }]
  o.healIt(at('2026-10-21T23:05:00Z'), two)
  const r = o.healIt(at('2026-10-21T23:10:00Z'), two)
  assert.equal(o.typed.length, 0)
  assert.match(r.acts.find((a) => a.act === 'limit-resume').why, /2 tabs are agents in/)
})

test('⛔ a registry "tmux" field is used only when tmux answers and the pane holds that claude', () => {
  const s = { pid: 300, tmux: 'orca:@0.%1' }
  const procs = new Map([[300, { pid: 300, ppid: 200 }], [200, { pid: 200, ppid: 1 }], [1, { pid: 1, ppid: 0 }]])
  const calls = []
  const run = (pid) => (cmd, args) => { calls.push(args.join(' ')); return { status: 0, stdout: args[0] === 'display-message' ? `${pid}\n` : '' } }
  assert.equal(tmuxPane(s, procs, run(999)), null, 'the pane holds some other process: the lead and alibaba-98 both said %1')
  assert.equal(tmuxPane(s, procs, () => ({ error: Object.assign(new Error('spawn tmux ENOENT'), { code: 'ENOENT' }) })), null, 'no tmux on this Mac')
  const p = tmuxPane(s, procs, run(200))
  p.send('continue')
  assert.deepEqual(calls.slice(-2), ['send-keys -t %1 -l continue', 'send-keys -t %1 Enter'])
})

test('a model\'s own limit on a desk: switched to the fallback at once, back to its model after the reset', () => {
  const o = office({ limits: {} })
  const opus = { ...TEXT_ONLY, uuid: 'opus-stop', timestamp: '2026-10-21T10:52:24.000Z', message: { model: '<synthetic>', content: [{ type: 'text', text: "You've hit your Opus limit · resets 12pm (Asia/Tokyo)" }] } }
  const d = o.live('desk-inventory', o.desk, 701, [real('2026-10-21T10:52:00.000Z', 'Drafting.'), opus])
  const tabs = [{ handle: 't-inv', title: '✳ desk-inventory', agent: true, path: o.root }]
  const t = at('2026-10-21T10:58:00Z')
  const h = o.health(t)
  assert.equal(h.limits[0].desk, 'inventory')
  assert.equal(dueAt(limitsConfig({ limits: {} }), h.limits[0], { isDesk: true }) <= t, true, 'not waiting for the reset')
  o.healIt(t, tabs)
  assert.deepEqual(o.typed.map((x) => x.text), ['/model sonnet', RESUME_TEXT])
  // it worked on sonnet; after the reset (03:00Z), idle at its prompt: back to its own model
  d.add(said('2026-10-21T10:58:10.000Z', RESUME_TEXT), real('2026-10-21T10:59:00.000Z', 'Sent.', 'claude-sonnet-5-5'))
  writeFileSync(join(o.home, '.claude', 'sessions', '701.json'), JSON.stringify({ ...d.s, status: 'idle' }))
  o.healIt(at('2026-10-21T11:30:00Z'), tabs)
  assert.equal(o.typed.length, 2, 'before the reset it stays on sonnet')
  o.healIt(at('2026-10-22T03:10:00Z'), tabs)
  assert.deepEqual(o.typed.slice(2).map((x) => x.text), ['/model claude-opus-5-5'])
  o.healIt(at('2026-10-22T03:20:00Z'), tabs)
  assert.equal(o.typed.length, 3, 'once')
})

test('⛔ off by default: no "limits" in office.json, nothing watched or typed', () => {
  const o = office({ limits: null })
  const { tabs } = night(o)
  const h = o.health(at('2026-10-21T23:05:00Z'))
  assert.deepEqual(h.limits, [])
  o.healIt(at('2026-10-21T23:05:00Z'), tabs)
  o.healIt(at('2026-10-21T23:15:00Z'), tabs)
  assert.equal(o.typed.length, 0)
})

test('a peer outside the office is watched only when named; skip wins', () => {
  const o = office({ limits: {} })
  const { tabs } = night(o)
  assert.equal(o.health(at('2026-10-21T23:05:00Z')).limits.length, 0, 'alibaba-98 runs outside the office folder')
  const o2 = office({ limits: { sessions: ['alibaba-98'], skip: ['alibaba-*'] } })
  night(o2)
  assert.equal(o2.health(at('2026-10-21T23:05:00Z')).limits.length, 0)
  assert.ok(tabs)
})

test('the README says the limit resume is off unless office.json says "limits"', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  assert.match(readme, /\*\*Off unless `office\.json` says `"limits"`\.\*\*/)
})
