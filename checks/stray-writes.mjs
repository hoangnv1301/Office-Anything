#!/usr/bin/env node
// ⛔ DID A DESK LEAVE ANYTHING OUTSIDE ITS OWN FOLDER?
//
// The reason to hire a desk for something you are only trying out is that when you fire it,
// it is actually gone. That promise is worth exactly as much as your ability to check it.
//
// A desk records what it installed in its own `installed` list. This walks the project and
// reports anything on that list living somewhere other than inside that desk's folder.
//
// ⚠️ THIS DETECTS, IT DOES NOT PREVENT, AND THE DIFFERENCE IS STATED HERE RATHER THAN
// GLOSSED. A PreToolUse hook sees a file path; it does not know which desk was acting when
// the write happened, so it cannot enforce "this desk may only write to its own folder".
// Claiming containment we do not have would be worse than having none, because you would
// stop looking. What is real: the desk records what it brought, and this tells you where
// that ended up.
//
// Exit 0 clean, 4 finding, 7 UNKNOWN.
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { rosterSafe } from '../lib/desk.mjs'
import { isMain } from '../lib/is-main.mjs'

export const applies = (root) => existsSync(join(root, 'desks'))

const SKIP = new Set(['.git', 'node_modules', 'bk', '.claude', 'dist', 'build'])

function walk(dir, root, out = [], depth = 0) {
  if (depth > 6) return out
  let entries = []
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, root, out, depth + 1)
    else out.push(relative(root, p))
  }
  return out
}

export function report(root = process.cwd()) {
  if (!applies(root)) return { code: 0, applicable: false, why: 'no desks/ directory' }
  const { desks, broken } = rosterSafe(join(root, 'desks'))
  // A desk this cannot read is skipped in silence. desk-readable owns that finding, and
  // one fault reported by four checks is how a board stops being read.
  // ⛔ NOT APPLICABLE, not UNKNOWN. There are no desks, so there is nothing here to
  // judge -- which is a different statement from "I looked and could not tell".
  // desk-readable owns the UNKNOWN for an empty desks/, so it is said once.
  if (!desks.length) return { code: 0, applicable: false, why: 'no desks yet' }// Only desks that actually claim to have brought something in are interesting.
  const claiming = desks.filter(d => Array.isArray(d.installed) && d.installed.length)
  if (!claiming.length) {
    return { code: 0, applicable: true, why: `${desks.length} desk(s), none of them installed anything to track` }
  }

  const files = walk(root, root)
  const findings = []
  for (const d of claiming) {
    const home = `desks${sep}${d.name}${sep}`
    for (const item of d.installed) {
      const strays = files.filter(f => f.includes(item) && !f.startsWith(home))
      for (const f of strays.slice(0, 6)) {
        findings.push({ desk: d.name, item, at: f })
      }
    }
  }

  if (!findings.length) {
    return { code: 0, applicable: true, why: `${claiming.length} desk(s) tracking installs, nothing outside their folders` }
  }
  return { code: 4, applicable: true, why: `${findings.length} file(s) a desk brought in are living outside it`, findings }
}

if (isMain(import.meta.url)) {
  const r = report()
  if (!r.applicable) { console.log(`   not applicable  ${r.why}`); process.exit(0) }
  if (r.code === 7) { console.log(`UNKNOWN  ${r.why}`); process.exit(7) }
  if (r.code === 0) { console.log(`ok  ${r.why}`); process.exit(0) }
  console.log(`⛔ ${r.why}\n`)
  for (const f of r.findings) console.log(`   ${f.desk} installed "${f.item}", which is at ${f.at}`)
  console.log('\n   Firing that desk will not remove these. Move them in, or record them somewhere')
  console.log('   that survives the desk going away.')
  process.exit(4)
}
