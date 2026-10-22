// USAGE-LIMIT RESUME (0.15.0): a session stopped by the Claude usage limit is
// resumed once the limit has lifted, instead of sitting with its queue undone.
//
// alibaba-98, 2026-10-21: "You've hit your weekly limit · resets Oct 27 at 1pm
// (Asia/Tokyo)" at 20:41Z. The account worked again at 22:57Z (the lead's
// /login), but the session waited on: 17 messages queued, none delivered, until
// the owner clicked it by hand at 13:57Z the next day.
//
//   office.json "limits": { "office": true, "sessions": ["alibaba-98"],
//                           "skip": ["cs-*"], "jitterSec": [60, 240],
//                           "retryMin": 10, "fallback": "sonnet", "text": "…" }
//
// office     every live session working inside the office folder (lead, desks,
//            cs-*, case sessions); false = only the named ones
// sessions   more sessions by name, wherever they run (a peer outside the
//            office is invisible otherwise). An entry may pin its tab:
//            { "name": "alibaba-98", "tab": "<Orca tab title>" }
// skip       names (a trailing * matches a prefix) never touched
// fallback   a limit on ONE model ("Opus limit") switches a stuck desk to this
//            model at once and back after the reset; false = wait like the rest
//
// ⛔ OFF UNLESS office.json SAYS "limits". Typing into a session is the office's
// call, not a default of a plugin it installed.
// ⛔ THE TRANSCRIPT IS THE PROOF, NOT THE REGISTRY: a stuck session reads
// "busy" there. Stuck = its last conversational entry is the CLI's synthetic
// rate_limit banner. A later turn, or the CLI's own "usage limit has reset"
// continue, means it is moving: nothing is typed.
// ⛔ THE BANNER'S RESET IS NOT THE ONLY WAY OUT. A limit lifts early (another
// login, a plan change); another session on this account answering for real
// after the banner proves it. Resume at the earlier of the two, plus a
// per-session jitter so a fleet does not spend fresh quota at once.
// ⛔ ONE TRY AND ONE RETRY PER LIMIT, keyed by the banner (its uuid), never by
// the session: the next limit is a new one, and the same one never a third time.
// ⛔ NOT INTO A QUESTION. The limit's own menu is answered only when its cursor
// is on "Stop and wait for limit to reset" (the choice that spends nothing);
// any other open menu is refused and rung to the lead.
// Not done, on purpose: moving work to another session. A session or weekly
// limit stops every session on the account, so the work would move to someone
// equally stuck; buyer routing is the office's own (owner-locked) machinery.
import { statSync, openSync, readSync, closeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ancestors } from './procs.mjs'

const MIN = 60_000
const D = { jitterSec: [60, 240], retryMin: 10, fallback: 'sonnet' }
export const MAX_TRIES = 2
export const RESUME_TEXT = 'Your usage limit has lifted. Continue the task you were working on when the limit was reached; do not repeat work that is already complete.'

// -> null (off) | config
export function limitsConfig(cfg) {
  const C = cfg?.limits
  if (!C || typeof C !== 'object' || Array.isArray(C) || C.on === false) return null
  const sessions = (Array.isArray(C.sessions) ? C.sessions : []).map((x) => (typeof x === 'string' ? { name: x, tab: null } : x && typeof x.name === 'string' ? { name: x.name, tab: typeof x.tab === 'string' ? x.tab : null } : null)).filter((x) => x?.name)
  const j = Array.isArray(C.jitterSec) && C.jitterSec.length === 2 && C.jitterSec.every((n) => Number.isFinite(n) && n >= 0 && n <= 3600) && C.jitterSec[0] <= C.jitterSec[1] ? C.jitterSec : D.jitterSec
  const text = typeof C.text === 'string' && C.text.trim() ? C.text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) : RESUME_TEXT
  const fallback = C.fallback === false ? null : typeof C.fallback === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(C.fallback) ? C.fallback : D.fallback
  return {
    office: C.office !== false, sessions, skip: (Array.isArray(C.skip) ? C.skip : []).filter((x) => typeof x === 'string' && x),
    jitterSec: j, retryMin: Number.isFinite(C.retryMin) && C.retryMin >= 2 && C.retryMin <= 240 ? C.retryMin : D.retryMin, fallback, text,
  }
}

