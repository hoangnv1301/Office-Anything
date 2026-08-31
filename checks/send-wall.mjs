#!/usr/bin/env node
// ⛔ CAN A DESK THAT SHOULD NOT REACH A CUSTOMER, REACH ONE?
//
// A knowledge desk holds the things you would never want sent: price lists, margins,
// contracts, internal rates. A channel desk talks to people. The wall between them is
// that a knowledge desk has no way to send anything, and "no way" means the capability
// is ABSENT, not disabled.
//
// ⛔ AND IT IS CHECKED IN BOTH DIRECTIONS, which is the whole point. A missing sender on
// a live channel desk is just as broken as a present one on a knowledge desk: the first
// means a customer is being ignored, the second means your margins have a route out.
// A one-directional version of this check passes a team that cannot answer anybody.
//
// Exit 0 clean, 4 finding, 7 UNKNOWN.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { roster, mayHold } from '../lib/desk.mjs'

const SENDER = /\.(mjs|js|ts|py)$/

// ⛔ `applies` IS WHY INSTALLING THIS IS SAFE. With no desks/ directory there is nothing
// to have an opinion about, and this reports NOT APPLICABLE rather than passing. A check
// that "passes" when it looked at nothing is how a green board comes to mean nothing.
export const applies = (root) => existsSync(join(root, 'desks'))

const hasSender = (dir) => {
  for (const sub of ['send', 'relay']) {
    const p = join(dir, 'runtime', sub)
    try { if (readdirSync(p).some(f => SENDER.test(f))) return true } catch {}
  }
  return false
}

export function report(root = process.cwd()) {
  if (!applies(root)) {
    return { code: 0, applicable: false, why: 'no desks/ directory, so there is no wall to check' }
  }
  const desks = roster(join(root, 'desks'))
  if (!desks.length) {
    // ⛔ A desks/ directory holding nothing is UNKNOWN, not clean. Either the hire
    // failed halfway or something deleted them, and both deserve a look.
    return { code: 7, applicable: true, why: 'desks/ exists but holds no desk.json, so nothing was examined' }
  }

  const findings = []
  for (const d of desks) {
    const sends = hasSender(d.dir)
    const permitted = mayHold(d.kind, 'sender')

    if (sends && permitted === false) {
      findings.push({
        desk: d.name,
        say: `is a ${d.kind} desk and has a sender. That kind is never issued one.`,
      })
    }
    if (sends && permitted === 'only when live' && !d.live) {
      findings.push({
        desk: d.name,
        say: 'has a sender but is not live. Going live should be the reviewed edit, not a file appearing.',
      })
    }
    if (!sends && permitted === 'only when live' && d.live) {
      findings.push({
        desk: d.name,
        say: 'is LIVE and has no way to reply. Someone is being ignored.',
      })
    }
  }

  if (!findings.length) {
    return { code: 0, applicable: true, why: `${desks.length} desk(s), every one on the right side of the wall` }
  }
  return { code: 4, applicable: true, why: `${findings.length} desk(s) on the wrong side of the send wall`, findings }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = report()
  if (!r.applicable) { console.log(`   not applicable  ${r.why}`); process.exit(0) }
  if (r.code === 7) { console.log(`UNKNOWN  ${r.why}`); process.exit(7) }
  if (r.code === 0) { console.log(`ok  ${r.why}`); process.exit(0) }
  console.log(`⛔ ${r.why}\n`)
  for (const f of r.findings) console.log(`   ${f.desk} ${f.say}`)
  process.exit(4)
}
