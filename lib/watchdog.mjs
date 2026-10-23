// THE WATCHDOG: a LaunchAgent that runs `health --heal` on one office every
// 120 seconds. Nothing is installed until the owner runs --install-watchdog.
//
// ⛔ THE PLUGIN'S PATH CHANGES WITH EVERY VERSION. Installs live in
// ~/.claude/plugins/cache/<name>/<version>/, so a plist pointing there runs a
// stale copy, or nothing, after the first update. The plist runs a shim, and
// each run the shim asks installed_plugins.json where the plugin lives now.
//
// ⛔ LAUNCHD IS NOT YOUR SHELL. It starts with a bare PATH, so `node`, the
// office's start command and anything it calls exit 127. The plist carries the
// PATH of whoever installed it, runs node through /usr/bin/env rather than a
// baked binary path that a node upgrade removes, and is ProcessType Standard.
//
// ⛔ THE OFFICE MAY BE ON A DISK THAT IS NOT THERE. A plist whose log and
// working directory live on an unmounted external disk fails every 120 s and
// says nothing. The shim and its log live on the home disk; when the office is
// missing the pass (lib/watchdog-pass.mjs) writes one line an hour saying so,
// and exits clean.
//
// Refused: an office in a temp folder or a git worktree. Both disappear, and a
// LaunchAgent outliving its office is the silent failure above.
import { mkdirSync, writeFileSync, rmSync, existsSync, statSync, readFileSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readOfficeConfig } from './office.mjs'
import { hasDesks } from './desk.mjs'

const INTERVAL = 120
const DEFAULT_PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'

// one watchdog per office: the label carries the repo's folder name and a hash of its path
export const labelFor = (root) => {
  const abs = resolve(root)
  const base = abs.split('/').pop().replace(/[^A-Za-z0-9-]/g, '-').slice(0, 40) || 'office'
  return `com.office-anything.health.${base}.${createHash('sha256').update(abs).digest('hex').slice(0, 8)}`
}

export const pathsFor = (root, home = homedir()) => {
  const label = labelFor(root)
  return {
    label,
    plist: join(home, 'Library', 'LaunchAgents', label + '.plist'),
    shim: join(home, 'Library', 'Application Support', 'office-anything', 'watchdog', label + '.mjs'),
    log: join(home, 'Library', 'Logs', 'office-anything', label + '.log'),
  }
}

