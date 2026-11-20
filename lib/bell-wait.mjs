// A DOORBELL THAT COSTS NOTHING WHILE NOTHING HAPPENS (0.29.0, owner 2026-11-18:
// "can we have the system off when there's no trigger, to save the most out of
// it; sometimes someone still messages at midnight, so it only triggers when
// there is a new trigger").
//
// A desk's doorbell runs under the Monitor tool, and the Monitor tool kills
// every monitor after at most 30 minutes. Each expiry, and each re-arm, is a
// model turn that re-reads the whole session: about 48 turns a day per desk,
// measured at ~130M tokens a day for an office of five, with nothing to do.
//
// The harness has a one-shot wait with no such cap: Bash with
// run_in_background re-invokes the session once, when the command exits, and
// its deadline is the Bash timeout (raised by the documented
// BASH_MAX_TIMEOUT_MS, which `start` sets for a wait-mode office). So:
//
//   node {plugin}/lib/bell-wait.mjs wait   -- <wake command> [--also <command>]...
//       Runs the doorbell(s) and the session's nudge file. At the first line
//       it waits `settle` ms more, stops the doorbells, drains what they still
//       print, prints it all and exits 0: ONE wake. Idle costs no tokens.
//       The session acts, then arms it again before it ends its turn.
//   node {plugin}/lib/bell-wait.mjs tee    -- <wake command> [--also …]
//       The Monitor form, unchanged in behaviour: every line passes straight
//       through. It also logs each line, so the shadow can be compared with it.
//   node {plugin}/lib/bell-wait.mjs shadow --session <name> --pid <pid> --cwd <dir> -- <wake command> [--also …]
//       Started by the watchdog (shadowPass), never by a session, and it prints
//       nothing a session reads. It runs the wait cycle beside the live Monitor,
//       with the doorbells' state kept apart (OFFICE_BELL_SHADOW=1), and logs
//       when the wait form WOULD have woken the session and with what.
//   node {plugin}/lib/bell-wait.mjs nudge <session> --from <process> <source> <id>
//       The office's own processes (a sweep, a launcher; never a Claude
//       session) wake an idle wait-mode session: a pointer lands in the
//       session's nudge file, which its waiter follows. It is the session's own
//       child that wakes it, so nothing is typed into it and no peer message is
//       held by a permission mode.
//   ⛔ A NUDGE IS A POINTER, NEVER AN INSTRUCTION (security review, 2026-11-18).
//       The file holds JSON {from, source, id} with no free text, each checked
//       against a narrow pattern; the waiter prints `NUDGE from=<from> check
//       <source> <id>` and the boot text tells the session to read that item
//       from its own source before acting. A line that is not such a pointer
//       is dropped, never printed. The CLI refuses to run inside a Claude
//       session, and the wall (lib/approvals.mjs) refuses any tool call that
//       writes a nudge file or runs `bell-wait.mjs nudge`.
//   node {plugin}/lib/bell-wait.mjs compare [--hours 24] [--session <name>]
//       Every line the live Monitor printed (tee) against what the shadow would
//       have woken for: matched, missed (must be 0 before switching), extra,
//       and the wake counts of both.
//
// ⛔ NOTHING IS SWALLOWED. The waiter never drops a line as a repeat: what the
// doorbell prints is what the session reads. Which lines wake is still the
// doorbell's own rule (an office's wake policy), exactly as under Monitor.
// ⛔ THE WAIT NEVER LOSES THE LINE IT STOPS ON. The doorbells are stopped
// with SIGTERM and read until they close; anything they print while stopping
// is printed too. A nudge is consumed only after it was printed.
// ⛔ IT FAILS OPEN. A doorbell that exits on its own is restarted; three exits
// in ten minutes print `BELL-FALLBACK …` and exit 3, and the boot text tells
// the session to arm the Monitor form instead. A waiter that is killed exits
// non-zero, which wakes the session the same way.
//
// office.json "boot": { "wakeMode": "monitor" | "tee" | "wait", "settleMs": 1500,
//   "wakeLog": "<path under the office>"  (wait mode: one row per wake in the
//   office's own wake-log JSONL: at, session, source "bell-wait", outcome "woke") }
// Log: .office/bell-wait/log.jsonl (gitignored with .office).
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, statSync, renameSync, existsSync, openSync, readSync, closeSync, readdirSync } from 'node:fs'
import { join, resolve, dirname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn as spawnChild, execFileSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { homedir } from 'node:os'
import { findOffice, readOfficeConfig, sessionName } from './office.mjs'
import { isMain } from './is-main.mjs'

export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const MODES = ['monitor', 'tee', 'wait']
export const SETTLE_MS = 1500
// ⛔ ONE LINE, ONE WAKE, ACROSS RE-ARMS AND RESTARTS (0.32.1, 2026-11-20: "HUMAN BT-261120-715 … 10:16:27Z" woke AICS twice,
// once from its wakeAlso alert follower and again 19 s later from lead-bell's "buyers:" copy of the same log line, after the
// re-arm). A wait keeps what it delivered in .office/bell-wait/<session>.seen.json, keyed by the line's text without its
// source prefix and leading timestamp: the same text again rings only on the ladder (2 h, 6 h, then daily). NUDGE lines are
// pointers, never held.
export const SEEN_LADDER_MIN = [120, 360, 1440]
const SEEN_MAX = 2000
export const seenFile = (root, session) => join(bellDir(root), `${slug(session)}.seen.json`)
export const seenKey = (l) => String(l).trim().replace(/^[\w.-]+: (?=\d{4}-\d\d-\d\dT)/, '').replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z /, '')
export function loadSeen(root, session) { try { const j = JSON.parse(readFileSync(seenFile(root, session), 'utf8')); return j && typeof j === 'object' ? j : {} } catch { return {} } }
export function saveSeen(root, session, seen) {
  const keep = Object.entries(seen).sort((a, b) => b[1].last - a[1].last).slice(0, SEEN_MAX)
  try { ensureDir(root); const f = seenFile(root, session); writeFileSync(f + '.tmp', JSON.stringify(Object.fromEntries(keep))); renameSync(f + '.tmp', f) } catch {}
}
// true = deliver (and recorded); false = the same text inside its ladder step
export function admitSeen(seen, line, now, ladder = SEEN_LADDER_MIN) {
  if (/^NUDGE /.test(String(line))) return true
  const k = seenKey(line), o = seen[k]
  if (o && now - o.last < ladder[Math.min(o.n, ladder.length) - 1] * 60_000) return false
  seen[k] = { last: now, n: (o?.n ?? 0) + 1 }
  return true
}
export const DRAIN_MS = 3000
export const CRASH_LIMIT = 3
export const CRASH_WINDOW_MS = 10 * 60_000
export const NUDGE_POLL_MS = 500
/** what a session's background Bash timeout should be in wait mode: a day (BASH_MAX_TIMEOUT_MS lets it) */
export const WAIT_TIMEOUT_MS = 86_400_000
const LOG_MAX = 8 << 20

