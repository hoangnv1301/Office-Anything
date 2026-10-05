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
import { statSync, openSync, readSync, closeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { rosterSafe } from './desk.mjs'
import { readOfficeConfig, findOffice } from './office.mjs'
import { isMain } from './is-main.mjs'

import { processTable, cwdOf, progOf, wakeSpec, wakePattern, isDoorbell, ancestors, innermost, doorbell, orphanVerdict, isOrphan, liveSessions, formOf, GRACE_SEC } from './procs.mjs'
export { processTable, cwdOf, progOf, wakeSpec, wakePattern, isDoorbell, ancestors, doorbell, orphanVerdict, isOrphan, liveSessions, formOf, GRACE_SEC }

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
    return { name: d.name, session, doorbell: s ? doorbell(d, s, procs, now, GRACE_SEC, root) : { state: wakeSpec(d) ? 'down' : 'none' } }
  })
  const orphans = []
  for (const d of desks) {
    if (!wakeSpec(d)) continue
    for (const p of innermost([...procs.values()].filter((x) => isDoorbell(x, d, root)))) {
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
  let acts = null, healed = null
  if (args.includes('--heal')) { healed = (await import('./heal.mjs')).heal(root, h); acts = healed.acts }
  if (args.includes('--json')) console.log(JSON.stringify(healed ? { ...h, acts, skipped: healed.skipped, note: healed.note } : h, null, 2))
  else {
    console.log(new Date().toISOString() + ' ' + h.line)
    // a heal that did not run says so: a red office with no word of why is the silence this exists to end
    if (healed?.skipped) console.log('  heal skipped: ' + healed.skipped)
    if (healed?.note) console.log('  ' + healed.note)
    for (const a of acts ?? []) console.log(`  ${a.ok ? 'did' : 'did not'} ${a.act} ${a.desk ?? a.name ?? a.subject ?? ''}${a.pid ? ' pid ' + a.pid : ''}${a.why ? ' — ' + a.why : ''}`)
  }
  process.exit(h.code)
}
