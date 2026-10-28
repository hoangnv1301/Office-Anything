// SMART COMPACT (0.21.0): a fat session is compacted at a task boundary, with
// a keep instruction written from what it is actually holding.
//
// The owner, 2026-10-28: the long-running sessions (desks, the leads) spend most
// of the weekly budget, because every call re-reads the whole context. The idle
// compact of 0.13.0 (lib/compact.mjs) types one fixed focus line at a fixed size,
// which is wrong twice: some sessions already run with a smaller window, and a
// fixed line cannot name the buyers, promises and prices this session holds.
//
//   1. THE WATCHER (no model), every everyMin from the watchdog pass: a desk or
//      lead whose context is large relative to ITS OWN window (lib/context.mjs),
//      idle at its prompt for idleMin (or doneIdleMin after a turn that matched
//      office.json doneMatch: a unit of work just finished), no tool call open,
//      no message queued, no openWork line naming it, not compacted within
//      everyHours, not asked within askEveryMin unless it grew.
//   2. THE JUDGE (a small model, lib/prompts/smart-compact.md): reads only the
//      condensed tail of that transcript (about tailTokens) and answers JSON
//      { compact_now, reason, keep }. It must say no mid-task.
//   3. THE SEND: the same keystroke road heal and the board use (orca, the tab
//      titled with the session's name), after a fresh look: same pid, same
//      status stamp, nothing queued, the input line seen empty.
//
//   office.json "compact": { …, "smart": {
//     "enable": true, "dry_run": true, "model": "claude-haiku-5-5",
//     "everyMin": 12, "everyHours": 4, "askEveryMin": 60,
//     "desk": { "ratio": 0.25, "minK": 120, "idleMin": 20 },
//     "lead": { "ratio": 0.35, "minK": 150, "idleMin": 30 },
//     "doneMatch": "<regex over the last turn's tool calls>", "doneIdleMin": 5 } }
//
// ⛔ DRY RUN IS THE DEFAULT. It decides and logs, and types nothing. Only
// "dry_run": false types, and then the 0.13.0 fixed-focus typing in heal steps
// aside (two compactors on one session is one too many).
// ⛔ THE LEAD IS STRICTER: a larger share of its window, a longer idle, and the
// judge told to say no unless the lead is clearly between jobs. A lead holds
// the most state; a lost lead is the costliest loss.
// ⛔ UNDER CLAUDE CODE'S OWN LINE. Claude Code 2.1.302+ compacts an idle session
// over 200K about 54 min after its last turn, with a generic summary. With a
// 500K window the defaults land at 125K (desk) and 175K (lead), idle 20 and 30
// min: the smart compact gets there first with its own keep line.
// ⛔ ANY DOUBT IS A NO. A judge that times out, errors or answers anything but
// the schema is "no". The keep text is one line (a newline would press Enter
// half way through /compact) and at most keepMax characters.
// ⛔ THE CHEAP GATES RUN FIRST and the asking itself is rate-limited: a session
// whose screen never reads empty must not cost a model call every pass.
//
// Every decision is one JSON line in .office/smart-compact.jsonl (rotated at
// 1 MB). A sent compact gets an "after" line once its compact_boundary is in
// the transcript. The board shows the log as the built-in "Smart compact"
// panel (node lib/smart-compact.mjs <root> panel).
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, statSync, renameSync, unlinkSync, openSync, readSync, closeSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { homedir, tmpdir, userInfo } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { isMain } from './is-main.mjs'
import { findOffice, readOfficeConfig } from './office.mjs'
import { officeRoster, deskOfSession } from './desk.mjs'
import { machineLeads } from './departments.mjs'
import { contextCap } from './context.mjs'
import { liveSessions, processTable, doorbell } from './procs.mjs'
import { idleSince, lastWorkAt } from './idle.mjs'
import { officeOpenWork } from './desks.mjs'
import { readTasks } from './tasks.mjs'
import { launchConfig, orcaTerminal } from './start.mjs'
import { wakeCommand, bellRoots } from './wall.mjs'
import { atPrompt, menuOf } from './limits.mjs'

const MIN = 60_000
const LOG_MAX = 1 << 20
export const PROMPT_FILE = fileURLToPath(new URL('./prompts/smart-compact.md', import.meta.url))
export const KEEP_MAX = 1000

export const DEFAULTS = {
  enable: false, dryRun: true, model: 'claude-haiku-5-5',
  everyMin: 12, everyHours: 4, askEveryMin: 60, growth: 0.15,
  tailTokens: 15_000, keepMax: 900, timeoutSec: 120, defaultMaxK: 200,
  desk: { ratio: 0.25, minK: 120, idleMin: 20 },
  lead: { ratio: 0.35, minK: 150, idleMin: 30 },
  doneMatch: null, doneIdleMin: 5,
}

