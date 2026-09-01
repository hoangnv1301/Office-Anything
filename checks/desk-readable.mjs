#!/usr/bin/env node
// ⛔ CAN EVERY DESK BE READ AT ALL? ONE OWNER FOR THIS QUESTION.
//
// Every other check needs the roster, so every other check hits a malformed desk.json.
// Before this file existed all three reported the same faults, and one typo produced six
// identical findings across three sections. That is how a board becomes noise: not by being
// wrong, but by saying one thing three times.
//
// So this check owns it. The others skip a desk they cannot read and say nothing, because
// this one has already named it.
//
// Exit 0 clean, 4 finding, 7 UNKNOWN.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { rosterSafe, portCollisions } from '../lib/desk.mjs'
import { isMain } from '../lib/is-main.mjs'

export const applies = (root) => existsSync(join(root, 'desks'))

// Paths in a finding are for a human reading a terminal, so they are relative to the
// project. An absolute path on a nested temp directory wraps three lines and hides the point.
const rel = (root, msg) => msg.split(`${root}/`).join('')

export function report(root = process.cwd()) {
  if (!applies(root)) return { code: 0, applicable: false, why: 'no desks/ directory' }
  const { desks, broken } = rosterSafe(join(root, 'desks'))

  if (broken.length) {
    return {
      code: 4, applicable: true,
      why: `${broken.length} desk(s) cannot be read, so nothing else can judge them`,
      findings: broken.map(b => ({ desk: b.desk, say: rel(root, b.why) })),
    }
  }
  if (!desks.length) {
    return { code: 7, applicable: true, why: 'desks/ exists but holds no desk.json, so nothing was examined' }
  }

  // ⛔ TWO DESKS ON ONE PORT is a readability problem too: both claim the same browser.
  const clash = portCollisions(desks)
  if (clash.length) {
    return {
      code: 4, applicable: true, why: `${clash.length} port(s) claimed twice`,
      findings: clash.map(c => ({ desk: c.desks.join(' and '), say: `both claim port ${c.port}` })),
    }
  }
  return { code: 0, applicable: true, why: `${desks.length} desk(s), all readable, no port claimed twice` }
}

if (isMain(import.meta.url)) {
  const r = report()
  if (!r.applicable) { console.log(`   not applicable  ${r.why}`); process.exit(0) }
  if (r.code === 7) { console.log(`UNKNOWN  ${r.why}`); process.exit(7) }
  if (r.code === 0) { console.log(`ok  ${r.why}`); process.exit(0) }
  console.log(`⛔ ${r.why}\n`)
  for (const f of r.findings) console.log(`   ${f.desk}: ${f.say}`)
  process.exit(4)
}
