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
//   a file or ask may say "department": "<id>"; a file in a desk's folder is
//   that desk's department without saying so. Only that department's lead hears it.
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
// ⛔ AN UNCHANGED ITEM RE-RINGS ON A LADDER, NOT FOREVER (0.29.0). One invoice
// proposal 12 days old rang 11 times a day at repeatMinutes 120. "repeat":
// [120, 360, 1440] (on the bell, or per ask) rings it again 2 h after it first
// rang, then 6 h after that, then once a day while it stays open; the last step
// repeats. "quiet": {"tz", "from", "to"} holds a RE-ring for the morning; a
// first ring is never held. No "repeat" = repeatMinutes, as before.
// ⛔ A SHADOW KEEPS ITS OWN STATE (OFFICE_BELL_SHADOW=1, lib/bell-wait.mjs):
// a second bell sharing the state file would consume the lines the live one
// must ring.
// ⛔ READS ONLY. Asks run at the office root with a timeout; nothing is sent,
// typed or changed, except this bell's own state file.
import { readFileSync, writeFileSync, mkdirSync, statSync, openSync, readSync, closeSync, renameSync, existsSync, realpathSync } from 'node:fs'
const realpathOr = (p) => { try { return realpathSync(p) } catch { return p } }
import { join, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { findOffice, readOfficeConfig, sessionName } from './office.mjs'
import { departmentsOf, leadByName, departmentOfSubject, leadBellOn, allLeads } from './departments.mjs'
import { officeRoster } from './desk.mjs'
import { alertsFile } from './alerts.mjs'
import { isMain } from './is-main.mjs'
import { deskRoots, deskAt } from './desk.mjs'

export const DEFAULT_TYPES = ['HELD-LEAD', 'HELD-RELEASED', 'UNREAD-STUCK', 'USAGE-LIMIT', 'DESK-DEAD', 'DESK-OFF', 'DESK-STUCK', 'LEAD-UNREACHABLE', 'LEAD-DUPLICATE', 'VERSION', 'ASK-DUE', 'ASK-LATE', 'ASK-OWNER', 'BLOCKED']
// ⛔ FOLLOW-THROUGH IS NEVER SILENCED BY A TYPES LIST (#97): an office that set lead.bell.types
// before these existed would otherwise never hear a late ask. They ring whatever the list says.
export const ALWAYS_TYPES = ['ASK-DUE', 'ASK-LATE', 'ASK-OWNER', 'BLOCKED']
const MIN = 60_000

// ⛔ A PATTERN THAT CAN BACKTRACK FOREVER HANGS THE BELL, and with it every
// wake-up (alibaba-98's review, 2026-10-20: (a+)+$ hung node on 31 chars). A
// quantified group that itself holds a quantifier is refused at load, and a
// line is tested on its first MAX_LINE characters only.
export const MAX_LINE = 2000
// ⛔ AN AGE IS NOT A CHANGE (0.32.2, 2026-11-20: "held: BT-261113-674 ahmed shaa 1307m gate:4" and "… 1313m …" woke AICS twice in
// 6 min). A keyless ask line, and the wait form's seen key, drop ages and counters ("1307m", "2h", "33 h", "x3", "(+4)") so the
// same thread + reason is the same item.
export const ageless = (l) => String(l).replace(/\b\d+(?:\.\d+)?\s?(?:s|m|min|h|d|mins|minutes|hours|days)\b/g, '#').replace(/\bx\d+\b|\(\+\d+\)|\b\d+ (?:times|more|polls)\b/g, '#')
export const CLASSES = ['now', 'batch', 'quiet']
// ⛔ A NUDGE TO A DESK IS NOT THE LEAD'S (0.31.2, T-261120-97: an ASK-DUE nudging desk-alibaba-customer-service woke the
// AICS lead at 48 and 64 min). An ASK-DUE / ASK-LATE whose text is "NUDGE <someone else>" is quiet for the lead; it rings
// at once only when the NUDGE names the lead itself. leadNames: this bell's lead's names ([] = the office's one lead).
export function classOf(B, line, leadNames = []) {
  const t = /^alert (\S+)/.exec(line)?.[1]?.toUpperCase()
  if ((t === 'ASK-DUE' || t === 'ASK-LATE')) { const to = /^alert \S+(?: \S+)? \S+: NUDGE (\S+)/.exec(line)?.[1]; if (to && !leadNames.includes(to)) return 'quiet' }
  if (t && ALWAYS_TYPES.includes(t)) return 'now'
  return B.classes.find((c) => c.re.test(line))?.class ?? B.defaultClass
}
export const nestedQuantifier = (src) => /\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*(?:[+*]|\{\d)/.test(src) || /\((?:[^()\\]|\\.)*\|(?:[^()\\]|\\.)*\)[+*]/.test(src)
function fileEntry(f, i) {
  const bad = (why) => ({ name: `files[${i}]`, error: why })
  if (!f || typeof f.name !== 'string' || !f.name || typeof f.path !== 'string' || !f.path) return bad('needs a name and a path')
  const src = typeof f.match === 'string' && f.match ? f.match : '.'
  if (src.length > 500) return bad('its match is longer than 500 characters')
  if (nestedQuantifier(src)) return bad('its match repeats a group that itself repeats (like (a+)+), which can hang on one line')
  const department = typeof f.department === 'string' && f.department ? f.department : null
  try { return { name: f.name, path: f.path, match: new RegExp(src), department } } catch (e) { return bad(`its match does not compile (${e.message})`) }
}
// ⛔ ONLY A DESK'S *.log, REALLY. A symlink called x.log in a runtime/ can
// point anywhere; the REAL path must be a .log under the office's desks/,
// with no hidden name on the way. -> null or why not
export function fileRefusal(root, rel) {
  const abs = resolve(root, rel)
  let real
  try { real = realpathSync(abs) } catch { return null }   // not there yet: checked again once it is
  // a desk's log: under desks/ or a department's folder (lib/desk.mjs deskRoots)
  const desks = deskRoots(root).map((r) => { try { return realpathSync(r.dir) } catch { return r.dir } }).find((d) => (real + sep).startsWith(d + sep))
  if (!desks) return `${rel} is not under the office's desks/ (it resolves to ${real})`
  if (!/\.log$/i.test(real)) return `${rel} is not a .log file`
  if (real.slice(desks.length).split(sep).some((x) => x.startsWith('.'))) return `${rel} goes through a hidden name`
  // ⛔ its own desk's, really (0.18.7): the department a file is heard by is
  // its desk's, so a link into another desk would hand that desk's lines to
  // the wrong lead. A moved desk's old link lands in the same desk: allowed.
  const said = deskAt(root, abs)?.id ?? null, is = deskOfReal(root, real)
  if (said !== is) return `${rel} is a link into ${is ? `the desk ${is}` : 'no desk'}, not ${said ? `the desk ${said}` : 'a desk-less log'}`
  return null
}
// the desk whose folder REALLY holds a path (the office root may itself sit behind a link)
export const deskOfReal = (root, real) => deskAt(realpathOr(root), real)?.id ?? null

// which switch turned this lead's bell off (null = on); lead '' = the office's one lead
export function bellOffFor(cfg, lead = '') {
  const L = lead ? allLeads(cfg).find((l) => l.names.includes(lead)) : null
  const dep = L?.department ?? null
  if (leadBellOn(cfg, dep)) return null
  return dep && typeof cfg?.departments?.[dep]?.bell?.enabled === 'boolean' ? `departments.${dep}.bell.enabled is false` : 'lead.bell.enabled is false'
}

export function bellConfig(cfg) {
  const B = cfg?.lead?.bell && typeof cfg.lead.bell === 'object' ? cfg.lead.bell : {}
  const num = (v, d, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)
  return {
    every: num(B.every, 15, 5, 300),
    types: Array.isArray(B.types) ? [...new Set([...B.types.filter((t) => typeof t === 'string' && t).map((t) => t.toUpperCase()), ...ALWAYS_TYPES])] : DEFAULT_TYPES,
    repeatMinutes: num(B.repeatMinutes, 30, 1, 24 * 60),
    repeat: ladderOf(B.repeat),
    quiet: quietOf(B.quiet),
    maxPerMinute: num(B.maxPerMinute, 6, 1, 120),
    files: (Array.isArray(B.files) ? B.files : []).map((f, i) => fileEntry(f, i)),
    // ⛔ WAKE ONLY FOR WHAT NEEDS THE LEAD (0.31.0). "classes": [{ "match": "<regex>", "class": "now"|"batch"|"quiet" }],
    // first match wins on the line as printed ("<source>: <text>"); no match = "defaultClass" (now). now rings at
    // once and takes any batch with it; batch waits up to batchSec for company; quiet never rings on its own and
    // rides the next real ring as ONE count line. An ALWAYS_TYPES alert is never quiet.
    classes: (Array.isArray(B.classes) ? B.classes : []).flatMap((c) => { try { return CLASSES.includes(c?.class) && typeof c.match === 'string' ? [{ re: new RegExp(c.match), class: c.class }] : [] } catch { return [] } }),
    defaultClass: CLASSES.includes(B.defaultClass) ? B.defaultClass : 'now',
    batchSec: num(B.batchSec, 150, 0, 900),
    // one short line per item: the lead reads the rest from its source
    lineMax: num(B.lineMax, 300, 80, 300),
    // an ask fails this many polls in a row (each already retried once) before the lead hears it
    failAfter: num(B.failAfter, 3, 1, 20),
    alertRepeat: ladderOf(B.alertRepeat) ?? [120, 360, 1440],
    asks: (Array.isArray(B.asks) ? B.asks : []).filter((a) => a && typeof a.name === 'string' && typeof a.command === 'string' && a.command).map((a) => ({ name: a.name, command: a.command, timeoutSec: num(a.timeoutSec, 30, 1, 120), department: typeof a.department === 'string' && a.department ? a.department : null, repeat: ladderOf(a.repeat) })),
  }
}

// ⛔ ONE STATE PER LEAD (departments, 0.12.0). ERP and AICS on one machine both
// run this bell; one shared state would let the first to poll consume the
// line the other never hears. With departments, the file is keyed by the lead.
const shadowTag = () => (process.env.OFFICE_BELL_SHADOW === '1' ? '.shadow' : '')
export const stateFile = (root, lead = '') => join(root, '.office', (lead ? `lead-bell-state-${String(lead).replace(/[^A-Za-z0-9_-]/g, (c) => '_' + c.codePointAt(0).toString(16))}` : 'lead-bell-state') + shadowTag() + '.json')

// [minutes, …] ascending positive steps, or null
export function ladderOf(v) {
  if (!Array.isArray(v)) return null
  const l = v.filter((x) => Number.isFinite(x) && x >= 1).map((x) => Math.min(x, 7 * 24 * 60))
  return l.length ? l : null
}
export function quietOf(q) {
  if (!q || typeof q !== 'object' || typeof q.tz !== 'string') return null
  const h = (x) => (Number.isInteger(x) && x >= 0 && x <= 23 ? x : null)
  if (h(q.from) == null || h(q.to) == null || q.from === q.to) return null
  try { new Intl.DateTimeFormat('en-US', { timeZone: q.tz }) } catch { return null }
  return { tz: q.tz, from: q.from, to: q.to }
}
export function quietAt(q, now) {
  if (!q) return false
  const hr = Number(new Intl.DateTimeFormat('en-US', { timeZone: q.tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date(now)))
  return q.from > q.to ? hr >= q.from || hr < q.to : hr >= q.from && hr < q.to
}
// rung[key] is the last ring time (a number, as before 0.29.0) and rings[key] how many times it rang: n rings so far -> the step that waits now
export function dueAgain({ last, n = 1, now, ladder, repeatMinutes }) {
  const step = ladder ? ladder[Math.min(Math.max(1, n), ladder.length) - 1] : repeatMinutes
  return now - last >= step * MIN
}
export function loadState(root, lead = '') {
  try { const s = JSON.parse(readFileSync(stateFile(root, lead), 'utf8')); return { offset: Number(s.offset) || 0, file: s.file ?? null, files: s.files ?? {}, rung: s.rung ?? {}, rings: s.rings ?? {}, sent: Array.isArray(s.sent) ? s.sent : [], held: s.held ?? 0 } }
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
// lead (0.18.0): the session this bell rings for. With departments, it hears
// its own department's alerts and the office's, never another department's.
export function poll(root, cfg, { now = Date.now(), run = spawnSync, state = loadState(root), lead = '' } = {}) {
  const mine = lead ? leadByName(cfg, lead) : null
  const desks = mine?.department ? officeRoster(root).desks : null
  const hears = (subject) => { if (!mine?.department) return true; const d = departmentOfSubject(cfg, subject, desks); return d == null || d === mine.department }
  const B = bellConfig(cfg)
  // ⛔ A FILE OR AN ASK IS A DEPARTMENT'S TOO (0.18.7). ERP's bell rang the
  // buyers log (a customer-service desk's lead-alerts.log) and held buyer
  // drafts, and it pushed the owner on them. A file is the department of the
  // desk whose folder holds it, or the one it names; an ask, the one it names.
  // An undeclared department is no department: the office's, heard by all.
  const ownerOf = (x) => {
    if (x.department) return departmentsOf(cfg).list.some((d) => d.id === x.department) ? x.department : null
    // by where the file REALLY is, every poll: what is read is what is judged
    const id = x.path ? deskOfReal(root, realpathOr(resolve(root, x.path))) : null
    return id ? departmentOfSubject(cfg, id, desks) : null
  }
  const owns = (x) => { if (!mine?.department) return true; const d = ownerOf(x); return d == null || d === mine.department }
  const file = alertsFile(root, cfg)
  let size = 0
  try { size = statSync(file).size } catch {}
  // first run, or the office moved its log: start at the end, never replay
  const st = state && state.file === file ? state : { offset: size, file, files: state?.files ?? {}, rung: state?.rung ?? {}, rings: state?.rings ?? {}, sent: state?.sent ?? [], held: 0 }
  st.files ??= {}
  st.rings ??= {}
  const night = quietAt(B.quiet, now)
  const due = []
  // alerts: <ISO> <TYPE> <case> <subject> <text>
  const a = newAlertLines(file, st.offset)
  st.offset = a.offset
  for (const l of a.lines) {
    const m = /^\S+ (\S+) (\S+) (\S+) (.*)$/.exec(l)
    if (!m || !B.types.includes(m[1].toUpperCase())) continue
    if (!hears(m[3])) continue
    // ⛔ THE SAME TASK LINE NEVER RE-RINGS WITHOUT A CHANGE (0.31.2): an alert of one type, case and subject re-rings on the
    // ladder (lead.bell.alertRepeat, default 2 h / 6 h / daily) however often its writer repeats it; forgotten after 2 days quiet
    if (m[2] !== '-') {
      st.alerts ??= {}
      const k = `${m[1]} ${m[2]} ${m[3]}`, o = st.alerts[k]
      if (o && !dueAgain({ last: o.last, n: o.n, now, ladder: B.alertRepeat, repeatMinutes: B.repeatMinutes })) { o.seen = now; continue }
      st.alerts[k] = { last: now, n: (o?.n ?? 0) + 1, seen: now }
    }
    due.push(`alert ${m[1]}${m[2] !== '-' ? ' ' + m[2] : ''} ${m[3]}: ${m[4]}`.slice(0, 300))
  }
  for (const [k, o] of Object.entries(st.alerts ?? {})) if (now - o.seen > 2 * 1440 * MIN) delete st.alerts[k]
  const open = new Set()
  // the office's log files: new matching lines; a file seen for the first time starts at its end
  for (const f of B.files) {
    if (!f.error && !owns(f)) continue
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
    if (!owns(ask)) continue
    const go = () => run('/bin/sh', ['-c', ask.command], { cwd: root, encoding: 'utf8', timeout: ask.timeoutSec * 1000 })
    const bad = (x) => x.error || x.status !== 0
    // ⛔ A BLIP IS NOT A WAKE (0.31.1, owner 2026-11-20: three transient book timeouts in one night, each a lead wake, each fine when re-run).
    // A failure is retried once at once; only failAfter polls failing in a row ring, as one line with when it started.
    let r = go()
    if (bad(r)) r = go()
    const fkey = `fail:${ask.name}`
    st.fails ??= {}
    if (bad(r)) {
      const f = st.fails[ask.name] ?? { n: 0, since: now }
      f.n++; st.fails[ask.name] = f
      open.add(fkey)
      if (f.n >= B.failAfter && (!st.rung[fkey] || now - st.rung[fkey] >= B.repeatMinutes * MIN)) { st.rung[fkey] = now; due.push(`bell: can't reach the ${ask.name} ask since ${new Date(f.since).toISOString().slice(11, 16)}Z (${r.error?.code === 'ETIMEDOUT' ? 'timed out' : r.error ? r.error.message : 'exit ' + r.status}, ${f.n} polls); its items are not being watched`) }
      // what it last reported stays open: a failing ask is not "all clear"
      for (const k of Object.keys(st.rung)) if (k.startsWith(`ask:${ask.name}:`)) open.add(k)
      continue
    }
    delete st.fails[ask.name]
    for (const line of String(r.stdout ?? '').split('\n').map((x) => x.trim()).filter(Boolean)) {
      const tab = line.indexOf('\t')
      const key = `ask:${ask.name}:${tab > 0 ? line.slice(0, tab) : ageless(line)}`
      open.add(key)
      const first = !st.rung[key]
      // a re-ring waits on the ladder (or repeatMinutes), and for the morning in quiet hours; a first ring never waits
      if (first || (!night && dueAgain({ last: st.rung[key], n: st.rings[key] ?? 1, now, ladder: ask.repeat ?? B.repeat, repeatMinutes: B.repeatMinutes }))) {
        st.rung[key] = now
        st.rings[key] = first ? 1 : (st.rings[key] ?? 1) + 1
        due.push(`${ask.name}: ${(tab > 0 ? line.slice(tab + 1) : line)}`.slice(0, 300))
      }
    }
  }
  // closed items are forgotten: if they come back they ring again
  for (const k of Object.keys(st.rung)) if (!open.has(k)) { delete st.rung[k]; delete st.rings[k] }
  for (const k of Object.keys(st.rings)) if (!(k in st.rung)) delete st.rings[k]
  // classes: hold batch and quiet lines; a now line (or a batch older than batchSec) lets them out
  st.batch ??= []; st.quietN ??= 0; st.quietIds ??= []
  const nowLines = []
  for (const l of due) {
    const c = classOf(B, l, mine?.names ?? (typeof cfg?.lead?.session === 'string' ? [cfg.lead.session, ...(Array.isArray(cfg.lead.aliases) ? cfg.lead.aliases : [])] : []))
    if (c === 'now') nowLines.push(l)
    else if (c === 'batch') st.batch.push({ at: now, line: l })
    else { st.quietN++; const id = /\b(LM|BT|SO|MO|T)-[\w-]+/.exec(l)?.[0]; if (id && !st.quietIds.includes(id)) st.quietIds.push(id) }
  }
  due.length = 0
  if (nowLines.length || (st.batch.length && now - st.batch[0].at >= B.batchSec * 1000)) {
    due.push(...nowLines, ...st.batch.map((b) => b.line))
    st.batch = []
    if (st.quietN) { due.push(`quiet: ${st.quietN} more item(s) waiting in your inbox, nothing urgent${st.quietIds.length ? ': ' + st.quietIds.slice(0, 12).join(' ') : ''}`); st.quietN = 0; st.quietIds = [] }
  }
  for (let i = 0; i < due.length; i++) if (due[i].length > B.lineMax) due[i] = due[i].slice(0, B.lineMax - 1) + '…'
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
  const offFor = bellOffFor(readOfficeConfig(root), lead)
  if (offFor) { console.error(`lead-bell: off: ${offFor} in office.json, so this lead runs no doorbell. It is woken by SendMessage and the lead-inbox/wake-sweep nudges. Set it true to arm the bell again.`); process.exit(2) }
  for (;;) {
    const cfg = readOfficeConfig(root)
    try {
      const { lines, state } = poll(root, cfg, { state: loadState(root, lead), lead })
      saveState(root, state, lead)
      for (const l of lines) console.log(l)
    } catch (e) { console.log(`bell: poll failed (${e.message})`) }
    if (once) break
    await sleep(bellConfig(cfg).every * 1000)
  }
}
