// HEAL. The only module here that acts, and only within the powers the lead
// granted on 2026-10-05:
//
//   kill-orphan  a doorbell process with no live session anywhere above it,
//                re-proven on a FRESH process table the moment before the kill
//   restart      a dead desk, through office.json `start` ({desk} filled in)
//   check-heal   a failing office.json `health` check's own `heal` command
//   notify       a line in <root>/.office/alerts.log for the notify session
//
// ⛔ NOTHING IS TYPED INTO A DESK. An unarmed doorbell is reported, never
// re-armed from here: a desk running with permissions bypassed holds outside
// messages by design, and typing at its terminal impersonates its human. The
// lead re-arms it with SendMessage, session to session.
//
// ⛔ NOTIFY IS A FILE, NOT A MESSAGE. A script is not a session and has no
// permission mode to declare; a bypass lead would hold every alert for the
// owner to approve, every fifteen minutes. The lead watches alerts.log with
// its own Monitor instead, which is never held.
//
// ⛔ THE SNAPSHOT IS NOT THE PROOF. The health report is seconds old by the
// time a kill happens, and a pid can be reused in that window. Each kill
// re-reads the process table and the session registry and requires the same
// command, the same parent, an age no younger, and the orphan rule again.
//
// ⛔ ONE HEAL AT A TIME, AND THE BUDGET IS SPENT BEFORE THE ACT. A lock file in
// .office/ keeps two runs (the watchdog and a person) from both restarting a
// desk; state is written the moment a heal is spent, so a crash mid-restart
// still counts against the cap.
//
// Caps (office.json watchdog): maxHealsPerHour per desk or check (default 3),
// one alert per subject per 15 minutes. Every act is a JSON line in heal.log;
// heal.log and alerts.log rotate at 512 KB, one generation kept.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, statSync, renameSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { readOfficeConfig } from './office.mjs'
import { rosterSafe } from './desk.mjs'
import { processTable, liveSessions, isOrphan, cwdOf } from './health.mjs'

const HOUR = 3600_000
const QUIET = 15 * 60_000
const LOCK_STALE = 10 * 60_000
const LOG_MAX = 512 * 1024

const appendCapped = (path, text) => {
  try { if (statSync(path).size > LOG_MAX) renameSync(path, path + '.1') } catch {}
  appendFileSync(path, text)
}

