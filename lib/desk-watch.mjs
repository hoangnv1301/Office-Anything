// ARE THE DESKS WORKING, AND NOT TROUBLESOME? From local facts only, with no
// model in the loop: Claude Code's session registry, each session's
// transcript, desk.json and the office alert log.
//
//   node lib/desk-watch.mjs [root]            one line per problem; nothing when healthy
//   node lib/desk-watch.mjs [root] --table    one row per desk and teammate session
//   node lib/desk-watch.mjs [root] --json     [{key, line}] for an office.json sweep check
//   node lib/desk-watch.mjs [root] --alert    also write typed lines to the alert log
//
// Flags (office.json "deskWatch", defaults in DEFAULTS):
//   DESK-DEAD     a desk expected to run has no live session
//   DESK-STUCK    a dialog open past waitingMinutes; busy with a silent transcript
//                 past staleMinutes; a message delivered and not answered past
//                 unansweredMinutes
//   DESK-LOOP     the same tool call (or the same message) over loopRepeats times
//                 in windowMinutes; errorStreak tool errors or wall refusals in a row
//   DESK-NOISY    over noisyPerHour messages sent in the last hour
//   DESK-CONTEXT  over maxContextPerCall average context over its last calls
//                 (unset: 75% of the session's office.json context cap, else 300K)
// Office-specific questions (claims nobody renews, a buyer thread a desk does
// not own) are the office's own commands in deskWatch.checks, run like sweep
// checks, each printed line a DESK-TROUBLE problem.
//
// ⛔ Nothing is killed, restarted or sent from here. A problem a message can
// fix carries a nudge: the exact text for the lead to send to that session.
// An alert prints once per cause, again every alertRepeatMinutes while it
// stands, and a DESK-RESOLVED line when it clears.
import { readFileSync, writeFileSync, mkdirSync, openSync, readSync, fstatSync, closeSync, readdirSync, statSync } from 'node:fs'
import { join, sep, relative } from 'node:path'
import { homedir } from 'node:os'
import { findOffice, readOfficeConfig } from './office.mjs'
import { rosterSafe, sessionOf } from './desk.mjs'
import { liveSessions, processTable, unreadableSessions } from './procs.mjs'
import { writeAlert, alertLine, alertsFile } from './alerts.mjs'
import { runCheck } from './sweep.mjs'
import { contextCap } from './context.mjs'
import { isMain } from './is-main.mjs'
import { readSwitch, deskOn, openWork, idledState } from './desks.mjs'
import { leadReach } from './lead-reach.mjs'

// maxContextPerCall: unset, it follows the session's context cap (capWarnFraction of it), else 300K
export const DEFAULTS = { windowMinutes: 30, staleMinutes: 20, waitingMinutes: 10, unansweredMinutes: 20, loopRepeats: 5, errorStreak: 5, noisyPerHour: 12, maxContextPerCall: null, capWarnFraction: 0.75, alertRepeatMinutes: 30, leadNames: [] }
const slugOf = (d) => String(d).replace(/[^A-Za-z0-9]/g, '-')
const MIN = 60_000

// the last bytes of a transcript, whole lines only: a long session's file is large
function tailLines(file, bytes = 4 << 20) {
  let fd
  try {
    fd = openSync(file, 'r')
    const size = fstatSync(fd).size, start = Math.max(0, size - bytes)
    const buf = Buffer.alloc(size - start)
    readSync(fd, buf, 0, buf.length, start)
    const lines = buf.toString('utf8').split('\n')
    if (start > 0) lines.shift()
    return lines
  } catch { return [] } finally { if (fd !== undefined) closeSync(fd) }
}

const texts = (c) => typeof c === 'string' ? [c] : Array.isArray(c) ? c.flatMap((x) => x?.type === 'text' ? [x.text ?? ''] : x?.type === 'tool_result' ? texts(x.content) : []) : []

