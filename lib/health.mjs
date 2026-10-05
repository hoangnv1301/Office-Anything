// IS THE OFFICE WORKING. One owner for that question, and it only reads.
//
// ⛔ ALIVE AND IDLE IS NOT LISTENING. After a Mac restart (2026-10-05) every
// desk came back resumed, the session registry said "idle", and not one
// doorbell was running: a resumed session does not restore its background
// Monitors. The Discord desk sat deaf for minutes while every signal the
// office had read green. So a desk with a `wake` command is healthy only when
// that command runs UNDER ITS OWN SESSION: a process matching the doorbell,
// with the session's claude pid among its ancestors. The process tree is the
// proof; nothing the desk says about itself is.
//
// ⛔ A HOOK CANNOT START A MONITOR, only the model can. hooks/desk-boot.mjs
// tells the desk to start it on every start and resume; this module is the
// half that checks it happened.
//
// Answers, per desk: session (alive / dead / off), permission mode, status,
// last transcript activity, doorbell (armed / arming / unarmed / none), and
// office.json `health` checks. Codes are the checks' own: 0 green, 4 red, 7
// UNKNOWN; an office with no desks is UNKNOWN, never green. Orphans (a doorbell whose session is gone) are listed; acting on any
// of it is lib/heal.mjs's job, never this one's.
import { readdirSync, readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'
import { rosterSafe } from './desk.mjs'
import { readOfficeConfig, findOffice } from './office.mjs'
import { isMain } from './is-main.mjs'

const GRACE_SEC = 90

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

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The doorbell is recognised by the SCRIPT it runs, not the whole command
// line: `node ../../scripts/x/wake.mjs` runs as `/usr/bin/node /abs/scripts/x/wake.mjs`.
export function wakePattern(desk) {
  if (typeof desk?.wakeMatch === 'string' && desk.wakeMatch) return new RegExp(desk.wakeMatch)
  const wake = typeof desk?.wake === 'string' ? desk.wake.trim() : ''
  if (!wake) return null
  const script = wake.split(/\s+/).find((t) => /\.(m?js|cjs|py|sh|rb)$/.test(t))
  const tail = (script ?? wake).replace(/^(\.\.?\/)+/, '')
  return new RegExp('(^|[\\s/])' + esc(tail) + '(\\s|$)')
}

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
  const re = wakePattern(desk)
  if (!re) return { state: 'none' }
  if (!session) return { state: 'down' }
  const mine = innermost([...procs.values()].filter((p) => re.test(p.cmd) && ancestors(p.pid, procs).includes(session.pid)))
  if (mine.length) return { state: 'armed', pid: mine[0].pid, ageSec: mine[0].ageSec }
  const since = session.startedAt ? Math.round((now - session.startedAt) / 1000) : null
  const grace = Number.isFinite(desk.wakeGraceSec) ? desk.wakeGraceSec : graceSec
  return { state: since !== null && since < grace ? 'arming' : 'unarmed', sinceStartSec: since }
}

const alive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }

export function liveSessions(home = homedir()) {
  const out = []
  const dir = join(process.env.CLAUDE_CONFIG_DIR && home === homedir() ? process.env.CLAUDE_CONFIG_DIR : join(home, '.claude'), 'sessions')
  let files = []
  try { files = readdirSync(dir) } catch { return out }
  for (const f of files) {
    if (!/^\d+\.json$/.test(f)) continue
    try {
      const j = JSON.parse(readFileSync(join(dir, f), 'utf8'))
      if (j?.pid && alive(j.pid)) out.push(j)
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

export function officeHealth(root, { home = homedir(), procs = processTable(), now = Date.now(), checks = true } = {}) {
  const cfg = readOfficeConfig(root)
  const { desks, broken } = rosterSafe(join(root, 'desks'))
  if (!desks.length) return { code: 7, line: `office: UNKNOWN · no desks under ${join(root, 'desks')}${broken.length ? ' (' + broken.length + ' unreadable)' : ''}`, desks: [], checks: [], orphans: [], broken }
  const sessions = liveSessions(home)
  const livePids = new Set(sessions.map((s) => s.pid))
  const rows = desks.map((d) => {
    const s = sessions.filter((x) => x.name === 'desk-' + d.name).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0] ?? null
    const t = s ? transcriptFacts(home, s) : {}
    const session = s
      ? { state: 'alive', pid: s.pid, status: s.status ?? null, mode: t.mode ?? null, lastActivityMin: t.lastActivityMs ? Math.round((now - t.lastActivityMs) / 60000) : null }
      : { state: d.autostart === false ? 'off' : 'dead' }
    return { name: d.name, session, doorbell: s ? doorbell(d, s, procs, now) : { state: wakePattern(d) ? 'down' : 'none' } }
  })
  // a doorbell with no live session anywhere above it; one a desk declares as
  // owned by launchd (wakeOwner) has ppid 1 by design and is never an orphan
  const orphans = []
  for (const d of desks) {
    const re = wakePattern(d)
    if (!re || d.wakeOwner === 'launchd') continue
    const hits = innermost([...procs.values()].filter((p) => re.test(p.cmd)))
    for (const p of hits) if (!ancestors(p.pid, procs).some((a) => livePids.has(a))) orphans.push({ desk: d.name, pid: p.pid, ageSec: p.ageSec, cmd: p.cmd })
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
  const tail = orphans.length ? ` · ${orphans.length} orphan doorbell${orphans.length > 1 ? 's' : ''}` : ''
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
  const procs = processTable()
  const h = officeHealth(root, { procs })
  let acts = null
  if (args.includes('--heal')) acts = (await import('./heal.mjs')).heal(root, h, { procs }).acts
  if (args.includes('--json')) console.log(JSON.stringify(acts ? { ...h, acts } : h, null, 2))
  else {
    console.log(new Date().toISOString() + ' ' + h.line)
    for (const a of acts ?? []) console.log(`  ${a.ok ? 'did' : 'did not'} ${a.act} ${a.desk ?? a.name ?? a.subject ?? ''}${a.pid ? ' pid ' + a.pid : ''}${a.why ? ' — ' + a.why : ''}`)
  }
  process.exit(h.code)
}
