// WHICH PLUGIN VERSION IS LOADED, AND HAS THIS OFFICE APPROVED IT.
//
// office.json "plugin": { "approved": ["0.9.0", …], "enforce": false }
// Claude Code updates plugins in the background when a marketplace allows
// it, and an update changes the wall's rules in every NEW session. An office
// lists the versions it has approved; a session on any other one is told,
// and the lead gets a VERSION alert. Refusing desks on it is opt-in
// (enforce): a fail-closed default would stop every desk silently after an
// unplanned update, an outage worse than the drift.
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export function loadedVersion() {
  try { return String(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.claude-plugin', 'plugin.json'), 'utf8')).version) } catch { return null }
}

// -> null when the office names no approved list, else { ok, loaded, approved, enforce }
export function versionVerdict(cfg, loaded = loadedVersion()) {
  const p = cfg?.plugin
  if (!p || !Array.isArray(p.approved)) return null
  const approved = p.approved.map(String)
  return { ok: !!loaded && approved.includes(loaded), loaded, approved, enforce: p.enforce === true }
}