export function refusal(root) {
  const abs = resolve(root)
  try { if (statSync(join(abs, '.git')).isFile()) return 'the office is a git worktree, which disappears; install it on the main checkout' } catch {}
  if (/^\/(private\/)?(tmp|var\/folders)\//.test(abs + '/')) return 'the office is in a temp folder, which disappears'
  if (!hasDesks(abs)) return 'no desks/ here: not an office'
  return null
}

const SHIM = (root, log) => `// written by office-anything --install-watchdog; runs one watchdog pass on ${root}
// It only finds the newest install and runs its lib/watchdog-pass.mjs: every
// decision lives in the plugin, so an update reaches it (lib/watchdog.mjs refreshShim).
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { spawnSync } from 'node:child_process'
const root = ${JSON.stringify(root)}
const log = ${JSON.stringify(log)}
// once an hour, not every 120 s
const sayHourly = (s) => { const mark = log + '.missing'; let last = 0; try { last = +readFileSync(mark, 'utf8') } catch {} if (Date.now() - last > 3600_000) { try { appendFileSync(log, new Date().toISOString() + ' ' + s + '\\n'); writeFileSync(mark, String(Date.now())) } catch {} } }
// the one test a shim makes, which no layout change can make stale: the folder itself
if (!existsSync(root)) { sayHourly('office not found at ' + root + ' (disk not mounted, or moved); skipping'); process.exit(0) }
// the install that exists now, newest first: an entry can point at a cache
// folder a cleanup removed, and [0] is not guaranteed to be the live one
let install = null
try {
  const config = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  const j = JSON.parse(readFileSync(join(config, 'plugins', 'installed_plugins.json'), 'utf8'))
  const entries = Object.entries(j.plugins ?? {}).filter(([k]) => k.startsWith('office-anything@')).flatMap(([, v]) => Array.isArray(v) ? v : [])
  install = entries.filter((e) => typeof e?.installPath === 'string' && existsSync(join(e.installPath, 'lib', 'health.mjs')))
    .sort((a, b) => String(b.lastUpdated ?? '').localeCompare(String(a.lastUpdated ?? '')))[0]?.installPath ?? null
} catch {}
if (!install) { sayHourly('office-anything is not installed; nothing to run'); process.exit(0) }
const passFile = join(install, 'lib', 'watchdog-pass.mjs')
if (existsSync(passFile)) spawnSync(process.execPath, [passFile, root, log], { cwd: homedir(), stdio: 'ignore' })
else {
  // an install older than 0.20.2: its health, after the same office test
  if (!['office.json', 'desks', 'departments'].some((f) => existsSync(join(root, f)))) process.exit(0)
  const r = spawnSync(process.execPath, [join(install, 'lib', 'health.mjs'), root, '--heal'], { cwd: root, encoding: 'utf8' })
  try { appendFileSync(log, (r.stdout ?? '') + (r.stderr ?? '')) } catch {}
}
process.exit(0)
`

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const PLIST = ({ label, shim, log }, home, path, config) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array><string>/usr/bin/env</string><string>node</string><string>${xml(shim)}</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${xml(path)}</string><key>HOME</key><string>${xml(home)}</string>${config ? `<key>CLAUDE_CONFIG_DIR</key><string>${xml(config)}</string>` : ''}</dict>
  <key>WorkingDirectory</key><string>${xml(home)}</string>
  <key>ProcessType</key><string>Standard</string>
  <key>StartInterval</key>
  <integer>${INTERVAL}</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`

const realLaunchctl = (args) => spawnSync('launchctl', args, { encoding: 'utf8' })

export function installWatchdog(root, { home = homedir(), launchctl = realLaunchctl, uid = process.getuid(), path = process.env.PATH, allowTempRoot = false } = {}) {
  const abs = resolve(root)
  const why = refusal(abs)
  if (why && !(allowTempRoot && /temp folder/.test(why))) return { ok: false, why: 'refused: ' + why }
  const p = pathsFor(abs, home)
  for (const f of [p.plist, p.shim, p.log]) mkdirSync(resolve(f, '..'), { recursive: true })
  writeFileSync(p.shim, SHIM(abs, p.log))
  const merged = [...new Set([...(path ?? '').split(':'), ...DEFAULT_PATH.split(':')].filter(Boolean))].join(':')
  writeFileSync(p.plist, PLIST(p, home, merged, process.env.CLAUDE_CONFIG_DIR))
  launchctl(['bootout', `gui/${uid}/${p.label}`])          // a reinstall replaces, never doubles
  const r = launchctl(['bootstrap', `gui/${uid}`, p.plist])
  if (r.status !== 0) return { ok: false, ...p, why: 'launchctl bootstrap failed: ' + String(r.stderr ?? '').trim() }
  return { ok: true, ...p }
}

// ⛔ AN INSTALLED SHIM IS REWRITTEN WHEN IT IS NOT THE ONE THIS VERSION WRITES
// (0.20.2). Nothing ever rewrote one: local-cabinets-ops ran a shim from before
// desks could leave desks/, and it skipped the office for four hours once
// desks/ was retired. Only the shim file is written; launchd is not touched
// (the plist runs `node <shim>` every pass, so the next pass is the new one).
// Asked by every session start (hooks/desk-boot.mjs), health and ensureWatchdog.
// -> 'none' (no watchdog here) | 'current' | 'rewritten' | 'failed'
export function refreshShim(root, { home = homedir() } = {}) {
  const abs = resolve(root)
  const p = pathsFor(abs, home)
  if (!existsSync(p.shim) || !existsSync(p.plist)) return 'none'
  const want = SHIM(abs, p.log)
  try { if (readFileSync(p.shim, 'utf8') === want) return 'current' } catch {}
  try { const tmp = p.shim + '.' + process.pid + '.tmp'; writeFileSync(tmp, want); renameSync(tmp, p.shim); return 'rewritten' } catch { return 'failed' }
}

export function uninstallWatchdog(root, { home = homedir(), launchctl = realLaunchctl, uid = process.getuid() } = {}) {
  const p = pathsFor(resolve(root), home)
  launchctl(['bootout', `gui/${uid}/${p.label}`])
  const had = existsSync(p.plist)
  rmSync(p.plist, { force: true })
  rmSync(p.shim, { force: true })
  return { ok: true, label: p.label, removed: had }
}

// ⛔ THE PLUGIN INSTALLS AND CHECKS ITS OWN WATCHDOG (lead's request, 2026-10-18).
// office.json "watchdog": true (or watchdog.install: true) says this office wants
// one. The older object form ({ maxHealsPerHour, notify }) only tunes a watchdog
// somebody installed and never installs one by itself.
export const watchdogWanted = (cfg) => cfg?.watchdog === true || cfg?.watchdog?.install === true

// -> { state: 'loaded' | 'not loaded' | 'missing' | 'unsupported', ...paths }
export function watchdogStatus(root, { home = homedir(), launchctl = realLaunchctl, uid = process.getuid?.() ?? 0, platform = process.platform } = {}) {
  if (platform !== 'darwin') return { state: 'unsupported', why: 'the watchdog is a macOS LaunchAgent, and this is ' + platform }
  const p = pathsFor(resolve(root), home)
  if (!existsSync(p.plist) || !existsSync(p.shim)) return { state: 'missing', ...p }
  return { state: launchctl(['print', `gui/${uid}/${p.label}`]).status === 0 ? 'loaded' : 'not loaded', ...p }
}

// idempotent: installed and loaded is left alone; anything else is installed.
// -> { action: 'not wanted' | 'ok' | 'installed' | 'failed' | 'unsupported', why? }
export function ensureWatchdog(root, opts = {}) {
  const { wanted = watchdogWanted(readOfficeConfig(root)), ...rest } = opts
  if (!wanted) return { action: 'not wanted' }
  const st = watchdogStatus(root, rest)
  if (st.state === 'unsupported') return { action: 'unsupported', why: st.why }
  if (st.state === 'loaded') { const f = refreshShim(root, rest); return { action: f === 'rewritten' ? 'refreshed' : 'ok', label: st.label } }
  const r = installWatchdog(root, rest)
  return r.ok ? { action: 'installed', label: r.label } : { action: 'failed', why: r.why }
}
