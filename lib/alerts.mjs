// A TYPED ALERT LINE, for whoever watches the office's alert log (the lead's
// Monitor greps it by type):
//
//   <ISO time> <TYPE> <case or -> <subject> <text>
//
// office.json "alerts": { "file": "<path inside the office>" }; the default
// is .office/alerts.log. A file outside the office is refused and the default
// used: an alert never writes outside the office. A quiet key keeps one
// condition from writing a line on every session start.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync, renameSync } from 'node:fs'
import { join, resolve, dirname, sep } from 'node:path'

export function alertsFile(root, cfg) {
  const want = cfg?.alerts?.file
  if (typeof want === 'string' && want) {
    const f = resolve(root, want)
    if ((f + sep).startsWith(resolve(root) + sep)) return f
  }
  return join(root, '.office', 'alerts.log')
}

export const alertLine = ({ type, kase = '-', subject, text, now = Date.now() }) =>
  `${new Date(now).toISOString()} ${String(type).toUpperCase().replace(/\s+/g, '_')} ${kase || '-'} ${String(subject).replace(/\s+/g, '_')} ${String(text).replace(/[\r\n]+/g, ' ')}`

// -> true when a line was written, false when it was quiet
export function writeAlert(root, cfg, { type, kase, subject, text, quietKey = null, quietMs = 6 * 3600_000, now = Date.now() }) {
  const state = join(root, '.office', 'alerts-state.json')
  mkdirSync(join(root, '.office'), { recursive: true })
  if (!existsSync(join(root, '.office', '.gitignore'))) writeFileSync(join(root, '.office', '.gitignore'), '# office-anything state and logs; never committed\n*\n')
  let st = {}
  try { st = JSON.parse(readFileSync(state, 'utf8')) } catch {}
  if (quietKey && now - (st[quietKey] ?? 0) < quietMs) return false
  const f = alertsFile(root, cfg)
  mkdirSync(dirname(f), { recursive: true })
  try { if (statSync(f).size > 512 * 1024) renameSync(f, f + '.1') } catch {}
  appendFileSync(f, alertLine({ type, kase, subject, text, now }) + '\n')
  if (quietKey) { st[quietKey] = now; writeFileSync(state, JSON.stringify(st)) }
  return true
}
