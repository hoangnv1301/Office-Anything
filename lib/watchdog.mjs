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
// missing the shim writes one line an hour saying so, and exits clean.
//
// Refused: an office in a temp folder or a git worktree. Both disappear, and a
// LaunchAgent outliving its office is the silent failure above.
import { mkdirSync, writeFileSync, rmSync, existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

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
  if (!existsSync(join(abs, 'desks'))) return 'no desks/ here: not an office'
  return null
}

const SHIM = (root, log) => `// written by office-anything --install-watchdog; runs health --heal on ${root}
import { readFileSync, writeFileSync, existsSync, statSync, renameSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { spawnSync } from 'node:child_process'
const root = ${JSON.stringify(root)}
const log = ${JSON.stringify(log)}
const say = (s) => appendFileSync(log, new Date().toISOString() + ' ' + s + '\\n')
try { if (statSync(log).size > 1 << 20) renameSync(log, log + '.1') } catch {}
if (!existsSync(join(root, 'desks'))) {
  // the disk is not mounted, or the office moved: say so once an hour, not every run
  const mark = log + '.missing'
  let last = 0
  try { last = +readFileSync(mark, 'utf8') } catch {}
  if (Date.now() - last > 3600_000) { say('office not found at ' + root + ' (disk not mounted, or moved); skipping'); writeFileSync(mark, String(Date.now())) }
  process.exit(0)
}
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
if (!install) { say('office-anything is not installed; nothing to run'); process.exit(0) }
const r = spawnSync(process.execPath, [join(install, 'lib', 'health.mjs'), root, '--heal'], { cwd: root, encoding: 'utf8' })
appendFileSync(log, (r.stdout ?? '') + (r.stderr ?? ''))
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

export function uninstallWatchdog(root, { home = homedir(), launchctl = realLaunchctl, uid = process.getuid() } = {}) {
  const p = pathsFor(resolve(root), home)
  launchctl(['bootout', `gui/${uid}/${p.label}`])
  const had = existsSync(p.plist)
  rmSync(p.plist, { force: true })
  rmSync(p.shim, { force: true })
  return { ok: true, label: p.label, removed: had }
}
