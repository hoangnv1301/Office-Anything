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
// still counts against the cap. A desk restarted in the last 5 minutes is left
// to register rather than started a second time.
//
// Caps (office.json watchdog): maxHealsPerHour per desk or check (default 3),
// one alert per subject per 15 minutes. Every act is a JSON line in heal.log;
// heal.log and alerts.log rotate at 512 KB, one generation kept.
import { fileURLToPath } from 'node:url'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, statSync, renameSync, unlinkSync, existsSync, utimesSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { readOfficeConfig } from './office.mjs'
import { rosterSafe } from './desk.mjs'
import { processTable, liveSessions, isOrphan, cwdOf } from './procs.mjs'

const HOUR = 3600_000
const QUIET = 15 * 60_000
const SETTLE = 5 * 60_000
const LOG_MAX = 512 * 1024

const appendCapped = (path, text) => {
  try { if (statSync(path).size > LOG_MAX) renameSync(path, path + '.1') } catch {}
  appendFileSync(path, text)
}

// ⛔ ONE HEAL AT A TIME. The lock is <dir>/heal.lock holding "<pid> <uuid>".
//   held      its pid is alive AND it was touched within HELD_FOR. A heal
//             touches it after every act, and one act is at most 180 s, so a
//             live heal is never older than that; a pid that answers but has
//             not touched the lock for twice that is a REUSED pid (pid 1
//             answers every signal test), not a heal.
//   taken over otherwise, and only by the one contender that creates
//             heal.lock.takeover ('wx'); it re-checks the lock is still the
//             dead one it judged, removes it and creates its own with 'wx'.
//             (Moving the lock aside instead was raced: a mover could shift a
//             lock a winner had just created, and a third process slipped in.)
// Reproduced before this: six contenders over a lock left by a crashed pid,
// 16 of 20 trials with two to five holders.
const HELD_FOR = 2 * 180_000 + 30_000
export function acquireLock(dir) {
  const lock = join(dir, 'heal.lock')
  const mine = `${process.pid} ${randomUUID()}\n`
  const result = (note) => ({
    ok: true, note,
    touch: () => { try { const t = new Date(); utimesSync(lock, t, t) } catch {} },
    release: () => { try { if (readFileSync(lock, 'utf8') === mine) unlinkSync(lock) } catch {} },
  })
  const create = () => { try { writeFileSync(lock, mine, { flag: 'wx' }); return true } catch { return false } }
  if (create()) return result()
  let seen, age
  try { seen = readFileSync(lock, 'utf8'); age = Date.now() - statSync(lock).mtimeMs } catch { return create() ? result() : { ok: false, why: 'another heal is running (it just took the lock)' } }
  const pid = +seen.split(/\s/)[0] || 0
  let alive = false
  if (pid) { try { process.kill(pid, 0); alive = true } catch (e) { alive = e.code === 'EPERM' } }
  if (alive && age < HELD_FOR) return { ok: false, why: `another heal is running (pid ${pid}, lock touched ${Math.round(age / 1000)}s ago)` }
  // the takeover itself is serialised: whoever creates heal.lock.takeover
  // first ('wx': exactly one can) re-checks the lock is still the dead one it
  // judged, removes it and creates its own. Nobody ever moves a lock that
  // might be live, so no window opens in which a second holder appears.
  const guard = lock + '.takeover'
  try { writeFileSync(guard, mine, { flag: 'wx' }) } catch {
    // a takeover that crashed mid-way leaves its guard; clear it for next time
    try { if (Date.now() - statSync(guard).mtimeMs > 30_000) unlinkSync(guard) } catch {}
    return { ok: false, why: 'another heal is taking over the stale lock' }
  }
  try {
    let still = null
    try { still = readFileSync(lock, 'utf8') } catch {}
    if (still !== seen) return { ok: false, why: 'another heal is running (the lock changed as we looked)' }
    unlinkSync(lock)
    if (!create()) return { ok: false, why: 'another heal is running (it took the lock first)' }
    return result(`took over a stale lock (pid ${pid || '?'} ${alive ? 'answers but has not touched it' : 'is gone'}, ${Math.round(age / 1000)}s old)`)
  } finally { try { if (readFileSync(guard, 'utf8') === mine) unlinkSync(guard) } catch {} }
}

// office.json "start": a command with {desk} filled in, or "office:start" for
// the plugin's own start (lib/start.mjs: resumes the desk's own conversation,
// never opens a second session), so an office keeps no versioned plugin path
const q = (x) => `'${String(x).replace(/'/g, `'\\''`)}'`
export function startCommandFor(root, start, desk) {
  if (start === 'office:start') return `node ${q(fileURLToPath(new URL('./start.mjs', import.meta.url)))} ${q(root)} ${q(desk)}`
  return start.replaceAll('{desk}', desk)
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

  const lk = acquireLock(dir)
  if (!lk.ok) return { acts: [], skipped: lk.why }
  const touch = lk.touch


  try {
    // ⛔ STATE IS RE-READ BEFORE EVERY SPEND. Another run (the watchdog, or a
    // person) may have healed since this one started; a budget held in memory
    // undercounts the cap.
    const statePath = join(dir, 'heal-state.json')
    const load = () => { try { return { heals: {}, notified: {}, restarted: {}, ...JSON.parse(readFileSync(statePath, 'utf8')) } } catch { return { heals: {}, notified: {}, restarted: {} } } }
    const save = (st) => writeFileSync(statePath, JSON.stringify(st))
    const acts = []
    const stamp = new Date(now).toISOString()
    const act = (a) => { acts.push(a); appendCapped(join(dir, 'heal.log'), JSON.stringify({ at: stamp, ...a }) + '\n'); touch() }
    const alert = (subject, text) => {
      const st = load()
      if (now - (st.notified[subject] ?? 0) < QUIET) return
      st.notified[subject] = now
      save(st)
      appendCapped(join(dir, 'alerts.log'), `${stamp} → ${to}: ${text}\n`)
      acts.push({ act: 'notify', subject, ok: true })
    }
    const budget = (key) => (load().heals[key] ?? []).filter((t) => now - t < HOUR).length < cap
    const spend = (key) => { const st = load(); st.heals[key] = [...(st.heals[key] ?? []).filter((t) => now - t < HOUR), now]; save(st) }
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
        } else if (now - (load().restarted[d.name] ?? 0) < SETTLE) {
          // start returns before the new session registers: a second start now
          // would open a second desk
          act({ act: 'restart', desk: d.name, ok: false, why: `restarted ${Math.round((now - load().restarted[d.name]) / 1000)}s ago; waiting for it to register` })
        } else if (!budget(key)) {
          act({ act: 'restart', desk: d.name, ok: false, why: `cap: ${cap} heals in the last hour` })
          alert(key, `desk-${d.name} is still not running after ${cap} restarts in the last hour; healing stopped, it needs a person`)
        } else {
          spend(key)
          const t0 = Date.now()
          const r = sh(startCommandFor(root, cfg.start, d.name))
          // stamped once start has actually run, with the time it finished
          if (!r.error) { const st = load(); st.restarted[d.name] = now + (Date.now() - t0); save(st) }
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

    return lk.note ? { acts, note: lk.note } : { acts }
  } finally { lk.release() }
}