// office.json compact.smart -> null (absent or not enabled) | the merged config
export function smartConfig(cfg) {
  const S = cfg?.compact?.smart
  if (!S || typeof S !== 'object' || Array.isArray(S)) return null
  if (S.enable !== true) return null
  const num = (v, d, lo, hi) => (Number.isFinite(v) && v >= lo && v <= hi ? v : d)
  const tier = (o, d) => ({ ratio: num(o?.ratio, d.ratio, 0.05, 1), minK: num(o?.minK, d.minK, 20, 1000), idleMin: num(o?.idleMin, d.idleMin, 1, 1440) })
  let done = null
  if (typeof S.doneMatch === 'string' && S.doneMatch) { try { done = new RegExp(S.doneMatch) } catch { done = null } }
  const dry = S.dry_run ?? S.dryRun
  return {
    enable: true,
    dryRun: dry !== false,
    model: typeof S.model === 'string' && /^[\w.\[\]-]{1,60}$/.test(S.model) ? S.model : DEFAULTS.model,
    everyMin: num(S.everyMin, DEFAULTS.everyMin, 1, 240),
    everyHours: num(S.everyHours, DEFAULTS.everyHours, 0.25, 72),
    askEveryMin: num(S.askEveryMin, DEFAULTS.askEveryMin, 5, 1440),
    growth: num(S.growth, DEFAULTS.growth, 0, 5),
    tailTokens: num(S.tailTokens, DEFAULTS.tailTokens, 2000, 40_000),
    keepMax: num(S.keepMax, DEFAULTS.keepMax, 100, KEEP_MAX),
    timeoutSec: num(S.timeoutSec, DEFAULTS.timeoutSec, 10, 600),
    defaultMaxK: num(S.defaultMaxK, DEFAULTS.defaultMaxK, 50, 1000),
    desk: tier(S.desk, DEFAULTS.desk),
    lead: tier(S.lead, DEFAULTS.lead),
    doneMatch: done,
    doneIdleMin: num(S.doneIdleMin, DEFAULTS.doneIdleMin, 1, 1440),
  }
}
// smart compact is typing (not only deciding): the fixed-focus compact steps aside
export const smartLive = (cfg) => { const c = smartConfig(cfg); return !!c && !c.dryRun }

// ── the transcript ──────────────────────────────────────────────────────────
export const transcriptPath = (home, s) => (s?.sessionId && s?.cwd ? join(home, '.claude', 'projects', resolve(s.cwd).replace(/[^A-Za-z0-9]/g, '-'), s.sessionId + '.jsonl') : null)

function tailText(p, bytes) {
  try {
    const st = statSync(p)
    const n = Math.min(st.size, bytes)
    const fd = openSync(p, 'r'); const buf = Buffer.alloc(n); readSync(fd, buf, 0, n, st.size - n); closeSync(fd)
    const t = buf.toString('utf8')
    return n < st.size ? t.slice(t.indexOf('\n') + 1) : t
  } catch { return null }
}
const entries = (text) => String(text ?? '').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)] } catch { return [] } })

// -> { ctx, pending, queued, lastTools: [string], lastAt } from the last 1 MB
// ctx: the last assistant turn's whole prompt (input + cache read + cache write)
// pending: the last conversational entry is an assistant tool call with no result
// queued: messages enqueued and not yet taken (the session has work waiting)
// lastTools: the last assistant turn's tool calls, name + input, for doneMatch
export function sessionTail(home, s, bytes = 1 << 20) {
  const p = transcriptPath(home, s)
  const es = p ? entries(tailText(p, bytes)) : []
  let ctx = null, pending = false, seen = false, lastAt = null
  const lastTools = []
  for (let i = es.length - 1; i >= 0; i--) {
    const e = es[i]
    // ⛔ A COMPACTION AFTER THE LAST TURN IS THE SIZE NOW. Claude Code compacts
    // idle sessions itself (2.1.302+, "Compacted while idle"), and the last
    // usage before it still says 207K of a session that holds 20K.
    if (ctx == null && e.type === 'system' && e.subtype === 'compact_boundary') { ctx = Number.isFinite(e.compactMetadata?.postTokens) ? e.compactMetadata.postTokens : 0; if (!lastAt) lastAt = Date.parse(e.timestamp ?? '') || null }
    if ((e.type !== 'assistant' && e.type !== 'user') || e.isSidechain) continue
    const c = e.message?.content
    if (!seen) {
      seen = true
      lastAt = Date.parse(e.timestamp ?? '') || null
      pending = e.type === 'assistant' && Array.isArray(c) && c.some((x) => x?.type === 'tool_use')
    }
    if (e.type === 'assistant' && Array.isArray(c) && lastTools.length < 12 && ctx == null) for (const x of c) if (x?.type === 'tool_use') lastTools.push(`${x.name} ${JSON.stringify(x.input ?? {}).slice(0, 400)}`)
    const u = e.type === 'assistant' ? e.message?.usage : null
    if (u && ctx == null) ctx = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
    if (ctx != null && lastTools.length) break
  }
  let queued = 0
  // clamped at every step: a dequeue whose enqueue is older than the window
  // must not cancel a message that is really waiting
  for (const e of es) if (e.type === 'queue-operation') queued = Math.max(0, queued + (e.operation === 'enqueue' ? 1 : e.operation === 'dequeue' || e.operation === 'remove' ? -1 : 0))
  return { ctx, pending, queued, lastTools, lastAt }
}