// what a transcript says about one session
export function readTranscript(file, now, o = DEFAULTS) {
  const win = now - o.windowMinutes * MIN
  const r = { last: 0, model: null, ctx: [], calls: {}, results: [], sent: [], inbound: [] }
  const seen = new Set()
  for (const line of tailLines(file)) {
    if (!line) continue
    let j; try { j = JSON.parse(line) } catch { continue }
    const ts = Date.parse(j.timestamp ?? '')
    if (!(ts > 0)) continue
    r.last = Math.max(r.last, ts)
    const m = j.message
    if (j.type === 'assistant' && m) {
      if (m.model && m.model !== '<synthetic>') r.model = m.model
      if (m.usage && m.id && !seen.has(m.id)) { seen.add(m.id); r.ctx.push(m.usage.cache_read_input_tokens ?? 0) }
      for (const c of Array.isArray(m.content) ? m.content : []) {
        if (c?.type !== 'tool_use') continue
        if (c.name === 'SendMessage') r.sent.push({ ts, to: String(c.input?.to ?? ''), text: String(c.input?.message ?? '') })
        if (ts >= win) { const k = c.name + ' ' + JSON.stringify(c.input ?? {}); r.calls[k] = (r.calls[k] ?? 0) + 1 }
      }
    } else if (j.type === 'user' && m) {
      const content = m.content
      for (const c of Array.isArray(content) ? content : []) {
        if (c?.type === 'tool_result' && ts >= win) r.results.push(c.is_error === true || /desk wall|blocked by .*hook|PreToolUse.*(denied|blocked)/i.test(texts(c.content).join(' ')))
      }
      for (const t of texts(content)) for (const x of t.matchAll(/<cross-session-message from="([^"]+)"(?: from-name="([^"]*)")?/g)) r.inbound.push({ ts, from: x[1], name: x[2] ?? '' })
    }
  }
  return r
}

export function judge(s, t, o, now) {
  const p = []
  const add = (type, cause, line, nudge = null) => p.push({ type, cause, key: `${type}:${s.label}:${cause}`, line: `${s.label}: ${line}`, nudge })
  const quietMin = t.last ? Math.round((now - t.last) / MIN) : null
  if (s.status === 'waiting' && now - (s.statusUpdatedAt ?? now) > o.waitingMinutes * MIN) add('DESK-STUCK', 'dialog', `a dialog has been open for ${Math.round((now - s.statusUpdatedAt) / MIN)} min (${s.waitingFor ?? 'waiting'}); someone has to answer it in its terminal`)
  if (s.status === 'busy' && quietMin !== null && quietMin > o.staleMinutes) add('DESK-STUCK', 'silent', `busy, but its transcript has been silent for ${quietMin} min`, `You have been busy for ${quietMin} minutes without writing anything. If you are stuck, stop, say what blocks you, and wait for the lead.`)
  for (const m of t.inbound) {
    if (now - m.ts < o.unansweredMinutes * MIN || now - m.ts > 6 * 60 * MIN) continue
    const answered = t.sent.some((x) => x.ts > m.ts && (x.to === m.from || (m.name && x.to === m.name)))
    if (!answered) { add('DESK-STUCK', `inbox:${m.from}:${m.ts}`, `a message from ${m.name || m.from} has been unanswered for ${Math.round((now - m.ts) / MIN)} min`, `A message from ${m.name || m.from} reached you ${Math.round((now - m.ts) / MIN)} minutes ago and has no reply yet. Please answer it.`); break }
  }
  const [loopKey, loopN] = Object.entries(t.calls).sort((a, b) => b[1] - a[1])[0] ?? []
  if (loopN > o.loopRepeats) add('DESK-LOOP', 'repeat', `made the same call ${loopN} times in ${o.windowMinutes} min: ${loopKey.slice(0, 100)}`, `You have made the same call ${loopN} times in ${o.windowMinutes} minutes (${loopKey.slice(0, 80)}). Stop repeating it, say what you expected to happen, and wait for the lead.`)
  let run = 0, worst = 0
  for (const bad of t.results) { run = bad ? run + 1 : 0; worst = Math.max(worst, run) }
  if (worst >= o.errorStreak) add('DESK-LOOP', 'errors', `${worst} tool errors or wall refusals in a row in ${o.windowMinutes} min`, `Your last ${worst} tool calls failed or were refused. Do not retry another way: stop, say what you were trying to do, and ask the lead.`)
  if (!s.isLead) {
    const lead = new Set(o.leadNames.map(String))
    const hour = t.sent.filter((x) => now - x.ts < 60 * MIN && (!lead.size || lead.has(x.to)))
    if (hour.length > o.noisyPerHour) add('DESK-NOISY', 'messages', `sent ${hour.length} messages in the last hour${lead.size ? ' to the lead' : ''} (limit ${o.noisyPerHour})`, `You sent ${hour.length} messages in the last hour. Please batch updates into one message when there is real news.`)
  }
  const recent = t.ctx.slice(-10)
  const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0
  const limit = o.maxContextPerCall ?? (s.cap ? Math.round(s.cap * o.capWarnFraction) : 300_000)
  if (recent.length >= 3 && avg > limit) add('DESK-CONTEXT', 'size', `averages ${Math.round(avg / 1000)}K context per call over its last ${recent.length} calls (limit ${Math.round(limit / 1000)}K${!o.maxContextPerCall && s.cap ? `, ${Math.round(o.capWarnFraction * 100)}% of its ${Math.round(s.cap / 1000)}K cap` : ''}); when it is idle, compact it in its terminal (/compact) or restart it with /desk-start`)
  return { quietMin, avgCtx: Math.round(avg), problems: p }
}

