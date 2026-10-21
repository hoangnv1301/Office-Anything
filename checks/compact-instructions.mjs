#!/usr/bin/env node
// ⛔ WILL COMPACTION KNOW WHAT TO KEEP? (0.14.0)
//
// An office that compacts its sessions (office.json "compact") should tell
// compaction what must survive. Documented: a "Compact Instructions" section in
// CLAUDE.md. A desk, or the lead's root CLAUDE.md, without one compacts on the
// model's own judgement, and an open buyer can be summarised away.
// The section comes from `node lib/compact.mjs instructions <desk|lead>`.
//
// Exit 0 clean, 4 finding.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { rosterSafe } from '../lib/desk.mjs'
import { readOfficeConfig } from '../lib/office.mjs'
import { hasInstructions, compactConfig } from '../lib/compact.mjs'
import { isMain } from '../lib/is-main.mjs'

const cfgOf = (root) => { try { return readOfficeConfig(root) } catch { return {} } }
export const applies = (root) => existsSync(join(root, 'desks')) && !!cfgOf(root).compact && typeof cfgOf(root).compact === 'object'

export function report(root = process.cwd()) {
  if (!applies(root)) return { code: 0, applicable: false, why: 'office.json does not compact its sessions ("compact")' }
  const cfg = cfgOf(root)
  const read = (f) => { try { return readFileSync(f, 'utf8') } catch { return '' } }
  const findings = []
  for (const d of rosterSafe(join(root, 'desks')).desks) {
    if (d.kind === 'lead' || !compactConfig(cfg, { desk: d })) continue
    if (!hasInstructions(read(join(root, 'desks', d.name, 'CLAUDE.md')))) findings.push({ desk: d.name, say: `CLAUDE.md has no "## Compact Instructions" section: paste node lib/compact.mjs instructions ${d.name}` })
  }
  if (compactConfig(cfg, { isLead: true }) && !hasInstructions(read(join(root, 'CLAUDE.md')))) findings.push({ desk: 'lead', say: 'the root CLAUDE.md has no "## Compact Instructions" section: paste node lib/compact.mjs instructions lead' })
  return findings.length
    ? { code: 4, applicable: true, why: `${findings.length} session(s) compact without instructions`, findings }
    : { code: 0, applicable: true, why: 'every compacted desk and the lead say what compaction keeps' }
}

if (isMain(import.meta.url)) {
  const r = report(process.argv[2] ?? process.cwd())
  console.log(r.why)
  for (const f of r.findings ?? []) console.log(`  ${f.desk}: ${f.say}`)
  process.exit(r.code)
}
