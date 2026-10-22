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
import { statSync, openSync, readSync, closeSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { watchdogWanted, watchdogStatus, ensureWatchdog } from './watchdog.mjs'
import { staleTasks } from './tasks.mjs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { rosterSafe, deskOfSession, officeRoster, deskDir, deskRoots } from './desk.mjs'
import { readOfficeConfig, findOffice, childOf } from './office.mjs'
import { duplicateAdvice } from './start.mjs'
import { isMain } from './is-main.mjs'
import { readSwitch, deskOn, closeWhenIdleOf, deskWork, idledState, LAST_CALL_MIN } from './desks.mjs'
import { idleSince, lastWorkAt } from './idle.mjs'
import { projectDirOf } from './conversation.mjs'
import { leadReach } from './lead-reach.mjs'
import { compactConfig, compactVerdict, transcriptTail } from './compact.mjs'
import { limitsConfig, watched, stuckOn, liftedBy, dueAt, fmt as fmtAt, MAX_TRIES } from './limits.mjs'
import { departmentsOf, machineOf, machineLeads, allLeads, cfgForLead } from './departments.mjs'
import { wakeCommand } from './wall.mjs'

import { processTable, cwdOf, progOf, wakeSpec, wakePattern, isDoorbell, ancestors, innermost, doorbell, orphanVerdict, isOrphan, liveSessions, formOf, GRACE_SEC, unreadableSessions } from './procs.mjs'
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

// ⛔ TWO SESSIONS UNDER ONE NAME ARE TWO WRITERS (2026-10-19: two live copies
// of one buyer thread, cs-Web-visitor-ffc681). Every name this office owns is
// judged: desk-<name>, a case session desk-<name>--<key>, a wall.aliasNames
// name. The lead's names are LEAD-DUPLICATE's, said once. Reads only.
// -> [{ type: 'SESSION-DUPLICATE', name, key, line }]
export function sessionDuplicates(root, cfg, sessions) {
  const roster = officeRoster(root).desks
  const lead = new Set(allLeads(cfg).flatMap((l) => l.names))
  const alias = (Array.isArray(cfg?.wall?.aliasNames) ? cfg.wall.aliasNames : []).flatMap((p) => { try { return [new RegExp(p)] } catch { return [] } })
  const owned = (n) => {
    if (lead.has(n)) return false
    const hit = deskOfSession(roster, n)
    if (hit) return hit.key == null || !!childOf(root, n)
    return alias.some((re) => re.test(n))
  }
  const byName = new Map()
  for (const s of sessions) if (typeof s.name === 'string' && s.name && owned(s.name)) byName.set(s.name, [...(byName.get(s.name) ?? []), s])
  return [...byName].filter(([, ss]) => ss.length > 1).map(([name, ss]) => ({ type: 'SESSION-DUPLICATE', name, key: `SESSION-DUPLICATE:${name}`, line: `${ss.length} live sessions are named ${name}, two writers on one conversation: ${duplicateAdvice(ss)}. Nothing is closed from here.` }))
}

// close-when-idle (0.10.4): health judges, heal acts on a "close" after a fresh look.
// -> { verdict: 'close' | 'keep', why, minutes, idleMin, pid, statusUpdatedAt }
export function idleVerdict(root, cfg, d, s, procs, { minutes, now, configDir }) {
  const base = { minutes, pid: s.pid, sessionId: s.sessionId ?? null, statusUpdatedAt: s.statusUpdatedAt ?? null }
  const keep = (why, extra = {}) => ({ ...base, verdict: 'keep', why, ...extra })
  const since = idleSince(d, s, procs, { now: () => now, dir: configDir, root })
  if (since == null) return keep(s.status === 'busy' || !s.status ? 'mid-turn' : `${s.status}, not provably idle`)
  const last = s.sessionId && s.cwd ? lastWorkAt(join(projectDirOf(s.cwd, configDir), `${s.sessionId}.jsonl`), d) : null
  if (last != null && now - last < LAST_CALL_MIN * 60_000) return keep(`its last tool call was ${Math.round((now - last) / 60_000)} min ago`)
  const idleMin = Math.round((now - Math.max(since, last ?? 0)) / 60_000)
  if (idleMin < minutes) return keep(`idle ${idleMin} of ${minutes} min`, { idleMin })
  const w = deskWork(root, cfg, d.name, { now })
  if (w.unknown) return keep(w.unknown, { idleMin })
  if (w.items.length) return keep(`work waiting: ${w.items.slice(0, 3).join('; ')}`, { idleMin })
  return { ...base, verdict: 'close', why: `idle ${idleMin} min, nothing waiting`, idleMin }
}

// expected to be running: autostart is not off, or the desk asks to be watched
// AND it is on on this machine (lib/desks.mjs): "dead" is what the watchdog
// restarts, so a desk switched off here must read "off", never "dead"
const expected = (d, sw) => (d.autostart !== false || d.watch === true) && deskOn(sw, d).on

export function officeHealth(root, { home = homedir(), procs = processTable(), now = Date.now(), checks = true, cwd = cwdOf, launchctl, platform } = {}) {
  const cfg = readOfficeConfig(root)
  const { desks, broken } = officeRoster(root)
  if (!desks.length) return { code: 7, line: `office: UNKNOWN · no desks under ${deskRoots(root).map((r) => r.dir).join(' or ')}${broken.length ? ' (' + broken.length + ' unreadable)' : ''}`, desks: [], checks: [], orphans: [], broken }
  const sessions = liveSessions(home, procs, now)
  const sw = readSwitch(root)
  const livePids = new Set(sessions.map((s) => s.pid))
  const cwi = closeWhenIdleOf(cfg, desks.map((d) => d.name))
  const configDir = join(home, '.claude')
  // idle compact (lib/compact.mjs): when heal last typed /compact, per session name
  let compacted = {}
  try { compacted = JSON.parse(readFileSync(join(root, '.office', 'heal-state.json'), 'utf8')).compacted ?? {} } catch {}
  const sizeOf = (s, conf) => { const tail = transcriptTail(home, s); return { ctxK: tail.ctx == null ? null : Math.round(tail.ctx / 1000), compact: conf ? { ...compactVerdict(conf, s, tail, { now, last: compacted[s.name] ?? null }), pid: s.pid, name: s.name, statusUpdatedAt: s.statusUpdatedAt ?? null } : null } }
  const rows = desks.map((d) => {
    // its session under its name now or, started before a rename, under its id
    // (alive, and heal restarts it under the new name once it is idle)
    const s = sessions.filter((x) => x.name === d.session).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0]
      ?? sessions.filter((x) => x.name === 'desk-' + d.name && d.session !== x.name && (!x.cwd || resolve(x.cwd) === deskDir(root, d.name))).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0] ?? null
    const t = s ? transcriptFacts(home, s) : {}
    let session = s
      ? { state: 'alive', pid: s.pid, status: s.status ?? null, mode: t.mode ?? null, lastActivityMin: t.lastActivityMs ? Math.round((now - t.lastActivityMs) / 60000) : null, ...(s.name !== d.session ? { renamed: s.name, statusUpdatedAt: s.statusUpdatedAt ?? null } : {}) }
      : { state: deskOn(sw, d).outside ? 'elsewhere' : expected(d, sw) ? 'dead' : 'off' }
    // closed on purpose (lib/desks.mjs): idled is not dead; woken is dead, and heal's restart is the wake
    if (!s && session.state === 'dead') {
      const iv = idledState(root, cfg, d.name, { configDir, sessions, now })
      if (iv?.state === 'idled') session = { state: 'idled', since: iv.marker.at }
      else if (iv?.state === 'woken') session = { state: 'dead', wake: iv.why }
    }
    const dept = departmentsOf(cfg).byDesk.get(d.name) ?? null
    const row = { name: d.name, tag: d.session, ...(dept ? { department: dept } : {}), session, doorbell: s ? doorbell(d, s, procs, now, GRACE_SEC, root) : { state: wakeSpec(d) && session.state !== 'idled' ? 'down' : 'none' } }
    if (s) Object.assign(row, sizeOf(s, compactConfig(cfg, { desk: d })))
    if (s && cwi.minutes.has(d.name)) row.idle = idleVerdict(root, cfg, d, s, procs, { minutes: cwi.minutes.get(d.name), now, configDir })
    return row
  })
  const orphans = []
  for (const d of desks) {
    if (!wakeSpec(d)) continue
    for (const p of innermost([...procs.values()].filter((x) => isDoorbell(x, d, root)))) {
      const v = orphanVerdict(p, d, procs, livePids, root, cwd)
      if (v) orphans.push({ desk: d.name, pid: p.pid, ppid: p.ppid, ageSec: p.ageSec, cmd: p.cmd, proven: v.proven, ...(v.why ? { why: v.why } : {}) })
    }
  }
  // the lead: its doorbell (office.json lead.wake), and whether desks can reach it by name
  // the leads THIS machine runs (lib/departments.mjs): one without departments,
  // the ones its departments name with them. Another department's lead at the
  // root is not this one misnamed.
  const unreadable = unreadableSessions(home, procs)
  const everyName = allLeads(cfg).flatMap((l) => l.names)
  const leads = machineLeads(root, cfg).map((l) => {
    const sess = sessions.filter((x) => l.names.includes(x.name)).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0] ?? null
    const bell = typeof l.wake === 'string' && l.wake.trim() && sess ? doorbell({ name: 'lead', wake: wakeCommand(l.wake) }, sess, procs, now, GRACE_SEC, null) : { state: 'none' }
    const problems = leadReach(root, cfgForLead(cfg, l), { sessions, unreadable, configDir: join(home, '.claude'), now, others: everyName.filter((n) => !l.names.includes(n)) })
    return { department: l.department, name: l.session, label: l.department ? l.session : 'lead', wake: l.wake, ...(sess ? sizeOf(sess, compactConfig(cfg, { isLead: true })) : {}), session: sess ? { pid: sess.pid, name: sess.name } : null, doorbell: bell, reach: problems.map((p) => p.key), problems }
  })
  // usage limits (lib/limits.mjs): the watched sessions stuck on one, and
  // whether it has lifted. heal-state.json says what heal already tried
  const LC = limitsConfig(cfg)
  let limits = []
  if (LC) {
    let tried = {}
    try { tried = JSON.parse(readFileSync(join(root, '.office', 'heal-state.json'), 'utf8')).limits ?? {} } catch {}
    const stuck = watched(root, LC, sessions).map(({ session: s, tab }) => { const l = stuckOn(home, s); return l ? { s, tab, l } : null }).filter(Boolean)
    const stuckPids = new Set(stuck.map((x) => x.s.pid))
    const others = sessions.filter((s) => !stuckPids.has(s.pid))
    limits = stuck.map(({ s, tab, l }) => {
      const mine = tried[l.uuid] ?? {}
      const lifted = liftedBy(home, l, others)
      const desk = rows.find((r) => r.session.pid === s.pid)?.name ?? null
      return { name: s.name || `pid ${s.pid}`, pid: s.pid, sessionId: s.sessionId, cwd: s.cwd, tab, desk, ...l, lifted, due: dueAt(LC, l, { liftSeen: mine.liftSeen ?? lifted?.at ?? null, isDesk: !!desk }), tries: mine.tries ?? [], why: mine.why ?? null }
    })
  }
  const D = departmentsOf(cfg)
  const mach = D.on ? machineOf(root, cfg) : null
  const pc = checks ? projectChecks(root, cfg.health) : []
  // how long each dead desk has been down: the watchdog writes it (lib/heal.mjs), health only reads
  let down = {}
  try { down = JSON.parse(readFileSync(join(root, '.office', 'heal-state.json'), 'utf8')).down ?? {} } catch {}
  const staleList = staleTasks(root, { now })
  const wd = watchdogWanted(cfg) ? watchdogStatus(root, { home, ...(launchctl ? { launchctl } : {}), ...(platform ? { platform } : {}) }) : null
  const findings = [
    ...leads.filter((l) => l.doorbell.state === 'unarmed').map((l) => ({ desk: l.label, short: 'doorbell unarmed', say: `doorbell unarmed: it is not hearing its wake-ups. Re-arm it with Monitor (timeout_ms 1800000): ${l.wake}` })),
    ...leads.flatMap((l) => l.problems.map((p) => ({ desk: l.label, short: p.type === 'LEAD-DUPLICATE' ? 'duplicate lead' : 'unreachable by name', say: p.line.replace(/^lead: /, '') }))),
    ...departmentFindings(root, cfg, D, mach, procs, now, spawnSync, cwd),
    ...sessionDuplicates(root, cfg, sessions).map((p) => ({ desk: p.name, short: 'duplicate session', say: p.line })),
    ...(wd && wd.state !== 'loaded' ? [wd.state === 'unsupported'
      ? { desk: 'watchdog', short: 'watchdog unsupported here', say: wd.why }
      : { desk: 'watchdog', short: 'watchdog not installed', say: `watchdog not installed${wd.state === 'not loaded' ? ' (its plist is there but launchd has not loaded it)' : ''}: nothing restarts a dead desk or lead while nobody looks. Install it: node '${fileURLToPath(new URL('./health.mjs', import.meta.url))}' '${root}' --install-watchdog` }] : []),
    ...staleList.map((t) => ({ desk: 'tasks', short: `${t.id} stale`, say: `${t.id} "${t.title}" (${t.assigned}) ${t.why}` })),
    ...cwi.unknown.map((k) => ({ desk: 'office.json', short: `closeWhenIdle names "${k}", which is no desk`, say: `closeWhenIdle names "${k}", which is no desk on the roster: it closes nothing. Fix the name or remove it` })),
    ...rows.filter((r) => r.session.state === 'dead').map((r) => ({ desk: r.name, say: 'is not running' + (down[r.name] != null ? ` · down ${Math.round((now - down[r.name]) / 60000)}m` : '') })),
    ...rows.filter((r) => r.doorbell.state === 'unarmed').map((r) => ({ desk: r.name, short: 'doorbell unarmed', say: `doorbell unarmed${r.doorbell.sinceStartSec != null ? ' ' + Math.round(r.doorbell.sinceStartSec / 60) + 'm after start' : ''}: it is not hearing its wake-ups` })),
    ...pc.filter((c) => !c.ok).map((c) => ({ desk: c.name, say: c.why })),
    // a limit is red only once the watcher could not end it: two resumes that did
    // not take, or a limit lifted half an hour ago that nothing could resume
    ...limits.filter((l) => (l.tries.length >= MAX_TRIES && now - l.tries.at(-1) >= LC.retryMin * 60_000) || (!l.tries.length && l.due != null && now - l.due > 30 * 60_000)).map((l) => ({ desk: l.name, short: 'stuck on its usage limit', say: l.tries.length ? `still stuck on its usage limit after ${l.tries.length} resumes ("${l.text}"): it needs a person` : `its usage limit lifted at ${fmtAt(l.due)} and it was not resumed${l.why ? ` (${l.why})` : ''}` })),
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
    + (() => {
      // the fat ones, fattest first: every turn re-reads the whole context
      const limit = Number.isFinite(cfg.compact?.aboveK) ? cfg.compact.aboveK : 150
      // every live session in this office, desks and leads and the rest (case
      // sessions, buyer teammates): only desks and leads are compacted
      const seen = new Set([...leads.map((l) => l.session?.pid), ...rows.map((r) => r.session.pid)].filter(Boolean))
      const rest = sessions.filter((s) => !seen.has(s.pid) && s.cwd && (resolve(s.cwd) === resolve(root) || resolve(s.cwd).startsWith(resolve(root) + '/'))).map((s) => { const t = transcriptTail(home, s); return { n: s.name || `pid ${s.pid}`, k: t.ctx == null ? null : Math.round(t.ctx / 1000) } })
      const fat = [...leads.map((l) => ({ n: l.name, k: l.ctxK })), ...rows.map((r) => ({ n: r.session.renamed ?? r.tag ?? 'desk-' + r.name, k: r.ctxK })), ...rest].filter((x) => x.k != null && x.k >= limit).sort((a, b) => b.k - a.k)
      return fat.length ? ` · fat contexts: ${fat.map((x) => `${x.n} ${x.k}K`).join(', ')}` : ''
    })()
    + (limits.length ? ` · usage-limited: ${limits.map((l) => `${l.name} (${l.model ? l.model + ' ' : ''}${l.kind ?? 'limit'} since ${fmtAt(l.since)}, resets ${fmtAt(l.resetAt)}${l.lifted ? `, lifted: ${l.lifted.by} answered ${fmtAt(l.lifted.at)}` : ''}${l.due != null ? `, resume ${l.tries.length ? `try ${l.tries.length}/${MAX_TRIES}` : 'due ' + fmtAt(l.due)}` : ''}${l.queued ? `, ${l.queued} queued` : ''})`).join(', ')}` : '')
    + (D.ignored ? ` · ${D.ignored}` : '')
    + (rows.some((r) => r.session.renamed) ? ` · renamed, restarts under the new name when idle: ${rows.filter((r) => r.session.renamed).map((r) => `${r.session.renamed} → ${r.tag}`).join(', ')}` : '')
  // the counts, true whatever the verdict
  const here = rows.filter((r) => r.session.state !== 'elsewhere')
  // the roll-call per department (0.18.0): each lead reads its own count
  const byDept = D.on ? D.list.map((d) => { const mine = here.filter((r) => r.department === d.id); return mine.length ? `${d.label} ${mine.filter((r) => r.session.state === 'alive').length}/${mine.length}` : null }).filter(Boolean) : []
  const summary = `${here.filter((r) => r.session.state === 'alive').length}/${here.length} desks up${byDept.length ? ` (${byDept.join(', ')})` : ''} · ${armed}/${bells} doorbells armed${pc.length ? ' · ' + pc.filter((c) => c.ok).length + '/' + pc.length + ' checks ok' : ''}${tail}`
  const line = red.length ? `office: RED · ${red.join(' · ')}${tail}` : `office: green · ${summary}`
  const strip = ({ problems, ...l }) => l
  return { code: red.length ? 4 : 0, line, summary, findings, desks: rows, checks: pc, orphans, broken, limits, leads: leads.map(strip), lead: leads[0] ? strip(leads[0]) : { session: null, doorbell: { state: 'none' }, reach: [] } }
}

