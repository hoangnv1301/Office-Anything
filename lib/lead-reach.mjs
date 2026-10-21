// CAN THE DESKS REACH THE LEAD BY NAME?
//
// SendMessage resolves a name through the CLI's session registry
// (~/.claude/sessions/<pid>.json). Two ways it fails while the lead is alive
// and its own sends still work:
//   - the lead runs under a name office.json does not give it (lead.session /
//     lead.aliases), so desks address a name nobody has;
//   - the lead's registry entry stopped updating (seen 2026-10-13: "busy"
//     frozen for three days while the session kept working). Other sessions
//     stop listing it, and "No agent named … is reachable" is all a desk sees.
//   - the lead's registry entry is not valid JSON (seen 2026-10-16: a stray
//     "}" after the object), so Claude Code skips it altogether.
// All are fixed by restarting the lead under its office name, resuming its
// own conversation. The line says exactly what to run.
//
// ⛔ READS ONLY. The registry belongs to Claude Code: an entry is never
// edited or deleted here, and nothing is typed into the lead.
import { statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { launchCommand, duplicateAdvice } from './start.mjs'

const slugOf = (d) => String(d).replace(/[^A-Za-z0-9]/g, '-')
const MIN = 60_000

// -> [{ type: 'LEAD-UNREACHABLE', key, line }]   (empty: reachable, or no lead declared)
export function leadReach(root, cfg, { sessions, unreadable = [], configDir, now = Date.now(), frozenMinutes = 30, others = [] } = {}) {
  const name = typeof cfg?.lead?.session === 'string' && cfg.lead.session ? cfg.lead.session : null
  if (!name) return []
  const names = [name, ...(Array.isArray(cfg.lead.aliases) ? cfg.lead.aliases.filter((a) => typeof a === 'string' && a) : [])]
  const at = (s) => s.cwd && resolve(s.cwd) === resolve(root)
  const cmd = (resume) => {
    try { return launchCommand({ cfg, target: { name: 'lead', tag: name, isLead: true, dir: root, model: null }, resume }) } catch (e) { return `(no launch command: ${e.message})` }
  }
  const problem = (cause, line, type = 'LEAD-UNREACHABLE') => [{ type, key: `${type}:${cause}`, line }]
  // an entry Claude Code cannot parse: the lead is alive and invisible to every peer
  const bad = unreadable.find((u) => u.entry && (names.includes(u.entry.name) || at(u.entry)))
  if (bad) return problem('unreadable', `lead: its registry entry ${bad.file} is not valid JSON (${bad.why}), so Claude Code cannot read it and no other session lists the lead (pid ${bad.pid}, named "${bad.entry.name ?? ''}"). Close it (/exit) and run: ${cmd(bad.entry.sessionId ?? null)}`)
  const leads = sessions.filter((s) => names.includes(s.name)).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  const lead = leads[0]
  // ⛔ TWO LEADS IS NOT ONE LEAD WITH A SPARE (10-18): desks message one name and
  // the other session hears nothing. Say which is working (the newest) and which to close
  if (leads.length > 1) return problem('duplicate', `lead: ${leads.length} live sessions answer to the lead's names (${leads.map((s) => `pid ${s.pid} "${s.name}"`).join(', ')}): ${duplicateAdvice(leads)}. Nothing is opened or closed from here.`, 'LEAD-DUPLICATE')
  if (!lead) {
    // another department's lead at the root (others) is not this lead misnamed
    const other = sessions.filter((s) => at(s) && !others.includes(s.name)).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]
    if (other) return problem('name', `lead: the session at the office root runs as "${other.name || '(no name)'}" (pid ${other.pid}), but office.json names the lead ${names.map((n) => `"${n}"`).join(' or ')}: desks that message ${name} reach nobody. Close it (/exit) and run: ${cmd(other.sessionId)}`)
    return problem('none', `lead: no live session is named ${names.map((n) => `"${n}"`).join(' or ')}: desks that message ${name} reach nobody. Run: ${cmd(null)}`)
  }
  // frozen: the conversation moves on while the registry entry does not
  let wrote = null
  try { wrote = statSync(join(configDir, 'projects', slugOf(lead.cwd ?? root), `${lead.sessionId}.jsonl`)).mtimeMs } catch {}
  const upd = Number(lead.updatedAt ?? lead.statusUpdatedAt ?? 0)
  if (wrote && upd && wrote - upd > frozenMinutes * MIN && now - wrote < 60 * MIN) {
    return problem('frozen', `lead: its registry entry stopped updating at ${new Date(upd).toISOString()} (pid ${lead.pid} alive, last active ${Math.round((now - wrote) / MIN)} min ago): other sessions no longer list it, so desks cannot message ${lead.name} by name. Close it (/exit) and run: ${cmd(lead.sessionId)}`)
  }
  return []
}
