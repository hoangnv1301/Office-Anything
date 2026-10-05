// THE WATCHDOG: a LaunchAgent that runs `health --heal` on one office every
// 120 seconds. Nothing is installed until the owner runs --install-watchdog.
//
// ⛔ THE PLUGIN'S PATH CHANGES WITH EVERY VERSION. Installs live in
// ~/.claude/plugins/cache/<name>/<version>/, so a plist pointing there runs a
// stale copy, or nothing, after the first update. The plist points at a shim
// in the office's own .office/ folder; each run, the shim asks
// installed_plugins.json where the plugin lives now.
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const INTERVAL = 120

// one watchdog per office: the label carries the repo's folder name and a hash of its path
export const labelFor = (root) => {
  const abs = resolve(root)
  const base = abs.split('/').pop().replace(/[^A-Za-z0-9-]/g, '-').slice(0, 40) || 'office'
  return `com.office-anything.health.${base}.${createHash('sha256').update(abs).digest('hex').slice(0, 8)}`
}

const SHIM = (root) => `// written by office-anything --install-watchdog; runs health --heal on ${root}
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { spawnSync } from 'node:child_process'
const root = ${JSON.stringify(root)}
let install = null
try {
  const j = JSON.parse(readFileSync(join(homedir(), '.claude', 'plugins', 'installed_plugins.json'), 'utf8'))
  const key = Object.keys(j.plugins ?? {}).find((k) => k.startsWith('office-anything@'))
  install = key ? j.plugins[key]?.[0]?.installPath : null
} catch {}
if (!install) { console.error(new Date().toISOString() + ' office-anything is not installed; nothing to run'); process.exit(0) }
const r = spawnSync(process.execPath, [join(install, 'lib', 'health.mjs'), root, '--heal'], { stdio: 'inherit' })
process.exit(r.status === null ? 1 : 0)
`

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const PLIST = (label, root, shim, node) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(node)}</string><string>${xml(shim)}</string></array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
  <key>StartInterval</key>
  <integer>${INTERVAL}</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${xml(join(root, '.office', 'watchdog.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(join(root, '.office', 'watchdog.log'))}</string>
</dict>
</plist>
`

const realLaunchctl = (args) => spawnSync('launchctl', args, { encoding: 'utf8' })

export function installWatchdog(root, { home = homedir(), launchctl = realLaunchctl, uid = process.getuid(), node = process.execPath } = {}) {
  const abs = resolve(root)
  const label = labelFor(abs)
  mkdirSync(join(abs, '.office'), { recursive: true })
  const shim = join(abs, '.office', 'watchdog.mjs')
  writeFileSync(shim, SHIM(abs))
  const dir = join(home, 'Library', 'LaunchAgents')
  mkdirSync(dir, { recursive: true })
  const plist = join(dir, label + '.plist')
  writeFileSync(plist, PLIST(label, abs, shim, node))
  launchctl(['bootout', `gui/${uid}/${label}`])          // a reinstall replaces, never doubles
  const r = launchctl(['bootstrap', `gui/${uid}`, plist])
  if (r.status !== 0) return { ok: false, label, plist, why: 'launchctl bootstrap failed: ' + String(r.stderr ?? '').trim() }
  return { ok: true, label, plist, shim }
}

export function uninstallWatchdog(root, { home = homedir(), launchctl = realLaunchctl, uid = process.getuid() } = {}) {
  const label = labelFor(root)
  const plist = join(home, 'Library', 'LaunchAgents', label + '.plist')
  launchctl(['bootout', `gui/${uid}/${label}`])
  const had = existsSync(plist)
  rmSync(plist, { force: true })
  return { ok: true, label, removed: had }
}