// a lead may run its own mode (0.31.0, office.json lead.bell.wakeMode): the owner moved the lead to
// the one-shot wait while the desks stayed on tee; without it the lead follows boot.wakeMode
export const wakeModeOf = (cfg, { lead = false } = {}) => (lead && MODES.includes(cfg?.lead?.bell?.wakeMode) ? cfg.lead.bell.wakeMode : MODES.includes(cfg?.boot?.wakeMode) ? cfg.boot.wakeMode : 'monitor')
export const bellDir = (root) => join(root, '.office', 'bell-wait')
export const slug = (s) => String(s || 'session').replace(/[^A-Za-z0-9_.-]/g, (c) => '_' + c.codePointAt(0).toString(16))
export const nudgeFile = (root, session) => join(bellDir(root), `${slug(session)}.nudge`)
export const logFile = (root) => join(bellDir(root), 'log.jsonl')
const ensureDir = (root) => {
  mkdirSync(bellDir(root), { recursive: true })
  const gi = join(root, '.office', '.gitignore')
  if (!existsSync(gi)) { try { writeFileSync(gi, '# office-anything state and logs; never committed\n*\n') } catch {} }
}

// the command a session runs for its doorbell in a mode. Pure. 'monitor' = the wake itself
export function wrapWake(wake, mode, { pluginRoot = PLUGIN_ROOT, also = [] } = {}) {
  const x = (c) => String(c ?? '').trim().split('{plugin}').join(pluginRoot)
  const w = x(wake)
  if (!w || mode === 'monitor' || !MODES.includes(mode)) return w
  return [`node ${pluginRoot}/lib/bell-wait.mjs ${mode} -- ${w}`, ...also.filter((a) => typeof a === 'string' && a.trim()).map((a) => `--also ${x(a)}`)].join(' ')
}

