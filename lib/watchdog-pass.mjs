// ONE WATCHDOG PASS (0.20.2): what the LaunchAgent's shim runs every 120 s,
// from the newest installed plugin.
//
//   node lib/watchdog-pass.mjs <office root> <log file>
//
// ⛔ THE SHIM KNOWS NOTHING, SO IT CANNOT GO STALE. The shim used to decide by
// itself whether the office was there: `existsSync(join(root, 'desks'))`. A
// shim is written once, at --install-watchdog, and local-cabinets-ops' was
// written before desks could live in departments/. When its cleanup retired
// desks/ (2026-10-23), every pass logged "office not found" and exited: four
// hours with no restart, no bell kick, no limit resume and a scheduled job never
// handed, while the disk sat mounted. Every decision is here now, in the plugin,
// updated with it; the shim only finds the install and runs this file.
import { readFileSync, writeFileSync, existsSync, statSync, renameSync, appendFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { hasDesks } from './desk.mjs'
import { isMain } from './is-main.mjs'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// is there an office at root: its office.json, or a folder that holds desks
export const officeThere = (root) => existsSync(join(root, 'office.json')) || hasDesks(root)

// -> 'missing' | 'ran'
export function pass(root, log, { run = spawnSync, now = Date.now() } = {}) {
  const say = (s) => { try { appendFileSync(log, new Date(now).toISOString() + ' ' + s + '\n') } catch {} }
  try { if (statSync(log).size > 1 << 20) renameSync(log, log + '.1') } catch {}
  if (!officeThere(root)) {
    // the disk is not mounted, or the office moved: say so once an hour, not every run
    const mark = log + '.missing'
    let last = 0
    try { last = +readFileSync(mark, 'utf8') } catch {}
    if (now - last > 3600_000) { say(`office not found at ${root} (no office.json and no desk folder: disk not mounted, or moved); skipping`); try { writeFileSync(mark, String(now)) } catch {} }
    return 'missing'
  }
  const r = run(process.execPath, [join(PLUGIN_ROOT, 'lib', 'health.mjs'), root, '--heal'], { cwd: root, encoding: 'utf8' })
  try { appendFileSync(log, (r.stdout ?? '') + (r.stderr ?? '')) } catch {}
  return 'ran'
}

if (isMain(import.meta.url)) {
  const [root, log] = process.argv.slice(2)
  if (root && log) pass(resolve(root), log)
  process.exit(0)
}
