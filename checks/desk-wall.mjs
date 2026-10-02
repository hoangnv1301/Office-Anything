#!/usr/bin/env node
// ⛔ DOES THE DESK WALL HOLD, AND HAS ANY DESK DONE WHAT IT FORBIDS?
//
// The gate (hooks/desk-wall.mjs) refuses; this reports, after the fact, the
// two ways a wall fails quietly:
//
//   1. A rule in office.json that does not compile. The gate cannot apply a
//      pattern it cannot build; an office that fails open then lets that
//      command through, and nothing on screen says the rule is dead.
//   2. A desk's own record showing a command the office audits for
//      ("wall.audit": patterns, e.g. the database CLI): the wall was absent,
//      not yet armed (hooks arm only when a session restarts), or bypassed.
//
// Applies only where office.json declares a wall. Exit 0 clean, 4 finding, 7 UNKNOWN.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { rosterSafe } from '../lib/desk.mjs'
import { readOfficeConfig } from '../lib/office.mjs'
import { compileWall } from '../lib/wall.mjs'
import { isMain } from '../lib/is-main.mjs'
import { slugFor } from '../board/read.mjs'

export const applies = (root) => existsSync(join(root, 'desks')) && !!readOfficeConfig(root).wall

// the same slug the board uses to find a desk's sessions (one owner)
const projectDirOf = (dir, home) => join(home, '.claude', 'projects', slugFor(dir))

export function report(root = process.cwd(), { home = homedir() } = {}) {
  if (!applies(root)) return { code: 0, applicable: false, why: 'this office declares no desk wall' }
  const w = readOfficeConfig(root).wall
  const findings = []
  try { compileWall(w) } catch (e) { findings.push({ desk: 'office.json', say: `a wall rule does not compile, so the gate cannot apply it: ${e.message}` }) }
  for (const [i, p] of (Array.isArray(w.audit) ? w.audit : []).entries()) {
    try { new RegExp(p) } catch (e) { findings.push({ desk: 'office.json', say: `wall.audit[${i}] does not compile: ${e.message}` }) }
  }
  const { desks } = rosterSafe(join(root, 'desks'))
  if (!desks.length) return findings.length ? { code: 4, applicable: true, why: `${findings.length} wall rule(s) broken`, findings } : { code: 0, applicable: false, why: 'no desks yet' }
  const audit = (Array.isArray(w.audit) ? w.audit : []).flatMap((p) => { try { return [new RegExp(`"command":"[^"]*(?:${p})[^"]*"`, 'g')] } catch { return [] } })
  let read = 0
  for (const d of desks) {
    const dir = projectDirOf(d.dir, home)
    if (!audit.length || !existsSync(dir)) continue
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
      const path = join(dir, f)
      try { if (statSync(path).size > 64 << 20) continue } catch { continue }
      read++
      const text = readFileSync(path, 'utf8')
      for (const re of audit) {
        const hits = text.match(re)
        if (hits) findings.push({ desk: d.name, say: `session ${f} ran ${hits.length} command(s) this office audits for, e.g. ${hits[0].slice(0, 120)}` })
      }
    }
  }
  if (findings.length) return { code: 4, applicable: true, why: `${findings.length} desk wall finding(s)`, findings }
  return { code: 0, applicable: true, why: audit.length ? `${desks.length} desk(s), wall rules compile, ${read} session record(s) clean` : `${desks.length} desk(s), wall rules compile (no audit patterns declared)` }
}

if (isMain(import.meta.url)) {
  const r = report(resolve(process.argv[2] ?? process.cwd()))
  if (!r.applicable) { console.log(`   not applicable  ${r.why}`); process.exit(0) }
  if (r.code === 0) { console.log(`ok  ${r.why}`); process.exit(0) }
  console.log(`⛔ ${r.why}\n`)
  for (const f of r.findings) console.log(`   ${f.desk}: ${f.say}`)
  process.exit(4)
}