// the tail as the judge reads it: after the last compaction, tool output cut
// short, newest last, at most maxChars (about 4 characters a token)
export function condensedTail(home, s, maxChars = 60_000) {
  const p = transcriptPath(home, s)
  if (!p) return ''
  let es = entries(tailText(p, 3 << 20))
  const b = es.findLastIndex((e) => e.type === 'system' && e.subtype === 'compact_boundary')
  if (b >= 0) es = es.slice(b + 1)
  const one = (s0, n) => { const t = String(s0 ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + ' …[cut]' : t }
  const out = []
  for (const e of es) {
    if (e.isSidechain) continue
    const ts = String(e.timestamp ?? '').slice(5, 16).replace('T', ' ')
    const c = e.message?.content
    if (e.type === 'queue-operation' && e.operation === 'enqueue') out.push(`[${ts}] QUEUED: ${one(e.content, 600)}`)
    else if (e.type === 'user') {
      if (typeof c === 'string') out.push(`[${ts}] USER: ${one(c, 1500)}`)
      else if (Array.isArray(c)) for (const x of c) {
        if (x?.type === 'text') out.push(`[${ts}] USER: ${one(x.text, 1500)}`)
        else if (x?.type === 'tool_result') out.push(`[${ts}] RESULT${x.is_error ? ' (error)' : ''}: ${one(typeof x.content === 'string' ? x.content : Array.isArray(x.content) ? x.content.map((y) => y?.text ?? '').join(' ') : '', 300)}`)
      }
    } else if (e.type === 'assistant' && Array.isArray(c)) for (const x of c) {
      if (x?.type === 'text') out.push(`[${ts}] ASSISTANT: ${one(x.text, 2000)}`)
      else if (x?.type === 'tool_use') out.push(`[${ts}] TOOL ${x.name}: ${one(JSON.stringify(x.input ?? {}), 400)}`)
    }
  }
  let text = out.join('\n')
  if (text.length > maxChars) text = '…[older turns cut]\n' + text.slice(text.length - maxChars).replace(/^[^\n]*\n/, '')
  return text
}

// the session's own maximum: the window the office started it with (its
// CLAUDE_CODE_AUTO_COMPACT_WINDOW, lib/context.mjs), else defaultMaxK
export function maxTokensOf(cfg, conf, { desk = null, isLead = false } = {}) {
  let cap = null
  try { cap = contextCap(cfg, { desk, isLead }) } catch {}
  return cap ?? conf.defaultMaxK * 1000
}

// ── the cheap gates ─────────────────────────────────────────────────────────
// -> { verdict: 'ask' | 'skip', why, idleMin, threshold }
// Work the office lists for it (openWork) is not a gate: an idle desk with a
// standing item is the one to compact before it wakes, and the judge is told.
export function smartVerdict(conf, x, { now = Date.now(), lastSent = null, asked = null } = {}) {
  const T = x.role === 'lead' ? conf.lead : conf.desk
  const threshold = Math.max(T.minK * 1000, Math.round(T.ratio * x.max))
  const k = (n) => `${Math.round(n / 1000)}K`
  const skip = (why, extra = {}) => ({ verdict: 'skip', why, threshold, ...extra })
  if (x.tail.ctx == null) return skip('context size unknown')
  if (x.tail.ctx < threshold) return skip(`${k(x.tail.ctx)} of ${k(x.max)}, under ${k(threshold)}`)
  if (x.idleSince == null) return skip(x.status === 'busy' ? 'running a turn' : `${x.status ?? 'status unknown'}, not provably idle`)
  if (x.tail.pending) return skip('a tool call or question is open')
  if (x.tail.queued > 0) return skip(`${x.tail.queued} message(s) queued for it`)
  const idleMin = Math.round((now - Math.max(x.idleSince, x.tail.lastAt ?? 0)) / MIN)
  const done = !!conf.doneMatch && x.tail.lastTools.some((t) => conf.doneMatch.test(t))
  const need = done ? Math.min(conf.doneIdleMin, T.idleMin) : T.idleMin
  if (idleMin < need) return skip(`idle ${idleMin} of ${need} min${done ? ' (a unit of work just finished)' : ''}`, { idleMin })
  if (lastSent != null && now - lastSent < conf.everyHours * 3600_000) return skip(`compacted ${Math.round((now - lastSent) / MIN)} min ago (once per ${conf.everyHours} h)`, { idleMin })
  if (asked && now - asked.at < conf.askEveryMin * MIN && x.tail.ctx < asked.ctx * (1 + conf.growth)) return skip(`judge said no ${Math.round((now - asked.at) / MIN)} min ago and it has not grown ${Math.round(conf.growth * 100)}%`, { idleMin })
  return { verdict: 'ask', why: `${k(x.tail.ctx)} of ${k(x.max)} (over ${k(threshold)}), idle ${idleMin} min${done ? ', a unit of work just finished' : ''}`, idleMin, threshold, done }
}

// ── the judge ───────────────────────────────────────────────────────────────
export const SCHEMA = { type: 'object', additionalProperties: false, required: ['compact_now', 'reason', 'keep'], properties: { compact_now: { type: 'boolean' }, reason: { type: 'string', maxLength: 300 }, keep: { type: 'string' } } }

// one line, no control characters, at most max characters, cut at a word
export function keepLine(s, max = KEEP_MAX) {
  let t = String(s ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (t.length > max) { t = t.slice(0, max); const sp = t.lastIndexOf(' '); if (sp > max * 0.7) t = t.slice(0, sp) }
  return t
}

// ⛔ THE WATCHDOG IS NOT A SHELL. Under a bare environment (a LaunchAgent)
// claude -p answered "Not logged in": its login is found by the user's name,
// and USER/LOGNAME were not set. They are filled from the account, never invented.
export function judgeEnv(env = process.env) {
  let u = null
  try { u = userInfo().username } catch {}
  return { ...env, ...(env.USER ? {} : u ? { USER: u } : {}), ...(env.LOGNAME ? {} : u ? { LOGNAME: u } : {}) }
}

// -> { ok, compact_now, reason, keep, cost, tokens, ms, why? } ; never throws
export function judge(conf, header, tail, { run = spawnSync, promptFile = PROMPT_FILE } = {}) {
  const t0 = Date.now()
  const no = (why, extra = {}) => ({ ok: false, compact_now: false, reason: why, keep: '', why, ms: Date.now() - t0, ...extra })
  // ⛔ OUTSIDE THE OFFICE: a cwd with no CLAUDE.md and no hooks, no settings
  // sources, no tools, no MCP, nothing saved. It reads text and answers JSON.
  let cwd = null
  try { cwd = mkdtempSync(join(tmpdir(), 'oa-judge-')) } catch (e) { return no(`no temp folder (${e.message})`) }
  try {
    const r = run('claude', ['-p', '--model', conf.model, '--tools', '', '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence',
      '--output-format', 'json', '--system-prompt-file', promptFile, '--json-schema', JSON.stringify(SCHEMA)],
    { cwd, env: judgeEnv(), input: `${header}\n\n=== TRANSCRIPT TAIL (oldest first) ===\n${tail}\n=== END ===\n\nDecide now. JSON only.`, encoding: 'utf8', timeout: conf.timeoutSec * 1000, maxBuffer: 8 << 20 })
    if (r.error) return no(r.error.code === 'ETIMEDOUT' ? `the judge timed out after ${conf.timeoutSec} s` : `the judge did not run (${r.error.message})`)
    let j
    try { j = JSON.parse(String(r.stdout ?? '')) } catch { return no(`the judge answered no JSON (exit ${r.status})`) }
    const cost = Number.isFinite(j.total_cost_usd) ? j.total_cost_usd : null
    const u = j.usage ?? {}
    const tokens = { in: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), out: u.output_tokens ?? 0 }
    if (j.is_error) return no(`the judge failed (${String(j.result ?? j.subtype ?? '').slice(0, 120)})`, { cost, tokens })
    let o = j.structured_output
    if (!o && typeof j.result === 'string') { try { o = JSON.parse(j.result) } catch {} }
    if (!o || typeof o.compact_now !== 'boolean') return no('the judge answered outside the schema', { cost, tokens })
    const keep = keepLine(o.keep, conf.keepMax)
    const reason = keepLine(o.reason, 300)
    if (o.compact_now && keep.length < 20) return no(`the judge said compact but gave no keep instruction (${reason})`, { cost, tokens })
    return { ok: true, compact_now: o.compact_now, reason, keep: o.compact_now ? keep : '', cost, tokens, ms: Date.now() - t0 }
  } finally { try { rmSync(cwd, { recursive: true, force: true }) } catch {} }
}

// ── state and the log ───────────────────────────────────────────────────────
const stateFile = (root) => join(root, '.office', 'smart-compact-state.json')
export const logFile = (root) => join(root, '.office', 'smart-compact.jsonl')
export function readState(root) { try { const j = JSON.parse(readFileSync(stateFile(root), 'utf8')); return j && typeof j === 'object' ? { sessions: {}, ...j } : { sessions: {} } } catch { return { sessions: {} } } }
const writeState = (root, st) => { mkdirSync(join(root, '.office'), { recursive: true }); writeFileSync(stateFile(root), JSON.stringify(st, null, 1)) }
export function logLine(root, o) {
  const f = logFile(root)
  mkdirSync(dirname(f), { recursive: true })
  try { if (statSync(f).size > LOG_MAX) renameSync(f, f + '.1') } catch {}
  appendFileSync(f, JSON.stringify(o) + '\n')
}
export function readLog(root, n = 200) {
  let t = ''
  try { t = readFileSync(logFile(root), 'utf8') } catch {}
  return entries(t).slice(-n)
}

// the compaction a send produced: the first compact_boundary after sentAt ->
// { pre, post, trigger } | null; and the next turn's context
export function afterOf(home, s, sentAt) {
  const p = transcriptPath(home, s)
  const es = p ? entries(tailText(p, 4 << 20)) : []
  const i = es.findIndex((e) => e.type === 'system' && e.subtype === 'compact_boundary' && Date.parse(e.timestamp ?? '') >= sentAt - 5000)
  if (i < 0) return null
  const m = es[i].compactMetadata ?? {}
  let next = null
  for (const e of es.slice(i + 1)) { const u = e.type === 'assistant' ? e.message?.usage : null; if (u) { next = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0); break } }
  return { at: es[i].timestamp ?? null, trigger: m.trigger ?? null, pre: m.preTokens ?? null, post: m.postTokens ?? null, nextCtx: next }
}

