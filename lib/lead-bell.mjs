// THE LEAD'S DOORBELL. Desks have one (desk.json "wake"); the lead had none,
// so in bypass mode it sat while builders' escalations came back
// "nudged:false" and a buyer waited an hour on drafts only it could clear.
//
//   node {plugin}/lib/lead-bell.mjs [root] [--once]
//
// Run under the Monitor tool (office.json lead.wake names this command, and
// the lead's boot text arms it). Each line it prints is one wake-up:
//
//   alert  a new line in the office's alert log whose TYPE the bell listens for
//   file   a new line matching a pattern in a log file the office names (a
//          desk's lead-alerts.log: what the lead used to tail by hand)
//   ask    a new open item from one of the office's read-only "asks": commands
//          printing one item per line, `<key>\t<text>` (or just text; the
//          whole line is then the key). The lead's inbox, held drafts it can
//          clear, proposals addressed to it: the office's book answers those
//
// office.json "lead.bell" (all optional):
//   { "every": 15, "types": ["HELD-LEAD", …], "repeatMinutes": 30, "maxPerMinute": 6,
//     "files": [{ "name": "buyers", "path": "desks/x/runtime/lead-alerts.log", "match": " (DRAFT|STALL|HUMAN) " }],
//     "asks": [{ "name": "inbox", "command": "node scripts/desk/ops.mjs ask lead-inbox" }] }
// files and asks are the OFFICE's (office.json), not the lead's: a lead that
// writes no file cannot add one.
//
// ⛔ ONE LINE PER THING, NOT PER POLL. An item rings when it first appears and
// again every repeatMinutes while it is still open; one that closes and comes
// back rings again. Over maxPerMinute, the rest wait for the next poll as one
// "+N more" line. A bell that rings on every poll is a bell nobody hears.
// ⛔ RESTART-SAFE. Its state (.office/lead-bell-state.json) holds the alert
// log's offset and what has rung: a restart resumes, it never replays the log.
// The very first run starts at the END of the log; open asks ring at once,
// because they are work waiting now.
// ⛔ AN ASK THAT FAILS IS SAID, ONCE, not taken as "nothing open".
// ⛔ READS ONLY. Asks run at the office root with a timeout; nothing is sent,
// typed or changed, except this bell's own state file.
import { readFileSync, writeFileSync, mkdirSync, statSync, openSync, readSync, closeSync, renameSync, existsSync, realpathSync } from 'node:fs'
const realpathOr = (p) => { try { return realpathSync(p) } catch { return p } }
import { join, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { findOffice, readOfficeConfig, sessionName } from './office.mjs'
import { departmentsOf } from './departments.mjs'
import { alertsFile } from './alerts.mjs'
import { isMain } from './is-main.mjs'

export const DEFAULT_TYPES = ['HELD-LEAD', 'HELD-RELEASED', 'UNREAD-STUCK', 'USAGE-LIMIT', 'DESK-DEAD', 'DESK-OFF', 'DESK-STUCK', 'LEAD-UNREACHABLE', 'LEAD-DUPLICATE', 'VERSION']
const MIN = 60_000

// ⛔ A PATTERN THAT CAN BACKTRACK FOREVER HANGS THE BELL, and with it every
// wake-up (alibaba-98's review, 2026-10-20: (a+)+$ hung node on 31 chars). A
// quantified group that itself holds a quantifier is refused at load, and a
// line is tested on its first MAX_LINE characters only.
export const MAX_LINE = 2000
export const nestedQuantifier = (src) => /\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*(?:[+*]|\{\d)/.test(src) || /\((?:[^()\\]|\\.)*\|(?:[^()\\]|\\.)*\)[+*]/.test(src)
function fileEntry(f, i) {
  const bad = (why) => ({ name: `files[${i}]`, error: why })
  if (!f || typeof f.name !== 'string' || !f.name || typeof f.path !== 'string' || !f.path) return bad('needs a name and a path')
  const src = typeof f.match === 'string' && f.match ? f.match : '.'
  if (src.length > 500) return bad('its match is longer than 500 characters')
  if (nestedQuantifier(src)) return bad('its match repeats a group that itself repeats (like (a+)+), which can hang on one line')
  try { return { name: f.name, path: f.path, match: new RegExp(src) } } catch (e) { return bad(`its match does not compile (${e.message})`) }
}
// ⛔ ONLY A DESK'S *.log, REALLY. A symlink called x.log in a runtime/ can
// point anywhere; the REAL path must be a .log under the office's desks/,
// with no hidden name on the way. -> null or why not
export function fileRefusal(root, rel) {
  const abs = resolve(root, rel)
  let real
  try { real = realpathSync(abs) } catch { return null }   // not there yet: checked again once it is
  const desks = (() => { try { return realpathSync(join(root, 'desks')) } catch { return join(root, 'desks') } })()
  if (!(real + sep).startsWith(desks + sep)) return `${rel} is not under the office's desks/ (it resolves to ${real})`
  if (!/\.log$/i.test(real)) return `${rel} is not a .log file`
  if (real.slice(desks.length).split(sep).some((x) => x.startsWith('.'))) return `${rel} goes through a hidden name`
  return null
}

export function bellConfig(cfg) {
  const B = cfg?.lead?.bell && typeof cfg.lead.bell === 'object' ? cfg.lead.bell : {}
  const num = (v, d, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)
  return {
    every: num(B.every, 15, 5, 300),
    types: Array.isArray(B.types) ? B.types.filter((t) => typeof t === 'string' && t).map((t) => t.toUpperCase()) : DEFAULT_TYPES,
    repeatMinutes: num(B.repeatMinutes, 30, 1, 24 * 60),
    maxPerMinute: num(B.maxPerMinute, 6, 1, 120),
    files: (Array.isArray(B.files) ? B.files : []).map((f, i) => fileEntry(f, i)),
    asks: (Array.isArray(B.asks) ? B.asks : []).filter((a) => a && typeof a.name === 'string' && typeof a.command === 'string' && a.command).map((a) => ({ name: a.name, command: a.command, timeoutSec: num(a.timeoutSec, 30, 1, 120) })),
  }
}

// ⛔ ONE STATE PER LEAD (departments, 0.12.0). ERP and AICS on one machine both
// run this bell; one shared state would let the first to poll consume the
// line the other never hears. With departments, the file is keyed by the lead.
export const stateFile = (root, lead = '') => join(root, '.office', lead ? `lead-bell-state-${String(lead).replace(/[^A-Za-z0-9_-]/g, (c) => '_' + c.codePointAt(0).toString(16))}.json` : 'lead-bell-state.json')
export function loadState(root, lead = '') {
  try { const s = JSON.parse(readFileSync(stateFile(root, lead), 'utf8')); return { offset: Number(s.offset) || 0, file: s.file ?? null, files: s.files ?? {}, rung: s.rung ?? {}, sent: Array.isArray(s.sent) ? s.sent : [], held: s.held ?? 0 } }
  catch { return null }
}
function saveState(root, s, lead = '') {
  mkdirSync(join(root, '.office'), { recursive: true })
  if (!existsSync(join(root, '.office', '.gitignore'))) writeFileSync(join(root, '.office', '.gitignore'), '# office-anything state and logs; never committed\n*\n')
  const tmp = stateFile(root, lead) + '.tmp'
  writeFileSync(tmp, JSON.stringify(s))
  renameSync(tmp, stateFile(root, lead))
}

// new whole lines in the alert log since `offset`. A log that shrank (rotated) restarts at 0
function newAlertLines(file, offset) {
  let size = 0
  try { size = statSync(file).size } catch { return { lines: [], offset: 0 } }
  if (size < offset) offset = 0
  if (size === offset) return { lines: [], offset }
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(Math.min(size - offset, 1 << 20))
    readSync(fd, buf, 0, buf.length, offset)
    const text = buf.toString('utf8')
    const end = text.lastIndexOf('\n')
    if (end < 0) return { lines: [], offset }
    return { lines: text.slice(0, end).split('\n').filter(Boolean), offset: offset + Buffer.byteLength(text.slice(0, end + 1)) }
  } finally { closeSync(fd) }
}

// One poll. -> { lines: [string], state }
export function poll(root, cfg, { now = Date.now(), run = spawnSync, state = loadState(root) } = {}) {
  const B = bellConfig(cfg)
  const file = alertsFile(root, cfg)
  let size = 0
  try { size = statSync(file).size } catch {}
  // first run, or the office moved its log: start at the end, never replay
  const st = state && state.file === file ? state : { offset: size, file, files: state?.files ?? {}, rung: state?.rung ?? {}, sent: state?.sent ?? [], held: 0 }
  st.files ??= {}
  const due = []
  // alerts: <ISO> <TYPE> <case> <subject> <text>
  const a = newAlertLines(file, st.offset)
  st.offset = a.offset
  for (const l of a.lines) {
    const m = /^\S+ (\S+) (\S+) (\S+) (.*)$/.exec(l)
    if (!m || !B.types.includes(m[1].toUpperCase())) continue
    due.push(`alert ${m[1]}${m[2] !== '-' ? ' ' + m[2] : ''} ${m[3]}: ${m[4]}`.slice(0, 300))
  }
  const open = new Set()
  // the office's log files: new matching lines; a file seen for the first time starts at its end
  for (const f of B.files) {
    const no = f.error ? `office.json lead.bell.${f.name} is not used: ${f.error}` : fileRefusal(root, f.path)
    if (no) {
      const k = `fail:file:${f.name}`
      open.add(k)
      if (!st.rung[k]) { st.rung[k] = now; due.push(`bell: ${no}; that file is not watched`) }
      continue
    }
    const abs = realpathOr(join(root, f.path))
    let sz = 0
    try { sz = statSync(abs).size } catch {}
    if (!(abs in st.files)) { st.files[abs] = sz; continue }
    const r = newAlertLines(abs, st.files[abs])
    st.files[abs] = r.offset
    for (const l of r.lines) if (f.match.test(l.slice(0, MAX_LINE))) due.push(`${f.name}: ${l}`.slice(0, 300))
  }
  // asks: what is open now, keyed; new or due again rings
  for (const ask of B.asks) {
    const r = run('/bin/sh', ['-c', ask.command], { cwd: root, encoding: 'utf8', timeout: ask.timeoutSec * 1000 })
    const fkey = `fail:${ask.name}`
    if (r.error || r.status !== 0) {
      open.add(fkey)
      if (!st.rung[fkey] || now - st.rung[fkey] >= B.repeatMinutes * MIN) { st.rung[fkey] = now; due.push(`bell: the ${ask.name} ask is failing (${r.error?.code === 'ETIMEDOUT' ? 'timed out' : r.error ? r.error.message : 'exit ' + r.status}); its items are not being watched`) }
      // what it last reported stays open: a failing ask is not "all clear"
      for (const k of Object.keys(st.rung)) if (k.startsWith(`ask:${ask.name}:`)) open.add(k)
      continue
    }
    for (const line of String(r.stdout ?? '').split('\n').map((x) => x.trim()).filter(Boolean)) {
      const tab = line.indexOf('\t')
      const key = `ask:${ask.name}:${tab > 0 ? line.slice(0, tab) : line}`
      open.add(key)
      if (!st.rung[key] || now - st.rung[key] >= B.repeatMinutes * MIN) { st.rung[key] = now; due.push(`${ask.name}: ${(tab > 0 ? line.slice(tab + 1) : line)}`.slice(0, 300)) }
    }
  }
  // closed items are forgotten: if they come back they ring again
  for (const k of Object.keys(st.rung)) if (!open.has(k)) delete st.rung[k]
  // rate limit: what rang in the last minute counts against maxPerMinute
  st.sent = st.sent.filter((t) => now - t < MIN)
  // over the limit: the last free line says how many more there are (they stay
  // marked as rung, so they come back at repeatMinutes); with no free line at
  // all, the count waits for the next poll that has one
  const room = Math.max(0, B.maxPerMinute - st.sent.length)
  const held = st.held ?? 0
  const more = (n) => `+${n} more (rate limit ${B.maxPerMinute}/min): run the office's asks to see them all`
  const pending = due.length + held
  let lines
  if (!held && due.length <= room) { lines = due; st.held = 0 }
  else if (held && due.length + 1 <= room) { lines = [...due, more(held)]; st.held = 0 }
  else if (room === 0) { lines = []; st.held = pending }
  else { lines = due.slice(0, room - 1); lines.push(more(pending - lines.length)); st.held = 0 }
  for (const _ of lines) st.sent.push(now)
  return { lines, state: st }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2)
  const at = args.find((a) => !a.startsWith('--'))
  const root = findOffice(at ?? process.cwd())
  if (!root) { console.error('usage: node lib/lead-bell.mjs [root] [--once]  (run inside an office)'); process.exit(1) }
  const once = args.includes('--once')
  // the lead this bell rings for: its session's name, when the office has departments
  const lead = departmentsOf(readOfficeConfig(root)).on ? sessionName() : ''
  for (;;) {
    const cfg = readOfficeConfig(root)
    try {
      const { lines, state } = poll(root, cfg, { state: loadState(root, lead) })
      saveState(root, state, lead)
      for (const l of lines) console.log(l)
    } catch (e) { console.log(`bell: poll failed (${e.message})`) }
    if (once) break
    await sleep(bellConfig(cfg).every * 1000)
  }
}
