// THE PROCESS TREE, read and judged: what a doorbell is, whose it is, and
// which sessions are alive. lib/health.mjs reports with it and lib/heal.mjs
// re-proves with it right before acting.
//
// ⛔ ITS OWN MODULE BECAUSE A CYCLE HUNG THE CLI. heal.mjs imported health.mjs
// while `node lib/health.mjs --heal` was still evaluating it: an unsettled
// top-level await, exit 13, every run. Neither depends on the other now.
import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { join, resolve, basename, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'

export const GRACE_SEC = 90
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
// With the office root known, the same exact forms as the orphan proof decide
// (a path with a space, "Extreme SSD", is compared as written, never split);
// without it, the first script node runs, split on whitespace.
export function isDoorbell(p, desk, root = null) {
  const s = wakeSpec(desk)
  if (!s || !p?.cmd) return false
  const prog = progOf(p.cmd)
  if (SHELLS.has(prog)) return false
  if (typeof desk.wakeMatch === 'string' && desk.wakeMatch) return INTERPRETERS.has(prog) && new RegExp(desk.wakeMatch).test(p.cmd)
  if (prog !== s.prog || !s.tail) return false
  if (root && desk.name) return formOf(p, desk, root) !== null
  const t = firstScript(p.cmd)
  return !!t && (t === s.tail || t.endsWith('/' + s.tail))
}

const real = (f) => { try { return realpathSync(f) } catch { return resolve(f) } }

// after the interpreter, the raw command is EXACTLY the desk's wake script as
// written ('relative', still to be placed by its cwd) or its absolute path
// ('absolute'), optionally followed by arguments; anything else is null
export function formOf(p, desk, root) {
  const s = wakeSpec(desk)
  if (!s?.script) return null
  const rest = p.cmd.trimStart().slice(words(p.cmd)[0].length).trimStart()
  const is = (f) => rest === f || rest.startsWith(f + ' ')
  if (!isAbsolute(s.script) && is(s.script)) return 'relative'
  const abs = resolve(join(resolve(root), 'desks', desk.name), s.script)
  return is(abs) || is(real(abs)) ? 'absolute' : null
}

export const ancestors = (pid, procs) => {
  const seen = []
  let p = procs.get(pid)?.ppid
  for (let i = 0; i < 40 && p && p > 1 && !seen.includes(p); i++) { seen.push(p); p = procs.get(p)?.ppid }
  return seen
}

// the innermost matching process: the program, not the shell wrapping it
export const innermost = (matches) => matches.filter((m) => !matches.some((o) => o.ppid === m.pid))

// THE armed rule, in one place.
export function doorbell(desk, session, procs, now = Date.now(), graceSec = GRACE_SEC, root = null) {
  if (!wakeSpec(desk)) return { state: 'none' }
  if (!session) return { state: 'down' }
  const mine = innermost([...procs.values()].filter((p) => isDoorbell(p, desk, root) && ancestors(p.pid, procs).includes(session.pid)))
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
  const form = formOf(p, desk, root)
  if (form === 'absolute') return { proven: true }
  if (form === 'relative') {
    const c = cwd(p.pid)
    if (!c) return { proven: false, why: 'it runs the wake script by a relative path and its cwd cannot be read, so it is not proven to be this office\'s' }
    return real(c) === real(join(resolve(root), 'desks', desk.name)) ? { proven: true } : null
  }
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