const skipped = (conf, name) => conf.skip.some((p) => (p.endsWith('*') ? String(name ?? '').startsWith(p.slice(0, -1)) : name === p))
const inside = (root, cwd) => !!cwd && (resolve(cwd) === resolve(root) || resolve(cwd).startsWith(resolve(root) + '/'))

// the live sessions this office watches -> [{ session, tab }]
export function watched(root, conf, sessions) {
  if (!conf) return []
  const out = []
  for (const s of sessions) {
    const named = conf.sessions.find((x) => x.name === s.name)
    if (skipped(conf, s.name)) continue
    if (named || (conf.office && inside(root, s.cwd))) out.push({ session: s, tab: named?.tab ?? null })
  }
  return out
}

// ── the banner ──────────────────────────────────────────────────────────────
export const isBanner = (e) => e?.type === 'assistant' && e.isApiErrorMessage === true && e.error === 'rate_limit' && !e.isSidechain
const isReal = (e) => e?.type === 'assistant' && !e.isApiErrorMessage && !e.isSidechain && e.message?.model && e.message.model !== '<synthetic>'
const textOf = (e) => { const c = e?.message?.content; return typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => x?.text ?? '').join(' ') : '' }
const tsOf = (e) => { const t = Date.parse(e?.timestamp ?? ''); return Number.isFinite(t) ? t : null }