// argv after the mode -> { opts, cmds }. Words after "--" are the first command; each "--also" starts another
export function parseArgs(argv) {
  const opts = {}, cmds = []
  let i = 0
  for (; i < argv.length && argv[i] !== '--'; i++) {
    const a = argv[i]
    if (a.startsWith('--') && i + 1 < argv.length && !argv[i + 1].startsWith('--')) { opts[a.slice(2)] = argv[++i] } else if (a.startsWith('--')) opts[a.slice(2)] = true
    else (opts._ ??= []).push(a)
  }
  let cur = []
  for (i++; i < argv.length; i++) {
    if (argv[i] === '--also') { if (cur.length) cmds.push(cur.join(' ')); cur = [] } else cur.push(argv[i])
  }
  if (cur.length) cmds.push(cur.join(' '))
  return { opts, cmds }
}

export function logRow(root, row) {
  try {
    ensureDir(root)
    const f = logFile(root)
    try { if (statSync(f).size > LOG_MAX) renameSync(f, f + '.1') } catch {}
    appendFileSync(f, JSON.stringify({ at: new Date().toISOString(), ...row }) + '\n')
  } catch { /* a log that cannot be written must not stop a doorbell */ }
}
export function readLog(root, { sinceMs = 0 } = {}) {
  const rows = []
  for (const f of [logFile(root) + '.1', logFile(root)]) {
    let t = ''
    try { t = readFileSync(f, 'utf8') } catch { continue }
    for (const l of t.split('\n')) { if (!l) continue; try { const r = JSON.parse(l); if (Date.parse(r.at) >= sinceMs) rows.push(r) } catch {} }
  }
  return rows
}

// the office's own wake log (boot.wakeLog): one row per wait-mode wake, in the five-outcome shape
function officeWakeLog(root, cfg, session, lines) {
  const p = typeof cfg?.boot?.wakeLog === 'string' && cfg.boot.wakeLog ? cfg.boot.wakeLog : null
  if (!p || !lines.length) return
  const f = isAbsolute(p) ? p : join(root, p)
  if (!resolve(f).startsWith(resolve(root) + '/')) return
  const first = String(lines[0])
  try { mkdirSync(dirname(f), { recursive: true }); appendFileSync(f, JSON.stringify({ at: new Date().toISOString(), session: session || null, desk: null, source: 'bell-wait', outcome: 'woke', acted: null, kind: first.split(/[\s:]/)[0].slice(0, 40) || null, key: first.slice(0, 160) }) + '\n') } catch {}
}

