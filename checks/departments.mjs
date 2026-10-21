#!/usr/bin/env node
// ⛔ DOES THE OFFICE'S DEPARTMENTS BLOCK SAY ONE THING? (0.12.0)
//
// office.json "departments" decides which lead a desk reports to and which
// machine runs it (lib/departments.mjs). A desk in two departments, a lead name
// two departments answer to, or a department naming a desk that does not exist
// is a block that means two things, so each is a finding.
// A desk in no department is not: it is everyone's, and said once in the why.
// What THIS machine runs (local.json, the buyer services, the sweeps lease) is
// health's question, not this one's: a check reads the repo, not the machine.
//
// Exit 0 clean, 4 finding.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { rosterSafe } from '../lib/desk.mjs'
import { readOfficeConfig } from '../lib/office.mjs'
import { departmentsOf } from '../lib/departments.mjs'
import { isMain } from '../lib/is-main.mjs'

const cfgOf = (root) => { try { return readOfficeConfig(root) } catch { return {} } }
export const applies = (root) => existsSync(join(root, 'office.json')) && cfgOf(root).departments != null

export function report(root = process.cwd()) {
  if (!applies(root)) return { code: 0, applicable: false, why: 'office.json declares no departments' }
  const D = departmentsOf(cfgOf(root))
  const desks = rosterSafe(join(root, 'desks')).desks
  const ids = new Set(desks.map((d) => d.name))
  const findings = D.problems.map((say) => ({ desk: 'office.json', say }))
  for (const d of D.list) {
    for (const k of d.desks) if (!ids.has(k)) findings.push({ desk: d.id, say: `names desk "${k}", which is no desk here (desks are named by id, the folder)` })
    if (d.instructions && !existsSync(join(root, d.instructions))) findings.push({ desk: d.id, say: `its lead's instructions ${d.instructions} do not exist` })
    for (const p of d.services) { try { new RegExp(p) } catch (e) { findings.push({ desk: d.id, say: `services pattern ${p} does not compile (${e.message}): that machinery would go unseen` }) } }
  }
  if (findings.length) return { code: 4, applicable: true, why: `${findings.length} problem(s) in office.json departments`, findings }
  const loose = desks.filter((d) => d.kind !== 'lead' && !D.byDesk.has(d.name)).map((d) => d.name)
  return { code: 0, applicable: true, why: `${D.list.length} department(s), each desk in at most one${loose.length ? `; in none, so every machine's: ${loose.join(', ')}` : ''}` }
}

if (isMain(import.meta.url)) {
  const r = report(process.argv[2] ?? process.cwd())
  console.log(r.why)
  for (const f of r.findings ?? []) console.log(`  ${f.desk}: ${f.say}`)
  process.exit(r.code)
}