// "You've hit your Opus limit" -> 'opus'; a session or weekly limit names none
export const limitModel = (text) => /\b(opus|sonnet|fable|haiku)\b[^·]*\blimit/i.exec(String(text ?? ''))?.[1].toLowerCase() ?? null

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
// ms to add to a UTC instant to read the wall clock in zone
function offsetMs(at, zone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(at)).map((x) => [x.type, x.value]))
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(at / 1000) * 1000
}
// "resets 3:50am (Asia/Tokyo)" | "resets Oct 27 at 1pm (Asia/Tokyo)" -> ms | null
// A bare time is the first one after the banner was written; no zone is no answer.
export function resetFromText(text, at) {
  const m = /resets?\s+(?:at\s+)?(?:([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s+at)?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(([^)]+)\)/i.exec(String(text ?? ''))
  if (!m || !Number.isFinite(at)) return null
  const [, mon, day, hh, mm = '0', ap, zone] = m
  const h = (Number(hh) % 12) + (ap.toLowerCase() === 'pm' ? 12 : 0)
  try {
    const local = new Date(at + offsetMs(at, zone))
    const mi = mon ? MONTHS.indexOf(mon.toLowerCase()) : local.getUTCMonth()
    if (mi < 0) return null
    const inst = (y, mo, d) => { const wall = Date.UTC(y, mo, d, h, Number(mm)); return wall - offsetMs(wall - offsetMs(wall, zone), zone) }
    let t = inst(local.getUTCFullYear(), mi, mon ? Number(day) : local.getUTCDate())
    if (t <= at) t = mon ? inst(local.getUTCFullYear() + 1, mi, Number(day)) : t + 24 * 3_600_000
    return t
  } catch { return null }
}
// the CLI's own epoch seconds when it wrote them (2.1.30x), else the text
export function resetOf(e) {
  const s = e?.apiErrorParams?.rate_limit_info?.resetsAt ?? e?.quotaLimits?.resetsAt
  if (Number.isFinite(s) && s > 0) return s * 1000
  return resetFromText(textOf(e), tsOf(e))
}

function tailEntries(path, bytes) {
  try {
    const st = statSync(path)
    const n = Math.min(st.size, bytes)
    const fd = openSync(path, 'r'); const buf = Buffer.alloc(n); readSync(fd, buf, 0, n, st.size - n); closeSync(fd)
    const out = []
    for (const l of buf.toString('utf8').split('\n')) { if (!l) continue; try { out.push(JSON.parse(l)) } catch {} }
    return out
  } catch { return [] }
}
export const transcriptOf = (home, s) => (s?.sessionId && s?.cwd ? join(home, '.claude', 'projects', resolve(s.cwd).replace(/[^A-Za-z0-9]/g, '-'), s.sessionId + '.jsonl') : null)
const conversational = (e) => (e.type === 'assistant' || e.type === 'user') && !e.isSidechain && !e.isMeta

// one live session -> null (not stuck) | the limit it is stuck on:
// { uuid (the first banner of this stop), last (the newest banner), since, text,
//   resetAt, model, kind, queued, doing, ownModel }
export function stuckOn(home, s, { bytes = 1024 * 1024 } = {}) {
  const p = transcriptOf(home, s)
  if (!p) return null
  // cheap first: almost every session is not stuck, and 64 KB says so
  let es = tailEntries(p, 64 * 1024)
  const lastOf = (a) => { for (let i = a.length - 1; i >= 0; i--) if (conversational(a[i])) return i; return -1 }
  let i = lastOf(es)
  if (i < 0 || !isBanner(es[i])) return null
  es = tailEntries(p, bytes)
  i = lastOf(es)
  if (i < 0 || !isBanner(es[i])) return null
  const last = es[i]
  // back to the last real answer: the first banner after it opened this stop
  let first = last, j = i, ownModel = null, doing = null
  for (j = i; j >= 0; j--) {
    const e = es[j]
    if (isReal(e)) { ownModel = e.message.model; break }
    if (isBanner(e)) first = e
  }
  for (let k = j; k >= 0 && !doing; k--) {
    const e = es[k]
    if (e.type === 'user' && !e.isSidechain && !e.isMeta && typeof e.message?.content === 'string' && !/^\s*</.test(e.message.content)) doing = e.message.content.replace(/\s+/g, ' ').trim().slice(0, 140)
  }
  // after the newest banner: the CLI's own continue = it is resuming itself
  const after = es.slice(es.indexOf(last) + 1)
  if (after.some((e) => e.type === 'queue-operation' && e.operation === 'enqueue' && /usage limit has reset/i.test(String(e.content ?? '')))) return null
  const since = tsOf(first)
  const fromFirst = es.slice(es.indexOf(first) + 1).filter((e) => e.type === 'queue-operation')
  const queued = Math.max(0, fromFirst.filter((e) => e.operation === 'enqueue').length - fromFirst.filter((e) => e.operation === 'dequeue').length)
  const text = textOf(last)
  return {
    uuid: first.uuid ?? `${s.sessionId}@${first.timestamp}`, last: last.uuid ?? null, since, text: text.slice(0, 200),
    resetAt: resetOf(last), model: limitModel(text), kind: last.quotaLimits?.rateLimitType ?? last.apiErrorParams?.rate_limit_info?.rateLimitType ?? null,
    queued, doing, ownModel,
  }
}

// the newest real answer in a session's transcript tail -> { at, model } | null
export function lastAnswer(home, s, bytes = 256 * 1024) {
  const p = transcriptOf(home, s)
  if (!p) return null
  const es = tailEntries(p, bytes)
  for (let i = es.length - 1; i >= 0; i--) if (isReal(es[i])) return { at: tsOf(es[i]), model: es[i].message.model }
  return null
}

// has the limit lifted early? Another session of this account answered for real
// after the banner (for a model's limit: on that model) -> { by, at } | null
export function liftedBy(home, limit, others) {
  let best = null
  for (const s of others) {
    const a = lastAnswer(home, s)
    if (!a?.at || a.at <= limit.since) continue
    if (limit.model && !String(a.model).toLowerCase().includes(limit.model)) continue
    if (!best || a.at > best.at) best = { by: s.name || `pid ${s.pid}`, at: a.at }
  }
  return best
}

// a stable per-session delay, so a fleet stuck on one limit does not resume at once
export function jitterMs(conf, key) {
  const [lo, hi] = conf.jitterSec
  let h = 0
  for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return (lo + (hi > lo ? h % (hi - lo + 1) : 0)) * 1000
}

// when to resume: a model's limit with a fallback (a desk) at once; otherwise the
// earlier of the reset and the first time the lift was seen. null = not known yet
export function dueAt(conf, limit, { liftSeen = null, isDesk = false, key = limit.uuid } = {}) {
  const j = jitterMs(conf, key)
  if (limit.model && conf.fallback && isDesk && !conf.fallback.toLowerCase().includes(limit.model)) return (limit.since ?? 0) + j
  const base = [limit.resetAt, liftSeen].filter(Number.isFinite)
  return base.length ? Math.min(...base) + j : null
}

// the screen: a menu is open, and is it the limit's own with the cursor on "Stop and wait"?
export function menuOf(screen) {
  const lines = String(screen ?? '').split('\n').map((l) => l.replace(/[│┃╭╮╰╯─━]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(-15)
  const open = lines.some((l) => /what do you want to do\?/i.test(l)) || lines.filter((l) => /^(?:❯\s*)?\d+\.\s/.test(l)).length >= 2
  if (!open) return null
  const cursor = lines.find((l) => /^❯\s*\d+\./.test(l)) ?? null
  return { cursor, wait: !!cursor && /^❯\s*1\.\s*stop and wait for limit to reset/i.test(cursor) }
}

// ⛔ TYPE ONLY AT AN EMPTY PROMPT. An unreadable screen is not "no menu": the
// input line must be seen, empty ("❯" alone), before anything is typed.
export function atPrompt(screen) {
  const lines = String(screen ?? '').split('\n').map((l) => l.replace(/[│┃╭╮╰╯─━]/g, ' ').replace(/\s+/g, ' ').trim())
  return lines.some((l) => /^[❯>]$/.test(l))
}

// a tab for a session -> { handle } | { why }. By its own name; else a pinned
// title; else the only agent tab in its folder. Anything else is a guess.
export function tabFor(tabs, s, pinned = null) {
  const strip = (t) => String(t ?? '').replace(/^[^\w\s]+\s+/u, '').trim()
  const one = (list, what) => (list.length === 1 ? { handle: list[0].handle } : list.length ? { why: `${list.length} tabs are ${what}: not guessing` } : null)
  const byName = one(tabs.filter((t) => strip(t.title) === s.name), `titled ${s.name}`)
  if (byName) return byName
  if (pinned) return one(tabs.filter((t) => strip(t.title) === pinned), `titled ${pinned}`) ?? { why: `no tab titled ${pinned} (office.json limits.sessions)` }
  const here = tabs.filter((t) => t.agent && t.path && s.cwd && resolve(t.path) === resolve(s.cwd))
  return one(here, `agents in ${s.cwd}`) ?? { why: `no tab titled ${s.name}, and no single agent tab in ${s.cwd}` }
}

export const fmt = (t) => (Number.isFinite(t) ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') + 'Z' : '?')

// ⛔ A REGISTRY'S "tmux" IS NOT AN ADDRESS. Orca writes the same "orca:@0.%1"
// for every session it runs (the lead and alibaba-98 both, 2026-10-22), and
// there is no tmux on that Mac. A pane is used only when tmux answers for it
// AND its shell is an ancestor of the session's own claude process.
// -> { send(text), enter(), screen() } | null
export function tmuxPane(s, procs, run) {
  const pane = /%\d+$/.exec(String(s?.tmux ?? ''))?.[0]
  if (!pane || !procs?.size) return null
  const tm = (...a) => run('tmux', a, { encoding: 'utf8', timeout: 5000 })
  const r = tm('display-message', '-p', '-t', pane, '#{pane_pid}')
  if (r.error || r.status !== 0) return null
  const pp = Number(String(r.stdout).trim())
  if (!ancestors(s.pid, procs).includes(pp)) return null
  const ok = (x) => { if (x.error || x.status !== 0) throw new Error(`tmux: ${x.error?.message ?? String(x.stderr ?? '').trim() ?? 'exit ' + x.status}`) }
  return {
    pane,
    send: (text) => { ok(tm('send-keys', '-t', pane, '-l', text)); ok(tm('send-keys', '-t', pane, 'Enter')) },
    enter: () => ok(tm('send-keys', '-t', pane, 'Enter')),
    screen: () => { const x = tm('capture-pane', '-p', '-t', pane); return x.error || x.status !== 0 ? '' : String(x.stdout) },
  }
}