// ── the nudge file ───────────────────────────────────────────────────────────
// Append-only JSON pointers; the waiter remembers how far it has PRINTED (<file>.offset)
const NUDGE_FROM = /^[a-z][a-z0-9-]{0,39}$/
const NUDGE_SOURCE = /^[a-z][a-z0-9_-]{0,31}$/
const NUDGE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/
/** a pointer -> its line, or null when it is not a well-formed pointer (free text, a field out of pattern) */
export function nudgeLine(x) {
  if (!x || typeof x !== 'object' || !NUDGE_FROM.test(String(x.from ?? '')) || !NUDGE_SOURCE.test(String(x.source ?? '')) || !NUDGE_ID.test(String(x.id ?? ''))) return null
  return `NUDGE from=${x.from} check ${x.source} ${x.id}`
}
export function nudge(root, session, { from, source, id } = {}) {
  const p = { from, source, id }
  if (!session || !nudgeLine(p)) return false
  ensureDir(root)
  appendFileSync(nudgeFile(root, session), JSON.stringify({ at: new Date().toISOString(), ...p }) + '\n')
  logRow(root, { session, mode: 'nudge', event: 'nudge', lines: [nudgeLine(p)] })
  return true
}
const parsePointer = (l) => { try { return nudgeLine(JSON.parse(l)) } catch { return null } }
export function readNudges(root, session) {
  const f = nudgeFile(root, session)
  let off = 0
  try { off = Number(readFileSync(f + '.offset', 'utf8')) || 0 } catch {}
  let size = 0
  try { size = statSync(f).size } catch { return { lines: [], end: 0 } }
  if (size < off) off = 0
  if (size === off) return { lines: [], end: off }
  const fd = openSync(f, 'r')
  try {
    const b = Buffer.alloc(size - off)
    readSync(fd, b, 0, b.length, off)
    const t = b.toString('utf8'), cut = t.lastIndexOf('\n')
    if (cut < 0) return { lines: [], end: off }
    // only well-formed pointers are delivered; anything else in the file is dropped (and passed over)
    return { lines: t.slice(0, cut).split('\n').map(parsePointer).filter(Boolean), end: off + Buffer.byteLength(t.slice(0, cut + 1)) }
  } finally { closeSync(fd) }
}
export const commitNudges = (root, session, end) => { try { writeFileSync(nudgeFile(root, session) + '.offset', String(end)) } catch {} }