// ⛔ A LEAD PARKED ON ITS BELL IS IDLE. A lead waiting in its foreground
// doorbell reads "shell", and its status stamp restarts on every re-arm. Like a
// desk (lib/idle.mjs): idle when the registry says so; in a shell only when
// its own bell (from any installed version of this plugin, wall.mjs bellRoots)
// is proven armed, and then since the transcript's last work that is not the bell.
export function leadIdleSince(l, s, procs, { now = Date.now(), home = homedir(), roots } = {}) {
  if (s.status === 'idle') return s.statusUpdatedAt ?? null
  if (s.status !== 'shell' || typeof l?.wake !== 'string' || !l.wake.trim()) return null
  let rs = roots
  if (!rs) { try { rs = bellRoots(undefined, { configDir: join(home, '.claude') }) } catch { rs = [undefined] } }
  for (const r of rs) {
    const bell = { name: 'lead', wake: wakeCommand(l.wake, r) }
    if (doorbell(bell, s, procs, now, undefined, null).state === 'armed') { const p = transcriptPath(home, s); return p ? lastWorkAt(p, bell) : null }
  }
  return null
}

// ── one pass ────────────────────────────────────────────────────────────────
// the office's desks and leads that are live here -> [{ s, role, desk, name }]
// Buyer teammates and case sessions (<desk>--<key>) are not compacted here.
export function officeSessions(root, cfg, sessions) {
  const desks = officeRoster(root).desks
  const leads = machineLeads(root, cfg)
  const out = []
  for (const s of sessions) {
    if (typeof s.name !== 'string' || !s.name) continue
    const l = leads.find((x) => x.names.includes(s.name))
    if (l && s.cwd && resolve(s.cwd) === resolve(root)) { out.push({ s, role: 'lead', desk: null, lead: l, name: s.name }); continue }
    const hit = deskOfSession(desks, s.name)
    if (hit && !hit.key && (!s.cwd || resolve(s.cwd) === resolve(hit.desk.dir))) out.push({ s, role: 'desk', desk: hit.desk, name: s.name })
  }
  return out
}

