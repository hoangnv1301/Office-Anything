#!/usr/bin/env node
// ⛔ IS EVERY DESK ACTUALLY LISTENING? Alive and idle is not listening: after a
// Mac restart (2026-10-05) every desk came back resumed with no doorbell
// running, and the registry still said idle. lib/health.mjs owns the answer;
// this check puts it on the board and in `node checks/run.mjs`, so the board
// knows nothing the checks do not.
//
// Applies only where something is declared: a desk.json `wake`, or office.json
// `health`. Anywhere else it is "not applicable", a fourth state, not a pass.
// It never acts; healing is lib/heal.mjs, behind `--heal`.
//
// Exit 0 clean, 4 finding, 7 UNKNOWN.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { rosterSafe } from '../lib/desk.mjs'
import { readOfficeConfig } from '../lib/office.mjs'
import { officeHealth } from '../lib/health.mjs'
import { isMain } from '../lib/is-main.mjs'

export function applies(root) {
  if (!existsSync(join(root, 'desks'))) return false
  if (Array.isArray(readOfficeConfig(root).health)) return true
  return rosterSafe(join(root, 'desks')).desks.some((d) => typeof d.wake === 'string' && d.wake.trim())
}

export function report(root = process.cwd(), opts = {}) {
  if (!applies(root)) return { code: 0, applicable: false, why: 'no desk declares a doorbell (wake) and office.json declares no health checks' }
  const h = officeHealth(root, opts)
  // an empty desks/ is desk-readable's to say. So is an unreadable desk.json:
  // it is named there, once, and the readable desks are still judged here,
  // because one broken file blinding every other desk is fault #4 in CLAUDE.md
  if (h.code === 7) return { code: 0, applicable: false, why: 'desk-readable owns this: no desk can be judged yet' }
  const broken = new Set((h.broken ?? []).map((b) => b.desk))
  const findings = h.findings.filter((f) => !broken.has(f.desk))
  const why = findings.length ? findings.map((f) => `${f.desk} ${f.short ?? f.say}`).join(' · ') : h.summary
  return { code: findings.length ? 4 : 0, applicable: true, why, findings }
}

if (isMain(import.meta.url)) {
  const r = report()
  if (!r.applicable) { console.log(`   not applicable  ${r.why}`); process.exit(0) }
  if (r.code === 0) { console.log(`ok  ${r.why}`); process.exit(0) }
  console.log(`⛔ ${r.why}\n`)
  for (const f of r.findings) console.log(`   ${f.desk}: ${f.say}`)
  process.exit(r.code)
}