// ── running a doorbell ───────────────────────────────────────────────────────
// A plain `node script args` is exec'd, so the doorbell is our direct child:
// health finds it under the session, and a signal reaches it, not a shell.
const SIMPLE = /^[^;&|`$()<>\\\n]+$/
function startChild(cmd, { cwd, env, spawnFn = spawnChild }) {
  const simple = SIMPLE.test(cmd)
  const c = spawnFn('/bin/sh', ['-c', simple ? `exec ${cmd}` : cmd], { cwd, env, stdio: ['ignore', 'pipe', 'inherit'], detached: !simple })
  c.groupKill = !simple
  return c
}
function stopChild(c, sig = 'SIGTERM') {
  try { if (c.groupKill) process.kill(-c.pid, sig); else c.kill(sig) } catch {}
}

/**
 * One wait: resolves at the first wake with { code, lines, fallback }. print(text) gets every line, joined.
 * mode 'wait' (a session's) or 'shadow' (the watchdog's; the doorbells get OFFICE_BELL_SHADOW=1 and keep their own state).
 */
export function waitOnce({ cmds, cwd = process.cwd(), root, session = '', mode = 'wait', settleMs = SETTLE_MS, drainMs = DRAIN_MS, env = process.env,
  print = (t) => process.stdout.write(t + '\n'), spawnFn, nudgePollMs = NUDGE_POLL_MS, crashLimit = CRASH_LIMIT, crashWindowMs = CRASH_WINDOW_MS, now = Date.now, onStart = null, dedupe = false } = {}) {
  return new Promise((done) => {
    const t0 = now()
    const lines = []
    const kids = new Set()
    const crashes = []
    let settle = null, stopping = false, finished = false, nudgeEnd = null, iv = null
    const childEnv = { ...env, OFFICE_BELL_MODE: mode, ...(mode === 'shadow' ? { OFFICE_BELL_SHADOW: '1' } : {}) }
    const finish = (code, fallback = null) => {
      if (finished) return
      finished = true
      clearInterval(iv)
      if (settle) clearTimeout(settle)
      for (const c of kids) stopChild(c, 'SIGKILL')
      if (fallback) lines.push(fallback)
      if (lines.length) print(lines.join('\n'))
      if (nudgeEnd != null && root && session) commitNudges(root, session, nudgeEnd)
      done({ code, lines, fallback: !!fallback, waitedMs: now() - t0 })
    }
    const stop = () => {
      if (stopping) return
      stopping = true
      clearInterval(iv)
      if (!kids.size) return finish(0)
      for (const c of kids) stopChild(c)
      setTimeout(() => finish(0), drainMs).unref?.()
    }
    const seen = dedupe && root && session ? loadSeen(root, session) : null
    const onLine = (l) => {
      if (finished || !String(l).trim()) return
      if (seen) { if (!admitSeen(seen, l, now())) return; saveSeen(root, session, seen) }
      lines.push(String(l))
      if (!settle && !stopping) settle = setTimeout(stop, settleMs)
    }
    const run = (cmd) => {
      const c = startChild(cmd, { cwd, env: childEnv, spawnFn })
      kids.add(c)
      createInterface({ input: c.stdout }).on('line', onLine)
      c.on('error', () => {})
      c.on('close', (code) => {
        kids.delete(c)
        if (stopping) { if (!kids.size) finish(0); return }
        if (finished) return
        // a doorbell that ended on its own: what it printed is a wake; else restart it, and fail open after crashLimit
        if (lines.length) { if (!settle) settle = setTimeout(stop, settleMs); return }
        const t = now()
        crashes.push(t)
        while (crashes.length && t - crashes[0] > crashWindowMs) crashes.shift()
        if (crashes.length >= crashLimit) {
          for (const k of kids) stopChild(k)
          return finish(3, `BELL-FALLBACK ${cmd} exited ${code ?? 'by a signal'} ${crashes.length} times in ${Math.round(crashWindowMs / 60000)} min: arm your doorbell with Monitor as before (the wake command without bell-wait), and tell the lead`)
        }
        setTimeout(() => { if (!finished && !stopping) run(cmd) }, 1000 * crashes.length)
      })
    }
    for (const cmd of cmds) run(cmd)
    if (root && session) {
      const look = () => {
        if (stopping || finished) return
        const r = readNudges(root, session)
        if (r.lines.length) { nudgeEnd = r.end; for (const l of r.lines) onLine(l) }
      }
      look()
      iv = setInterval(look, nudgePollMs)
    }
    onStart?.({ stop: () => stop(), kids })
  })
}

// tee: the Monitor form. Every line straight through, and logged. Exits with the doorbell
export function runTee({ cmds, cwd = process.cwd(), root, session = '', env = process.env, out = (l) => process.stdout.write(l + '\n'), spawnFn } = {}) {
  return new Promise((done) => {
    const kids = new Set()
    if (root) logRow(root, { session, mode: 'tee', event: 'start', cmds })
    for (const cmd of cmds) {
      const c = startChild(cmd, { cwd, env: { ...env, OFFICE_BELL_MODE: 'tee' }, spawnFn })
      kids.add(c)
      createInterface({ input: c.stdout }).on('line', (l) => { out(l); if (root && String(l).trim()) logRow(root, { session, mode: 'tee', event: 'line', lines: [String(l).slice(0, 500)] }) })
      c.on('error', () => {})
      c.on('close', (code) => { kids.delete(c); if (!kids.size) done(code ?? 0) })
    }
    const off = () => { for (const c of kids) stopChild(c) }
    process.once('SIGTERM', off); process.once('SIGINT', off); process.once('SIGHUP', off)
  })
}

// ── the shadow ───────────────────────────────────────────────────────────────
const configDirOf = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
export function sessionStatus(pid, { configDir = configDirOf() } = {}) {
  try { process.kill(Number(pid), 0) } catch (e) { if (e.code !== 'EPERM') return null }
  try { return JSON.parse(readFileSync(join(configDir, 'sessions', `${pid}.json`), 'utf8')).status ?? 'unknown' } catch { return null }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * The wait cycle beside a live session, logging only. After a would-be wake the session would be busy with it; the shadow re-arms when the
 * session is idle again (at least minTurnMs later), which is when a real waiter would be armed again.
 */
export async function runShadow({ cmds, cwd, root, session, pid, status = (p) => sessionStatus(p), minTurnMs = 10_000, maxTurnMs = 60 * 60_000, pollMs = 2000, waitFn = waitOnce, sleepFn = sleep, now = Date.now } = {}) {
  logRow(root, { session, mode: 'shadow', event: 'start', cmds, pid })
  while (status(pid) != null) {
    const r = await waitFn({ cmds, cwd, root, session: null, mode: 'shadow', print: () => {} })
    logRow(root, { session, mode: 'shadow', event: r.fallback ? 'fallback' : 'woke', lines: r.lines.map((l) => String(l).slice(0, 500)), waitedMs: r.waitedMs })
    if (r.fallback) { await sleepFn(60_000); continue }
    const t = now()
    await sleepFn(minTurnMs)
    while (status(pid) === 'busy' && now() - t < maxTurnMs) await sleepFn(pollMs)
  }
  logRow(root, { session, mode: 'shadow', event: 'end', pid })
}

const shadowFile = (root, session) => join(bellDir(root), `${slug(session)}.shadow.json`)
// ⛔ A REMEMBERED PID IS CHECKED, NEVER TRUSTED: after a reboot or pid reuse it can be any process. A shadow is ours only when that pid runs bell-wait's shadow for this session
const SAFE_ROLE_ENV = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const isShadowOf = (pid, session) => {
  try { const cmd = execFileSync('ps', ['-o', 'command=', '-p', String(Number(pid))], { encoding: 'utf8' }); return /\bbell-wait\.mjs shadow\b/.test(cmd) && cmd.includes(`--session ${session} `) } catch { return false }
}
/**
 * The watchdog's step: in tee mode, one shadow per live session that has a doorbell; none in any other mode. targets = [{ session, pid, cwd, cmds }]
 * (the watchdog builds it from the roster, office.json and the live sessions). -> [{ session, act: started|kept|stopped }]
 */
export function shadowPass(root, cfg, targets, { spawnFn = spawnChild, alive = isShadowOf, kill = (p) => { try { process.kill(Number(p), 'SIGTERM') } catch {} }, pluginRoot = PLUGIN_ROOT } = {}) {
  const out = []
  const want = wakeModeOf(cfg) === 'tee' ? targets.filter((t) => t.session && t.pid && t.cmds?.length) : []
  let files = []
  try { files = readdirSync(bellDir(root)).filter((f) => f.endsWith('.shadow.json')) } catch {}
  const have = new Map()
  for (const f of files) { try { const j = JSON.parse(readFileSync(join(bellDir(root), f), 'utf8')); have.set(j.session, j) } catch {} }
  for (const t of want) {
    const h = have.get(t.session)
    have.delete(t.session)
    if (h && alive(h.pid, t.session) && h.sessionPid === t.pid && JSON.stringify(h.cmds) === JSON.stringify(t.cmds)) { out.push({ session: t.session, act: 'kept' }); continue }
    if (h && alive(h.pid, t.session)) kill(h.pid)
    const args = [join(pluginRoot, 'lib', 'bell-wait.mjs'), 'shadow', '--session', t.session, '--pid', String(t.pid), '--cwd', t.cwd, '--root', root, '--', ...t.cmds.flatMap((c, i) => (i ? ['--also', c] : [c]))]
    // the session's own role variable (office.json roleEnv, as start gives the session), so the doorbell's asks resolve the same identity as the live one's
    const role = typeof cfg?.roleEnv === 'string' && SAFE_ROLE_ENV.test(cfg.roleEnv) ? { [cfg.roleEnv]: t.session } : {}
    const c = spawnFn(process.execPath, args, { cwd: t.cwd, stdio: 'ignore', detached: true, env: { ...process.env, ...role, OFFICE_BELL_SHADOW: '1' } })
    c.unref?.()
    ensureDir(root)
    writeFileSync(shadowFile(root, t.session), JSON.stringify({ session: t.session, pid: c.pid, sessionPid: t.pid, cmds: t.cmds, at: new Date().toISOString() }))
    out.push({ session: t.session, act: 'started' })
  }
  for (const [session, h] of have) {
    if (alive(h.pid, session)) kill(h.pid)
    try { writeFileSync(shadowFile(root, session), '') } catch {}
    out.push({ session, act: 'stopped' })
  }
  return out
}

// the sessions a shadow is kept for: every live desk session with a doorbell, and every lead this machine runs with one
export async function shadowTargets(root, cfg, { live = null } = {}) {
  const { officeRoster } = await import('./desk.mjs')
  const { machineLeads } = await import('./departments.mjs')
  const procs = await import('./procs.mjs')
  const { wakeCommand } = await import('./wall.mjs')
  const all = live ?? procs.liveSessions()
  const newest = (f) => all.filter(f).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0]
  const out = []
  for (const d of officeRoster(root).desks) {
    if (typeof d.wake !== 'string' || !d.wake.trim()) continue
    const s = newest((x) => x.name === d.session)
    if (s) out.push({ session: d.session, pid: s.pid, cwd: d.dir, cmds: [wakeCommand(d.wake), ...(Array.isArray(d.wakeAlso) ? d.wakeAlso.map((a) => wakeCommand(a)) : [])] })
  }
  for (const l of machineLeads(root, cfg)) {
    if (typeof l.wake !== 'string' || !l.wake.trim()) continue
    const s = newest((x) => l.names.includes(x.name))
    const also = l.department ? cfg.departments?.[l.department]?.wakeAlso : cfg.lead?.wakeAlso
    if (s) out.push({ session: s.name, pid: s.pid, cwd: root, cmds: [wakeCommand(l.wake), ...(Array.isArray(also) ? also.filter((a) => typeof a === 'string' && a.trim()).map((a) => wakeCommand(a)) : [])] })
  }
  return out
}

// ── the comparison ───────────────────────────────────────────────────────────
// The ids a line is about (threads, messages, inbox rows, drafts): a shadow line matches a live one when it has the same kind and every id
const ID = /\b(?:[A-Z]{2,4}-\d{6}-\d+|LM-[\w-]+|DM-[\w-]+|LOCAL-[\w-]+)\b|\b(?:msg|team|oldest|saved|id)=\S+/g
export const kindOf = (l) => String(l).trim().split(/[\s:]/)[0]
export const idsOf = (l) => [...new Set(String(l).match(ID) ?? [])]
const steadyText = (l) => String(l).replace(/\d+/g, 'N').replace(/\s+/g, ' ').trim()
/**
 * rows: log rows. Live = tee 'line' rows; shadow = shadow 'woke' rows. A live line is matched when a shadow wake of the same session within
 * windowMs before or after it carries a line of the same kind with all its ids (no ids: the same text, digits aside). Pure.
 */
export function compare(rows, { windowMs = 10 * 60_000, session = null } = {}) {
  const mine = rows.filter((r) => !session || r.session === session)
  const live = mine.filter((r) => r.mode === 'tee' && r.event === 'line').flatMap((r) => (r.lines ?? []).map((l) => ({ at: Date.parse(r.at), session: r.session, line: l })))
  const shadow = mine.filter((r) => r.mode === 'shadow' && r.event === 'woke')
  const shadowLines = shadow.flatMap((r) => (r.lines ?? []).map((l) => ({ at: Date.parse(r.at), session: r.session, line: l, used: false })))
  const hit = (a, b) => {
    if (a.session !== b.session || Math.abs(a.at - b.at) > windowMs || kindOf(a.line) !== kindOf(b.line)) return false
    const ids = idsOf(a.line)
    if (!ids.length) return steadyText(a.line) === steadyText(b.line)
    const bi = new Set(idsOf(b.line))
    return ids.every((x) => bi.has(x))
  }
  const missed = []
  let matched = 0
  for (const a of live) { const b = shadowLines.find((s) => hit(a, s)); if (b) { b.used = true; matched++ } else missed.push(a) }
  // the live path's wakes: lines 200 ms apart are one notification; each tee start after the first is a re-arm (an expiry turn)
  const liveWakes = live.reduce((n, a, i) => n + (i === 0 || a.at - live[i - 1].at > 200 || a.session !== live[i - 1].session ? 1 : 0), 0)
  const rearms = mine.filter((r) => r.mode === 'tee' && r.event === 'start').length
  // ⛔ NO LIVE LINES IS NOT ZERO MISSES: a session shadowed but not yet restarted into the tee form logs nothing on the live side
  const teed = new Set(mine.filter((r) => r.mode === 'tee').map((r) => r.session))
  const unteed = [...new Set(shadow.map((r) => r.session))].filter((s) => !teed.has(s))
  return { live: live.length, matched, missed, extra: shadowLines.filter((s) => !s.used), liveWakes, rearms, shadowWakes: shadow.length, unteed }
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (isMain(import.meta.url)) {
  const [mode, ...rest] = process.argv.slice(2)
  const { opts, cmds } = parseArgs(rest)
  const root = opts.root ? resolve(opts.root) : findOffice(process.cwd())
  const cfg = root ? readOfficeConfig(root) : {}
  if (mode === 'nudge') {
    const [session, source, id] = opts._ ?? []
    // ⛔ only the office's own processes nudge: a Claude session (any role) is refused, whatever the wall let through
    if (sessionName()) { console.error('bell-wait: a Claude session does not nudge another; only the office\'s own processes (a launcher, a sweep) do'); process.exit(4) }
    if (!root || !session || !nudge(root, session, { from: opts.from, source, id })) { console.error('usage: bell-wait.mjs nudge <session> --from <process> <source> <id>  (inside an office; names and ids only, no text)'); process.exit(1) }
    process.exit(0)
  }
  if (mode === 'shadow-pass') {
    if (!root) process.exit(0)
    const r = shadowPass(root, cfg, wakeModeOf(cfg) === 'tee' ? await shadowTargets(root, cfg) : [])
    const changed = r.filter((x) => x.act !== 'kept')
    if (changed.length) console.log(`bell shadow: ${changed.map((x) => `${x.act} ${x.session}`).join(', ')}`)
    process.exit(0)
  }
  if (mode === 'compare') {
    const hours = Number(opts.hours) || 24
    const r = compare(root ? readLog(root, { sinceMs: Date.now() - hours * 3600_000 }) : [], { session: typeof opts.session === 'string' ? opts.session : null })
    console.log(JSON.stringify({ hours, ...r, missed: r.missed.map((m) => ({ at: new Date(m.at).toISOString(), session: m.session, line: m.line })), extra: r.extra.length }, null, 1))
    // 2 = a line missed; 3 = nothing to compare for some shadowed session (restart it into the tee form first)
    process.exit(r.missed.length ? 2 : r.unteed.length || !r.live ? 3 : 0)
  }
  if (!['wait', 'tee', 'shadow'].includes(mode) || !cmds.length) { console.error('usage: bell-wait.mjs wait|tee|shadow [--session S] -- <wake command> [--also <command>]...'); process.exit(1) }
  const session = typeof opts.session === 'string' ? opts.session : sessionName()
  if (mode === 'tee') process.exit(await runTee({ cmds, root, session }))
  if (mode === 'shadow') { await runShadow({ cmds, cwd: typeof opts.cwd === 'string' ? opts.cwd : process.cwd(), root, session, pid: Number(opts.pid) }); process.exit(0) }
  // wait: the session's own one-shot doorbell
  let ctl = null
  const quit = () => ctl?.stop()
  process.once('SIGTERM', quit); process.once('SIGINT', quit); process.once('SIGHUP', quit)
  const settleMs = Number.isFinite(cfg?.boot?.settleMs) ? Math.min(10_000, Math.max(200, cfg.boot.settleMs)) : SETTLE_MS
  if (root) logRow(root, { session, mode: 'wait', event: 'armed', cmds })
  const r = await waitOnce({ cmds, root, session, settleMs, dedupe: true, onStart: (c) => { ctl = c } })
  if (root) { logRow(root, { session, mode: 'wait', event: r.fallback ? 'fallback' : 'woke', lines: r.lines.map((l) => String(l).slice(0, 500)), waitedMs: r.waitedMs }); if (!r.fallback) officeWakeLog(root, cfg, session, r.lines) }
  process.exit(r.code)
}