export function heal(root, h, {
  now = Date.now(), kill = (pid) => process.kill(pid, 'SIGTERM'),
  freshProcs = () => processTable(), cwd = cwdOf, home = homedir(),
} = {}) {
  const cfg = readOfficeConfig(root)
  const cap = Number.isInteger(cfg.watchdog?.maxHealsPerHour) ? cfg.watchdog.maxHealsPerHour : 3
  const to = typeof cfg.watchdog?.notify === 'string' ? cfg.watchdog.notify : 'lead'
  const dir = join(root, '.office')
  mkdirSync(dir, { recursive: true })
  if (!existsSync(join(dir, '.gitignore'))) writeFileSync(join(dir, '.gitignore'), '# office-anything health state and logs; never committed\n*\n')

  const lock = join(dir, 'heal.lock')
  const take = () => { try { writeFileSync(lock, `${process.pid} ${now}\n`, { flag: 'wx' }); return true } catch { return false } }
  if (!take()) {
    let stale = false
    try { stale = Date.now() - statSync(lock).mtimeMs > LOCK_STALE } catch {}
    if (!(stale && (unlinkSync(lock), take()))) return { acts: [], skipped: 'another heal is running' }
  }
  try {
    const statePath = join(dir, 'heal-state.json')
    let state = { heals: {}, notified: {} }
    try { state = { heals: {}, notified: {}, ...JSON.parse(readFileSync(statePath, 'utf8')) } } catch {}
    const save = () => writeFileSync(statePath, JSON.stringify(state))
    const acts = []
    const stamp = new Date(now).toISOString()
    const act = (a) => { acts.push(a); appendCapped(join(dir, 'heal.log'), JSON.stringify({ at: stamp, ...a }) + '\n') }
    const alert = (subject, text) => {
      if (now - (state.notified[subject] ?? 0) < QUIET) return
      state.notified[subject] = now
      save()
      appendCapped(join(dir, 'alerts.log'), `${stamp} → ${to}: ${text}\n`)
      acts.push({ act: 'notify', subject, ok: true })
    }
    const budget = (key) => {
      state.heals[key] = (state.heals[key] ?? []).filter((t) => now - t < HOUR)
      return state.heals[key].length < cap
    }
    const spend = (key) => { (state.heals[key] ??= []).push(now); save() }
    const sh = (cmd) => spawnSync('/bin/sh', ['-c', cmd], { cwd: root, encoding: 'utf8', timeout: 180_000 })

    const desks = new Map(rosterSafe(join(root, 'desks')).desks.map((d) => [d.name, d]))
    for (const o of h.orphans ?? []) {
      const no = (why) => act({ act: 'kill-orphan', desk: o.desk, pid: o.pid, ok: false, why })
      if (o.proven === false) { no('unproven: ' + (o.why ?? 'not shown to be this office\'s')); continue }
      const procs = freshProcs()
      const p = procs.get(o.pid)
      if (!p) { no('already gone'); continue }
      if (p.cmd !== o.cmd || p.ppid !== o.ppid) { no('pid now runs something else, or under someone else'); continue }
      if (p.ageSec < o.ageSec) { no('younger than the process that was reported: the pid was reused'); continue }
      const live = new Set(liveSessions(home, procs, Date.now()).map((s) => s.pid))
      const d = desks.get(o.desk)
      if (!d || !isOrphan(p, d, procs, live, root, cwd)) { no('not an orphan on a fresh look'); continue }
      try { kill(o.pid); act({ act: 'kill-orphan', desk: o.desk, pid: o.pid, ageSec: p.ageSec, ok: true }) }
      catch (e) { no(e.code ?? e.message) }
    }

    for (const d of h.desks ?? []) {
      if (d.session?.state === 'dead') {
        const key = 'desk:' + d.name
        if (typeof cfg.start !== 'string' || !cfg.start) {
          act({ act: 'restart', desk: d.name, ok: false, why: 'no start declared in office.json' })
          alert(key, `desk-${d.name} is not running, and office.json declares no start command to restart it`)
        } else if (!budget(key)) {
          act({ act: 'restart', desk: d.name, ok: false, why: `cap: ${cap} heals in the last hour` })
          alert(key, `desk-${d.name} is still not running after ${cap} restarts in the last hour; healing stopped, it needs a person`)
        } else {
          spend(key)
          const r = sh(cfg.start.replaceAll('{desk}', d.name))
          const ok = !r.error && r.status === 0
          act({ act: 'restart', desk: d.name, ok, why: ok ? '' : (r.error?.message ?? 'exit ' + r.status) })
          if (!ok) alert(key, `desk-${d.name} is not running and its restart failed (${r.error?.message ?? 'exit ' + r.status})`)
        }
      }
      if (d.doorbell?.state === 'unarmed') {
        const m = d.doorbell.sinceStartSec != null ? Math.round(d.doorbell.sinceStartSec / 60) + 'm after start' : 'since start'
        alert('bell:' + d.name, `desk-${d.name} doorbell unarmed (${m}): it is not hearing its wake-ups. Re-arm it: SendMessage desk-${d.name} "start your doorbell Monitor now (timeout_ms 1800000) and re-arm it on every expiry"`)
      }
    }

    for (const c of h.checks ?? []) {
      if (c.ok) continue
      const key = 'check:' + c.name
      if (!c.heal) { alert(key, `check ${c.name} failed (${c.why}); no heal declared`); continue }
      if (!budget(key)) { act({ act: 'check-heal', name: c.name, ok: false, why: `cap: ${cap} heals in the last hour` }); alert(key, `check ${c.name} still failing after ${cap} heals in the last hour; it needs a person`); continue }
      spend(key)
      const r = sh(c.heal)
      const ok = !r.error && r.status === 0
      act({ act: 'check-heal', name: c.name, ok, why: ok ? '' : (r.error?.message ?? 'exit ' + r.status) })
      if (!ok) alert(key, `check ${c.name} failed (${c.why}) and its heal failed too`)
    }

    save()
    return { acts }
  } finally { try { unlinkSync(lock) } catch {} }
}