// ── departments, per machine (lib/departments.mjs) ─────────────────────────
// ⛔ A BLOCK AND NO SETTING STARTS NO LEAD. Health says so in red: the lead's
// call 2026-10-22, so AICS can never come up on a machine nobody configured.
// ⛔ BUYER MACHINERY ON A MACHINE THAT DID NOT SAY SO double-sends to buyers.
// A department's "services" running where this machine does not name that
// department is red, by process and pid. Nothing is killed from here.
// ⛔ THE SWEEPS LEASE: only a machine whose local.json says "sweeps": true
// asks; another machine holding it is red, an unreadable answer is UNKNOWN.
const leases = new Map()
// A shell whose command line merely MENTIONS the pattern (a `sh -c` wrapper, a
// person's grep) is not the machinery: its child is. A process running in
// another office's folder is that office's.
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'fish', 'grep', 'rg', 'pgrep', 'ps'])
export function departmentFindings(root, cfg, D, mach, procs, now = Date.now(), run = spawnSync, cwd = cwdOf) {
  if (!D?.on) return []
  const out = []
  if (mach.error) out.push({ desk: 'departments', short: 'this machine\'s department setting is broken', say: `${mach.error}: nothing is started until it is fixed (node lib/desks.mjs departments set <id> …)` })
  else if (!mach.set) out.push({ desk: 'departments', short: 'this machine names no department', say: 'office.json declares departments and this machine names none, so no department lead is started or restarted here. Run: node lib/desks.mjs departments set <id> …' })
  const mine = new Set(mach.set ?? [])
  for (const d of D.list) {
    if (mine.has(d.id) || !d.services.length) continue
    const res = d.services.flatMap((p) => { try { return [new RegExp(p)] } catch { return [] } })
    for (const p of procs?.values?.() ?? []) {
      if (!res.some((re) => re.test(String(p.cmd ?? ''))) || SHELLS.has(progOf(p.cmd ?? ''))) continue
      let at = null
      try { at = cwd(p.pid) } catch {}
      if (at && resolve(at) !== resolve(root) && !resolve(at).startsWith(resolve(root) + '/')) continue
      out.push({ desk: 'departments', short: `${d.id} service running here (pid ${p.pid})`, say: `pid ${p.pid} runs ${d.id} machinery ("${String(p.cmd).slice(0, 120)}") and this machine does not name ${d.id} in .office/local.json: it can double-send. Stop it, or set this machine's departments` })
    }
  }
  if (mach.sweeps) {
    for (const d of D.list) {
      if (!mine.has(d.id) || !d.sweepsLease) continue
      const k = root + '\0' + d.sweepsLease
      let r = leases.get(k)
      if (!r || now - r.at > 30_000) {
        const s = run('/bin/sh', ['-c', d.sweepsLease], { cwd: root, encoding: 'utf8', timeout: 30_000 })
        r = { at: now, status: s.error ? null : s.status, first: String(s.stdout ?? '').trim().split('\n')[0].slice(0, 120), err: s.error?.message ?? null }
        leases.set(k, r)
      }
      if (r.status === 0) continue
      if (r.status === 3) out.push({ desk: 'departments', short: `sweeps lease held elsewhere (${r.first || 'another machine'})`, say: `this machine says "sweeps": true, but ${d.id}'s sweeps lease is held by ${r.first || 'another machine'}: two machines would run the office-wide sweeps. Take "sweeps" off one of them` })
      else out.push({ desk: 'departments', short: `${d.id} sweeps lease UNKNOWN`, say: `${d.id} sweepsLease ${r.err ? `failed (${r.err})` : `exited ${r.status}`}: whether this machine holds the sweeps lease is UNKNOWN` })
    }
  }
  return out
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
  // --heal also makes sure the unattended watchdog is there when office.json asks for one
  const wd = args.includes('--heal') ? ensureWatchdog(root) : null
  const h = officeHealth(root)
  if (wd && wd.action !== 'not wanted' && wd.action !== 'ok') console.log(`watchdog: ${wd.action}${wd.label ? ' ' + wd.label : ''}${wd.why ? ' — ' + wd.why : ''}`)
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