const lock = (root) => {
  const f = join(root, '.office', 'smart-compact.lock')
  mkdirSync(dirname(f), { recursive: true })
  const take = () => { try { writeFileSync(f, String(process.pid), { flag: 'wx' }); return true } catch { return false } }
  if (!take()) {
    try { if (Date.now() - statSync(f).mtimeMs > 15 * MIN) unlinkSync(f) } catch {}
    if (!take()) return null
  }
  return () => { try { if (readFileSync(f, 'utf8') === String(process.pid)) unlinkSync(f) } catch {} }
}

// -> { ran: bool, why?, decisions: [...] }
// o: { now, home, procs, freshProcs, bellRoots, sessions, terminal, run (judge's spawn), force (ignore
//     everyMin), reask (ignore askEveryMin), only (session names), dryRun
//     (override), conf (override) }
export function smartPass(root, o = {}) {
  const cfg = o.cfg ?? readOfficeConfig(root)
  let conf = o.conf ?? smartConfig(cfg)
  if (!conf) return { ran: false, why: 'office.json compact.smart is not enabled', decisions: [] }
  if (o.dryRun != null) conf = { ...conf, dryRun: !!o.dryRun }
  const now = o.now ?? Date.now()
  const home = o.home ?? homedir()
  const st = readState(root)
  if (!o.force && st.lastPass && now - st.lastPass < conf.everyMin * MIN) return { ran: false, why: `not due (last pass ${Math.round((now - st.lastPass) / MIN)} of ${conf.everyMin} min ago)`, decisions: [] }
  const unlock = lock(root)
  if (!unlock) return { ran: false, why: 'another smart compact pass is running', decisions: [] }
  const decisions = []
  try {
    st.lastPass = now
    writeState(root, st)
    const procs = o.procs ?? processTable()
    const sessions = o.sessions ?? liveSessions(home, procs, now)
    let heal = {}
    try { heal = JSON.parse(readFileSync(join(root, '.office', 'heal-state.json'), 'utf8')).compacted ?? {} } catch {}

    // 1. fill "after" for sends that compacted since
    for (const [name, v] of Object.entries(st.sessions)) {
      if (!v?.sentAt || v.afterLogged) continue
      const s = sessions.find((x) => x.sessionId === v.sessionId)
      const a = s ? afterOf(home, s, v.sentAt) : null
      if (a) { logLine(root, { at: new Date(now).toISOString(), kind: 'after', session: name, sentAt: new Date(v.sentAt).toISOString(), ctxBefore: v.ctxBefore, compactedAt: a.at, trigger: a.trigger, preTokens: a.pre, postTokens: a.post, nextCtx: a.nextCtx }); v.afterLogged = true }
      else if (now - v.sentAt > 6 * 3600_000) v.afterLogged = 'never'
    }

    // 2. the cheap gates, every desk and lead live here
    let ow = null
    const workFor = (desk) => {
      if (!desk) return []
      if (ow === null) { try { ow = officeOpenWork(root, cfg) ?? { lines: [] } } catch { ow = { lines: [] } } }
      if (ow.error) return [`openWork did not answer (${ow.error})`]
      return ow.lines.filter((l) => (desk.names ?? [desk.session]).some((n) => new RegExp(`(^|[^\\w-])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w]|-[\\w])`).test(l)))
    }
    let term = o.terminal
    const termOf = () => { if (term === undefined) { try { term = launchConfig(cfg).terminal === 'orca' ? orcaTerminal(root) : null } catch { term = null } } return term }
    const tabOf = (name) => { const t = termOf(); if (!t?.titles) return { why: 'no terminal adapter' }; let tabs = []; try { tabs = t.titles().filter((x) => x.title === name) } catch (e) { return { why: `the tab list failed (${e.message})` } } return tabs.length === 1 ? { handle: tabs[0].handle } : { why: tabs.length ? `${tabs.length} tabs are titled ${name}: not guessing` : `no tab titled ${name}` } }
    const screenEmpty = (h) => { let scr = ''; try { scr = termOf().screen ? termOf().screen(h) : '' } catch {} return !!String(scr ?? '').trim() && !menuOf(scr) && atPrompt(scr) }
    let tasks = []
    try { tasks = readTasks(root).filter((t) => ['open', 'working', 'waiting'].includes(t.state)) } catch {}

    for (const x of officeSessions(root, cfg, sessions)) {
      if (o.only && !o.only.includes(x.name)) continue
      const { s } = x
      const tail = sessionTail(home, s)
      const max = maxTokensOf(cfg, conf, { desk: x.desk?.name ?? null, isLead: x.role === 'lead' })
      let since = null
      if (x.role === 'desk') { try { since = idleSince(x.desk, s, procs, { now: () => now, dir: join(home, '.claude'), root }) } catch {} }
      else since = leadIdleSince(x.lead, s, procs, { now, home, roots: o.bellRoots })
      const mine = st.sessions[x.name] ?? {}
      const lastSent = Math.max(mine.sessionId === s.sessionId ? (mine.sentAt ?? 0) : 0, heal[x.name] ?? 0) || null
      const asked = !o.reask && mine.sessionId === s.sessionId && mine.askedAt ? { at: mine.askedAt, ctx: mine.askedCtx ?? 0 } : null
      const v = smartVerdict(conf, { role: x.role, status: s.status, idleSince: since, tail, max }, { now, lastSent, asked })
      const base = { at: new Date(now).toISOString(), session: x.name, role: x.role, pid: s.pid, sessionId: s.sessionId, ctxBefore: tail.ctx, max, threshold: v.threshold, idleMin: v.idleMin ?? null, dryRun: conf.dryRun }
      if (v.verdict !== 'ask') {
        const d = { ...base, stage: 'gate', decision: 'skip', reason: v.why }
        decisions.push(d)
        // big enough to be a candidate: the skip is a decision worth keeping
        if (tail.ctx != null && tail.ctx >= v.threshold) logLine(root, d)
        continue
      }
      // the screen before the judge: a prompt that never reads empty costs no model call
      const tab = tabOf(x.name)
      if (!tab.handle && !conf.dryRun) { const d = { ...base, stage: 'gate', decision: 'skip', reason: tab.why }; decisions.push(d); logLine(root, d); continue }
      if (tab.handle && !screenEmpty(tab.handle)) { const d = { ...base, stage: 'gate', decision: 'skip', reason: 'its input line is not seen empty (somebody may be typing, or a menu is open)' }; decisions.push(d); logLine(root, d); continue }

      const mineTasks = tasks.filter((t) => x.role === 'lead' || (x.desk.names ?? []).concat([x.desk.name, x.desk.title]).includes(String(t.assigned ?? ''))).slice(0, 12)
      const header = [`Session: ${x.name}`, `Role: ${x.role}`, `Context: ${Math.round(tail.ctx / 1000)}K tokens of its ${Math.round(max / 1000)}K maximum`, `Idle at its prompt: ${v.idleMin} min${v.done ? ' (its last turn matched the office\'s "unit of work finished" pattern)' : ''}`,
        mineTasks.length ? `Open tasks on the office queue for it: ${mineTasks.map((t) => `${t.id} "${String(t.title ?? '').slice(0, 60)}" (${t.state})`).join('; ')}` : 'Open tasks on the office queue for it: none',
        ...(x.role === 'desk' ? (() => { const w = workFor(x.desk); return [w.length ? `Work the office lists as waiting for it (keep these ids): ${w.slice(0, 10).join(' | ').slice(0, 1500)}` : 'Work the office lists as waiting for it: none'] })() : [])].join('\n')
      const tailChars = conf.tailTokens * 4
      const j = judge(conf, header, condensedTail(home, s, tailChars), { run: o.run ?? spawnSync })
      st.sessions[x.name] = { ...(mine.sessionId === s.sessionId ? mine : {}), sessionId: s.sessionId, askedAt: now, askedCtx: tail.ctx }
      writeState(root, st)
      const d = { ...base, stage: 'judge', decision: j.compact_now ? (conf.dryRun ? 'would-compact' : 'compact') : 'no', reason: j.reason, keep: j.keep || null, judge: { model: conf.model, ok: j.ok, ms: j.ms, cost_usd: j.cost ?? null, tokens: j.tokens ?? null }, gate: v.why }
      if (j.compact_now && !conf.dryRun) {
        // ⛔ THE FRESH LOOK: the judge took seconds; anything that moved is left alone
        const fresh = liveSessions(home, o.freshProcs ? o.freshProcs() : processTable(), Date.now()).find((y) => y.pid === s.pid && y.name === x.name)
        const t2 = sessionTail(home, s)
        if (!fresh || (fresh.statusUpdatedAt ?? null) !== (s.statusUpdatedAt ?? null) || t2.pending || t2.queued > 0 || (t2.lastAt ?? 0) > (tail.lastAt ?? 0)) { d.decision = 'skip'; d.sendWhy = 'it moved while the judge read it; left alone' }
        else if (!tab.handle || !screenEmpty(tab.handle)) { d.decision = 'skip'; d.sendWhy = tab.why ?? 'its input line is no longer empty' }
        else {
          const text = `/compact ${j.keep}`
          st.sessions[x.name] = { ...st.sessions[x.name], sentAt: Date.now(), ctxBefore: tail.ctx, afterLogged: false }
          writeState(root, st)
          const t1 = Date.now()
          try { termOf().send(tab.handle, text); d.sent = true; d.typeMs = Date.now() - t1 }
          catch (e) { d.sent = false; d.sendWhy = e.message ?? String(e) }
        }
      }
      decisions.push(d)
      logLine(root, d)
    }
    writeState(root, st)
    return { ran: true, decisions }
  } finally { unlock() }
}

