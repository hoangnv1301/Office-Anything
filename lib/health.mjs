// IS THE OFFICE WORKING. One owner for that question, and it only reads.
//
// ⛔ ALIVE AND IDLE IS NOT LISTENING. After a Mac restart (2026-10-05) every
// desk came back resumed, the session registry said "idle", and not one
// doorbell was running: a resumed session does not restore its background
// Monitors. The Discord desk sat deaf for minutes while every signal the
// office had read green. So a desk with a `wake` command is healthy only when
// that command runs UNDER ITS OWN SESSION: a doorbell process with the
// session's claude pid among its ancestors. The process tree is the proof;
// nothing the desk says about itself is.
//
// ⛔ A HOOK CANNOT START A MONITOR, only the model can. hooks/desk-boot.mjs
// tells the desk to start it on every start and resume; this module is the
// half that checks it happened.
//
// ⛔ WHAT COUNTS AS A DOORBELL IS NARROW, because heal.mjs kills orphans:
//   - the PROGRAM is the interpreter `wake` names (node), and the wake script
//     is one of its ARGUMENTS. `less`, `vim` or `grep` naming the file is not
//     a doorbell; a shell wrapping it is not the doorbell, its child is.
//   - an ORPHAN also needs every process above it to be a shell or node, all
//     the way to launchd (a manual run in a terminal has the terminal above
//     it), and its script must resolve inside THIS office (another checkout
//     running the same script is not ours to judge).
//   - a session is alive only if its pid is a claude process at least as old
//     as the session: a stale ~/.claude/sessions file whose pid was reused by
//     something else is not a live session.
//
// Answers, per desk: session (alive / dead / off), permission mode, status,
// last transcript activity, doorbell (armed / arming / unarmed / none), and
// office.json `health` checks. Codes are the checks' own: 0 green, 4 red, 7
// UNKNOWN; an office with no desks is UNKNOWN, never green. Acting on any of
// it is lib/heal.mjs's job, never this one's.
import { readdirSync, readFileSync, statSync, openSync, readSync, closeSync, realpathSync } from 'node:fs'
import { join, resolve, basename, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'
import { rosterSafe } from './desk.mjs'
import { readOfficeConfig, findOffice } from './office.mjs'
import { isMain } from './is-main.mjs'

const GRACE_SEC = 90
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'fish'])
const INTERPRETERS = new Set(['node', 'python', 'python3', 'ruby', 'bun', 'deno', ...SHELLS])

// ps etime: [[dd-]hh:]mm:ss
const etimeSec = (s) => {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(String(s).trim())
  return m ? ((+m[1] || 0) * 86400) + ((+m[2] || 0) * 3600) + (+m[3] * 60) + (+m[4]) : 0
}

// every process on the machine: pid -> { pid, ppid, ageSec, cmd }
export function processTable(run = execFileSync) {
  const out = new Map()
  let text = ''
  try { text = run('ps', ['-axo', 'pid=,ppid=,etime=,command='], { encoding: 'utf8', maxBuffer: 32 << 20 }) } catch { return out }
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line)
    if (m) out.set(+m[1], { pid: +m[1], ppid: +m[2], ageSec: etimeSec(m[3]), cmd: m[4] })
  }
  return out
}