export function watch(root, { cfg = readOfficeConfig(root), configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), sessions = null, now = Date.now(), runChecks = true } = {}) {
  const o = { ...DEFAULTS, ...(cfg.deskWatch && typeof cfg.deskWatch === 'object' ? cfg.deskWatch : {}) }
  const all = sessions ?? liveSessions(homedir(), processTable(), now)
  const live = all.filter((s) => s.cwd && (s.cwd === root || s.cwd.startsWith(root + sep)))
  const rows = [], problems = []
  for (const s of live) {
    const rel = relative(root, s.cwd).split(sep)
    const desk = rel[0] === 'desks' && rel[1] ? rel[1] : null
    const isLead = !desk && s.cwd === root
    const tag = desk ? sessionOf(join(root, 'desks'), desk) : null
    const label = s.name || (desk ? tag : isLead ? 'lead' : rel.join('/'))
    const t = readTranscript(join(configDir, 'projects', slugOf(s.cwd), `${s.sessionId}.jsonl`), now, o)
    let cap = null
    try { cap = contextCap(cfg, { desk, isLead, teammate: !!desk && label !== tag && label !== `desk-${desk}` }) } catch {}
    const j = judge({ ...s, label, isLead, cap }, t, o, now)
    rows.push({ label, desk, alive: true, state: s.status === 'busy' ? 'working' : s.status ?? '?', quietMin: j.quietMin, avgCtx: j.avgCtx, model: t.model })
    problems.push(...j.problems)
  }
  const sw = readSwitch(root)
  for (const d of rosterSafe(join(root, 'desks')).desks) {
    // off on this machine (lib/desks.mjs): not dead, but it may still owe work
    if (!sw.error && !deskOn(sw, d).on) {
      if (!runChecks || d.kind === 'lead') continue
      const w = openWork(root, d, { cfg })
      if (w.items.length || w.unknown.length) problems.push({ type: 'DESK-OFF', cause: 'open', key: `DESK-OFF:desk-${d.name}:open`, line: `${d.session}: off on this machine with ${w.items.length ? w.items.length + ' open item(s): ' + w.items.slice(0, 3).join('; ') : 'open work unknown (' + w.unknown[0] + ')'}`, nudge: null })
      continue
    }
    if (!(d.autostart !== false || d.watch === true)) continue
    if (live.some((s) => s.cwd === join(root, 'desks', d.name))) continue
    // closed when idle, nothing waiting (lib/desks.mjs): not dead
    if (idledState(root, cfg, d.name, { configDir, sessions: live, now })?.state === 'idled') continue
    rows.push({ label: d.session, desk: d.name, alive: false, state: 'dead', quietMin: null, avgCtx: 0, model: d.model ?? null })
    problems.push({ type: 'DESK-DEAD', cause: 'dead', key: `DESK-DEAD:desk-${d.name}:dead`, line: `${d.session}: no live session (start it with /desk-start ${d.name})`, nudge: null })
  }
  // can the desks reach the lead by name (lib/lead-reach.mjs)
  problems.push(...leadReach(root, cfg, { sessions: all, unreadable: sessions ? [] : unreadableSessions(homedir(), processTable()), configDir, now }))
  if (runChecks && Array.isArray(o.checks)) for (const c of o.checks) for (const it of runCheck(root, c)) problems.push({ type: 'DESK-TROUBLE', cause: it.key, key: `DESK-TROUBLE:${it.key}`, line: it.line, nudge: null })
  return { rows, problems }
}

// typed alert lines: once per cause, again every alertRepeatMinutes, resolved when it clears
export function alertProblems(root, cfg, problems, now = Date.now()) {
  const o = { ...DEFAULTS, ...(cfg.deskWatch ?? {}) }
  const file = join(root, '.office', 'desk-watch-state.json')
  let open = {}
  try { open = JSON.parse(readFileSync(file, 'utf8')) } catch {}
  const next = {}
  let written = 0
  for (const p of problems) {
    next[p.key] = p.line
    if (writeAlert(root, cfg, { type: p.type, subject: p.line.split(':')[0], text: p.line, quietKey: 'desk-watch:' + p.key, quietMs: o.alertRepeatMinutes * MIN, now })) written++
  }
  for (const [k, line] of Object.entries(open)) if (!(k in next)) { writeAlert(root, cfg, { type: 'DESK-RESOLVED', subject: line.split(':')[0], text: `resolved: ${k.split(':')[0]} ${line}`, now }); written++ }
  mkdirSync(join(root, '.office'), { recursive: true })
  writeFileSync(file, JSON.stringify(next))
  return written
}