// the board's built-in panel: the judge's decisions and the compactions, newest first
export function panelItems(root, n = 60) {
  const all = readLog(root, 2000).filter((e) => e.kind === 'after' || e.stage === 'judge')
  return all.slice(-n).reverse().map((e) => e.kind === 'after'
    ? { title: `${e.session}: compacted ${Math.round((e.preTokens ?? e.ctxBefore ?? 0) / 1000)}K → ${Math.round((e.postTokens ?? 0) / 1000)}K${e.nextCtx ? ` (next turn ${Math.round(e.nextCtx / 1000)}K)` : ''}`, detail: `sent ${e.sentAt}; ${e.trigger ?? ''} compaction at ${e.compactedAt}`, at: e.at }
    : { title: `${e.session}: ${e.decision}${e.dryRun ? ' (dry run)' : ''} at ${Math.round((e.ctxBefore ?? 0) / 1000)}K of ${Math.round((e.max ?? 0) / 1000)}K`, detail: `${e.reason ?? ''}${e.keep ? ` · keep: ${e.keep}` : ''}${e.sendWhy ? ` · ${e.sendWhy}` : ''}${e.judge?.cost_usd != null ? ` · $${e.judge.cost_usd.toFixed(4)}` : ''}`, at: e.at })
}

//   node lib/smart-compact.mjs [root] pass [--now] [--reask] [--dry-run] [--only a,b] [--enable] [--json]
//   node lib/smart-compact.mjs [root] panel
// --enable judges as if compact.smart.enable were true (with the office's
// other numbers): a dry look at an office that has not switched it on.
if (isMain(import.meta.url)) {
  const a = process.argv.slice(2)
  const root = a[0] && !['pass', 'panel'].includes(a[0]) ? findOffice(a.shift()) : findOffice(process.cwd())
  const verb = a.shift()
  if (!root || !['pass', 'panel'].includes(verb)) { console.error('usage: node lib/smart-compact.mjs [root] pass [--now] [--reask] [--dry-run] [--only a,b] [--enable] [--json] | panel'); process.exit(1) }
  if (verb === 'panel') { const items = panelItems(root); process.stdout.write(JSON.stringify({ items, note: items.length ? null : 'no smart compact decision yet' })); process.exit(0) }
  const flag = (f) => a.includes(f)
  const onlyAt = a.indexOf('--only')
  const cfg = readOfficeConfig(root)
  const conf = smartConfig(flag('--enable') ? { ...cfg, compact: { ...(cfg.compact ?? {}), smart: { ...(cfg.compact?.smart ?? {}), enable: true } } } : cfg)
  if (!conf) { console.log('smart compact: off (office.json compact.smart.enable is not true)'); process.exit(0) }
  const r = smartPass(root, { cfg, conf, force: flag('--now'), reask: flag('--reask'), dryRun: flag('--dry-run') ? true : null, only: onlyAt >= 0 ? String(a[onlyAt + 1] ?? '').split(',').filter(Boolean) : null })
  if (flag('--json')) { process.stdout.write(JSON.stringify(r, null, 1) + '\n'); process.exit(0) }
  if (!r.ran) { console.log(`smart compact: ${r.why}`); process.exit(0) }
  for (const d of r.decisions) console.log(`${d.session.padEnd(30)} ${String(Math.round((d.ctxBefore ?? 0) / 1000)).padStart(4)}K/${Math.round(d.max / 1000)}K ${d.decision}${d.dryRun && d.stage === 'judge' ? ' (dry run)' : ''}: ${d.reason}${d.keep ? `\n${' '.repeat(31)}keep: ${d.keep}` : ''}${d.judge?.cost_usd != null ? `\n${' '.repeat(31)}judge: $${d.judge.cost_usd.toFixed(4)}, ${d.judge.tokens?.in} in / ${d.judge.tokens?.out} out, ${d.judge.ms} ms` : ''}`)
}