// a process's working directory, for anchoring a relative script path
export function cwdOf(pid, run = execFileSync) {
  try {
    const out = run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const n = out.split('\n').find((l) => l.startsWith('n'))
    return n ? n.slice(1) : null
  } catch { return null }
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const words = (cmd) => String(cmd ?? '').trim().split(/\s+/)
export const progOf = (cmd) => basename(words(cmd)[0] ?? '').replace(/^-/, '')

// what `wake` runs: the interpreter, and the script relative to the desk
export function wakeSpec(desk) {
  const wake = typeof desk?.wake === 'string' ? desk.wake.trim() : ''
  if (!wake) return null
  const w = words(wake)
  const script = w.find((t) => /\.(m?js|cjs|py|sh|rb)$/.test(t)) ?? null
  return { prog: basename(w[0]), script, tail: script ? script.replace(/^(\.\.?\/)+/, '') : null }
}

// shown in --json; matching uses isDoorbell
export function wakePattern(desk) {
  if (typeof desk?.wakeMatch === 'string' && desk.wakeMatch) return new RegExp(desk.wakeMatch)
  const s = wakeSpec(desk)
  if (!s) return null
  return new RegExp('(^|[\\s/])' + esc(s.tail ?? desk.wake.trim()) + '(\\s|$)')
}

// What node runs is the FIRST non-option argument, and an option that takes a
// value (--require x, --import x, -e code) means the script is something else.
const VALUE_OPTS = new Set(['-r', '--require', '--import', '--loader', '--experimental-loader', '-e', '--eval', '-p', '--print', '-C', '--conditions', '--input-type', '--env-file'])
const firstScript = (cmd) => {
  const w = words(cmd)
  let i = 1
  while (i < w.length && w[i].startsWith('-')) {
    if (VALUE_OPTS.has(w[i])) return null
    i++
  }
  return w[i] ?? null
}

// ⛔ the program is the interpreter `wake` names and the script is the one it runs.
// (Whitespace splitting is good enough to RECOGNISE a doorbell for the armed
// rule; it is never what proves an orphan, see orphanVerdict.)
export function isDoorbell(p, desk) {
  const s = wakeSpec(desk)
  if (!s || !p?.cmd) return false
  const prog = progOf(p.cmd)
  if (SHELLS.has(prog)) return false
  if (typeof desk.wakeMatch === 'string' && desk.wakeMatch) return INTERPRETERS.has(prog) && new RegExp(desk.wakeMatch).test(p.cmd)
  if (prog !== s.prog || !s.tail) return false
  const t = firstScript(p.cmd)
  return !!t && (t === s.tail || t.endsWith('/' + s.tail))
}

const real = (f) => { try { return realpathSync(f) } catch { return resolve(f) } }

export const ancestors = (pid, procs) => {
  const seen = []
  let p = procs.get(pid)?.ppid
  for (let i = 0; i < 40 && p && p > 1 && !seen.includes(p); i++) { seen.push(p); p = procs.get(p)?.ppid }
  return seen
}

// the innermost matching process: the program, not the shell wrapping it
const innermost = (matches) => matches.filter((m) => !matches.some((o) => o.ppid === m.pid))

// THE armed rule, in one place.
export function doorbell(desk, session, procs, now = Date.now(), graceSec = GRACE_SEC) {
  if (!wakeSpec(desk)) return { state: 'none' }
  if (!session) return { state: 'down' }
  const mine = innermost([...procs.values()].filter((p) => isDoorbell(p, desk) && ancestors(p.pid, procs).includes(session.pid)))
  if (mine.length) return { state: 'armed', pid: mine[0].pid, ageSec: mine[0].ageSec }
  const since = session.startedAt ? Math.round((now - session.startedAt) / 1000) : null
  const grace = Number.isFinite(desk.wakeGraceSec) ? desk.wakeGraceSec : graceSec
  return { state: since !== null && since < grace ? 'arming' : 'unarmed', sinceStartSec: since }
}

// THE orphan rule, in one place. heal.mjs re-asks it on a fresh table before a kill.
//   null                        not an orphan (or not ours to judge)
//   { proven: true }            ours, and nobody's: may be killed under --heal
//   { proven: false, why }      looks like ours and orphaned, but cannot be
//                               proven: listed, never killed
//
// ⛔ PROOF IS AN EXACT FORM, NEVER A PARSE. A command line from ps has lost its
// quoting, and this office's path holds a space ("Extreme SSD"), so after the
// interpreter the raw text must be exactly one of:
//   <desk's wake script, as written>[ args]   with the process's cwd = the desk's own folder
//   <that script's absolute path>[ args]      (resolved or realpath), compared as a string
// Not a prefix of the office: a worktree under <root>/.claude/worktrees/ or a
// sibling folder sharing the prefix is somebody else's. Not any argument: a
// linter given the file, or --require, is another program.
// ⛔ Seen live: five buyer-wake processes under launchd whose cwd lsof could not
// read. Dropping them hid them; killing them would trust what is not proven.
export function orphanVerdict(p, desk, procs, livePids, root, cwd = cwdOf) {
  const s = wakeSpec(desk)
  if (!s?.script || desk.wakeOwner === 'launchd' || !p?.cmd) return null
  if (progOf(p.cmd) !== s.prog || !p.cmd.includes(s.tail)) return null
  const up = ancestors(p.pid, procs)
  if (up.some((a) => livePids.has(a))) return null
  // nothing but shells and node between it and launchd: a terminal, an editor
  // or a launcher above it means somebody owns it
  if (!up.every((a) => { const g = progOf(procs.get(a)?.cmd); return SHELLS.has(g) || g === 'node' })) return null
  const last = up.length ? procs.get(up.at(-1)) : procs.get(p.pid)
  if (last?.ppid !== 1) return null
  const rest = p.cmd.trimStart().slice(words(p.cmd)[0].length).trimStart()
  const is = (form) => rest === form || rest.startsWith(form + ' ')
  const deskDir = join(resolve(root), 'desks', desk.name)
  const abs = resolve(deskDir, s.script)
  if (isAbsolute(s.script) ? false : is(s.script)) {
    const c = cwd(p.pid)
    if (!c) return { proven: false, why: 'it runs the wake script by a relative path and its cwd cannot be read, so it is not proven to be this office\'s' }
    return real(c) === real(deskDir) ? { proven: true } : null
  }
  if (is(abs) || is(real(abs))) return { proven: true }
  return null
}
export const isOrphan = (...a) => orphanVerdict(...a)?.proven === true

const alive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }

// ⛔ A REUSED PID IS NOT A LIVE SESSION. With a process table, the pid must be
// a claude process that started no later than the session did. Without one
// (an empty injected table) only the signal test is possible.
export function liveSessions(home = homedir(), procs = new Map(), now = Date.now()) {
  const out = []
  const dir = join(process.env.CLAUDE_CONFIG_DIR && home === homedir() ? process.env.CLAUDE_CONFIG_DIR : join(home, '.claude'), 'sessions')
  let files = []
  try { files = readdirSync(dir) } catch { return out }
  for (const f of files) {
    if (!/^\d+\.json$/.test(f)) continue
    try {
      const j = JSON.parse(readFileSync(join(dir, f), 'utf8'))
      if (!j?.pid) continue
      if (procs.size) {
        const p = procs.get(j.pid)
        if (!p || !words(p.cmd).slice(0, 2).some((t) => basename(t) === 'claude' || /claude-code\//.test(t))) continue
        if (j.startedAt && now - p.ageSec * 1000 > j.startedAt + 120_000) continue
      } else if (!alive(j.pid)) continue
      out.push(j)
    } catch {}
  }
  return out
}

// what the CLI stamps on every transcript entry it writes; the session file
// carries no mode, so the newest entry is the truth
function transcriptFacts(home, s) {
  if (!s?.sessionId || !s?.cwd) return {}
  const p = join(home, '.claude', 'projects', resolve(s.cwd).replace(/[^A-Za-z0-9]/g, '-'), s.sessionId + '.jsonl')
  try {
    const st = statSync(p)
    const n = Math.min(st.size, 256 * 1024)
    const fd = openSync(p, 'r'); const buf = Buffer.alloc(n); readSync(fd, buf, 0, n, st.size - n); closeSync(fd)
    const modes = [...buf.toString('utf8').matchAll(/"permissionMode":"([A-Za-z]+)"/g)]
    return { mode: modes.at(-1)?.[1] ?? null, lastActivityMs: st.mtimeMs }
  } catch { return {} }
}

// office.json `health`: [{ name, cmd, expect: "exit0" | "/regex/flags", heal?, timeoutSec? }]
export function projectChecks(root, list) {
  if (!Array.isArray(list)) return []
  return list.filter((c) => c && typeof c.cmd === 'string').map((c) => {
    const r = spawnSync('/bin/sh', ['-c', c.cmd], { cwd: root, encoding: 'utf8', timeout: (Number(c.timeoutSec) || 10) * 1000 })
    const re = /^\/(.*)\/([a-z]*)$/.exec(String(c.expect ?? ''))
    const ok = r.error ? false : re ? new RegExp(re[1], re[2]).test(r.stdout ?? '') : r.status === 0
    const why = ok ? '' : r.error ? r.error.code === 'ETIMEDOUT' ? 'timed out' : r.error.message
      : re ? 'output did not match ' + c.expect : 'exit ' + r.status
    return { name: String(c.name ?? c.cmd), ok, why, heal: typeof c.heal === 'string' ? c.heal : null }
  })
}

// expected to be running: autostart is not off, or the desk asks to be watched
const expected = (d) => d.autostart !== false || d.watch === true

export function officeHealth(root, { home = homedir(), procs = processTable(), now = Date.now(), checks = true, cwd = cwdOf } = {}) {
  const cfg = readOfficeConfig(root)
  const { desks, broken } = rosterSafe(join(root, 'desks'))
  if (!desks.length) return { code: 7, line: `office: UNKNOWN · no desks under ${join(root, 'desks')}${broken.length ? ' (' + broken.length + ' unreadable)' : ''}`, desks: [], checks: [], orphans: [], broken }
  const sessions = liveSessions(home, procs, now)
  const livePids = new Set(sessions.map((s) => s.pid))
  const rows = desks.map((d) => {
    const s = sessions.filter((x) => x.name === 'desk-' + d.name).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0] ?? null
    const t = s ? transcriptFacts(home, s) : {}
    const session = s
      ? { state: 'alive', pid: s.pid, status: s.status ?? null, mode: t.mode ?? null, lastActivityMin: t.lastActivityMs ? Math.round((now - t.lastActivityMs) / 60000) : null }
      : { state: expected(d) ? 'dead' : 'off' }
    return { name: d.name, session, doorbell: s ? doorbell(d, s, procs, now) : { state: wakeSpec(d) ? 'down' : 'none' } }
  })
  const orphans = []
  for (const d of desks) {
    if (!wakeSpec(d)) continue
    for (const p of innermost([...procs.values()].filter((x) => isDoorbell(x, d)))) {
      const v = orphanVerdict(p, d, procs, livePids, root, cwd)
      if (v) orphans.push({ desk: d.name, pid: p.pid, ppid: p.ppid, ageSec: p.ageSec, cmd: p.cmd, proven: v.proven, ...(v.why ? { why: v.why } : {}) })
    }
  }
  const pc = checks ? projectChecks(root, cfg.health) : []
  const findings = [
    ...rows.filter((r) => r.session.state === 'dead').map((r) => ({ desk: r.name, say: 'is not running' })),
    ...rows.filter((r) => r.doorbell.state === 'unarmed').map((r) => ({ desk: r.name, short: 'doorbell unarmed', say: `doorbell unarmed${r.doorbell.sinceStartSec != null ? ' ' + Math.round(r.doorbell.sinceStartSec / 60) + 'm after start' : ''}: it is not hearing its wake-ups` })),
    ...pc.filter((c) => !c.ok).map((c) => ({ desk: c.name, say: c.why })),
    // an unreadable desk.json hides that desk from every row above: say so, plainly
    ...broken.map((b) => ({ desk: b.desk, short: 'desk.json unreadable, so it is not watched', say: b.why.replace(root + '/', '') })),
  ]
  const red = findings.map((f) => `${f.desk} ${f.short ?? f.say}`)
  const armed = rows.filter((r) => r.doorbell.state === 'armed').length
  const bells = rows.filter((r) => r.doorbell.state !== 'none').length
  const off = rows.filter((r) => r.session.state === 'off').map((r) => r.name)
  const unproven = orphans.filter((o) => !o.proven).length
  const tail = (orphans.length ? ` · ${orphans.length} orphan doorbell${orphans.length > 1 ? 's' : ''}${unproven ? ` (${unproven} unproven)` : ''}` : '')
    + (off.length ? ` · off by design: ${off.join(', ')}` : '')
  // the counts, true whatever the verdict
  const summary = `${rows.filter((r) => r.session.state === 'alive').length}/${rows.length} desks up · ${armed}/${bells} doorbells armed${pc.length ? ' · ' + pc.filter((c) => c.ok).length + '/' + pc.length + ' checks ok' : ''}${tail}`
  const line = red.length ? `office: RED · ${red.join(' · ')}${tail}` : `office: green · ${summary}`
  return { code: red.length ? 4 : 0, line, summary, findings, desks: rows, checks: pc, orphans, broken }
}

//   node lib/health.mjs [root] [--json] [--heal] [--install-watchdog | --uninstall-watchdog]
if (isMain(import.meta.url)) {
  const args = process.argv.slice(2)
  const at = args.find((a) => !a.startsWith('--'))
  const root = at ? resolve(at) : (findOffice(process.cwd()) ?? process.cwd())
  if (args.includes('--install-watchdog') || args.includes('--uninstall-watchdog')) {
    const w = await import('./watchdog.mjs')
    const r = args.includes('--install-watchdog') ? w.installWatchdog(root) : w.uninstallWatchdog(root)
    console.log(r.ok ? `${args.includes('--install-watchdog') ? 'installed' : 'removed'} ${r.label}${r.plist ? ' · ' + r.plist : ''}` : `⛔ ${r.why}`)
    process.exit(r.ok ? 0 : 1)
  }
  const h = officeHealth(root)
  let acts = null
  if (args.includes('--heal')) acts = (await import('./heal.mjs')).heal(root, h).acts
  if (args.includes('--json')) console.log(JSON.stringify(acts ? { ...h, acts } : h, null, 2))
  else {
    console.log(new Date().toISOString() + ' ' + h.line)
    for (const a of acts ?? []) console.log(`  ${a.ok ? 'did' : 'did not'} ${a.act} ${a.desk ?? a.name ?? a.subject ?? ''}${a.pid ? ' pid ' + a.pid : ''}${a.why ? ' — ' + a.why : ''}`)
  }
  process.exit(h.code)
}