// Did a message reach a desk, and did it act on it? Claude Code gives a
// sender no receipt ("in that session's inbox, not yet read"), so the desk's
// own transcript answers: -> { state: 'not seen' | 'delivered' | 'read' | 'answered', line }
//   delivered  the message is in its transcript; it has taken no turn since
//   read       it has taken a turn since, and sent its sender nothing
//   answered   it has sent its sender a message since
export function seen(root, desk, fragment, { configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), sessions = null, now = Date.now() } = {}) {
  const frag = String(fragment ?? '').trim()
  if (!frag) return { state: 'not seen', line: 'no text to look for' }
  const cwd = join(root, 'desks', desk)
  const dir = join(configDir, 'projects', slugOf(cwd))
  const own = [sessionOf(join(root, 'desks'), desk), `desk-${desk}`]
  const live = (sessions ?? liveSessions(homedir(), processTable(), now)).filter((x) => own.includes(x.name))
  let files = live.map((x) => join(dir, `${x.sessionId}.jsonl`))
  if (!files.length) { try { files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => join(dir, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs).slice(0, 1) } catch {} }
  let hit = null, after = false, reply = null
  for (const f of files) {
    for (const l of tailLines(f)) {
      if (!l) continue
      let j; try { j = JSON.parse(l) } catch { continue }
      const ts = Date.parse(j.timestamp ?? '')
      if (j.type === 'user' && j.message) {
        for (const t of texts(j.message.content)) {
          const x = /<cross-session-message from="([^"]+)"(?: from-name="([^"]*)")?/.exec(t)
          if (x && t.includes(frag)) { hit = { ts, from: x[1], name: x[2] ?? '' }; after = false; reply = null }
        }
      } else if (hit && j.type === 'assistant' && j.message && ts >= hit.ts) {
        after = true
        for (const c of Array.isArray(j.message.content) ? j.message.content : []) {
          const to = String(c?.input?.to ?? '').replace(/\s*\[[^\]]*\]\s*$/, '')
          if (c?.type === 'tool_use' && c.name === 'SendMessage' && (to === hit.from || (hit.name && to === hit.name))) reply = ts
        }
      }
    }
    if (hit) break
  }
  if (!hit) return { state: 'not seen', line: `desk-${desk}: no message containing "${frag.slice(0, 60)}" in its ${live.length ? 'live' : 'newest'} conversation${files.length ? '' : ' (none found)'}` }
  const at = (t) => `${Math.round((now - t) / MIN)} min ago`
  if (reply) return { state: 'answered', line: `desk-${desk}: delivered ${at(hit.ts)}, answered ${hit.name || hit.from} ${at(reply)}` }
  if (after) return { state: 'read', line: `desk-${desk}: delivered ${at(hit.ts)}, it has worked since, no reply to ${hit.name || hit.from} yet` }
  return { state: 'delivered', line: `desk-${desk}: delivered ${at(hit.ts)}, not read yet (no turn since)` }
}

if (isMain(import.meta.url)) {
  const a = process.argv.slice(2)
  const si = a.indexOf('seen')
  if (si >= 0) {
    const root = findOffice(si > 0 ? a[0] : process.cwd())
    if (!root || !a[si + 1] || !a[si + 2]) { console.error('usage: node lib/desk-watch.mjs [root] seen <desk> "<text from the message>"'); process.exit(1) }
    const r = seen(root, a[si + 1], a.slice(si + 2).join(' '))
    console.log(`${r.state.toUpperCase()} ${r.line}`)
    process.exit(r.state === 'not seen' ? 4 : 0)
  }
  const root = findOffice(a.find((x) => !x.startsWith('--')) ?? process.cwd())
  if (!root) { console.error('usage: node lib/desk-watch.mjs [root] [--table | --json] [--alert]'); process.exit(1) }
  const cfg = readOfficeConfig(root)
  const { rows, problems } = watch(root, { cfg })
  if (a.includes('--alert')) alertProblems(root, cfg, problems)
  if (a.includes('--json')) console.log(JSON.stringify(problems.map((p) => ({ key: p.key, line: `${p.type} ${p.line}${p.nudge ? ` → nudge: "${p.nudge}"` : ''}` }))))
  else if (a.includes('--table')) for (const r of rows) console.log(`${r.label.padEnd(28)} ${r.alive ? 'alive' : 'DEAD '}  ${String(r.state).padEnd(8)} ${r.quietMin === null ? '   -' : String(r.quietMin).padStart(4)} min  ${(Math.round(r.avgCtx / 1000) + 'K').padStart(5)}/call  ${r.model ?? '-'}`)
  else for (const p of problems) console.log(`${p.type} ${p.line}${p.nudge ? `\n  → nudge ${p.line.split(':')[0]}: "${p.nudge}"` : ''}`)
}
