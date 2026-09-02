#!/usr/bin/env node
// ⛔ DOES ADDING OR REMOVING A DESK BREAK A TEST THAT NEVER CARED WHICH DESK IT WAS?
//
// The first repo to adopt this contract measured 67 of 145 root test files
// naming a live desk as a code literal. Every desk it retired turned some of
// those literals into rot: eight tests red because a fake terminal was titled
// after a desk removed two weeks earlier, a wake list that silently omitted
// the newest desk, a voice rule that one day demanded the voice's own owner
// not hold it. The owner's ruling, 2026-09-02: root tests hold COMMON rules
// only, so a desk can be added or removed without touching them.
//
// This is a RATCHET, not a ban. 67 files do not become 0 in a day, and a rule
// that lands red on 67 files gets disabled by Friday. The audited repo pins
// the measured counts in tests/desk-literals.json, and the recorded number
// must EQUAL the measured number: growth is a finding, and so is an unbanked
// improvement, because a loose ratchet quietly becomes a dead letter. Same
// doctrine as a stated test count: the only way to comply is to shrink.
//
// A file that legitimately names a desk, because the RULE is about that desk
// (the first repo's "alibaba may never hold a sender" is about exactly one
// desk), simply keeps its count forever, and the WHY belongs in that test.
//
// Exit 0 clean, 4 finding, 7 UNKNOWN.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { rosterSafe } from '../lib/desk.mjs'
import { isMain } from '../lib/is-main.mjs'

export const RATCHET = 'tests/desk-literals.json'

// Comments do not break when a desk goes: only CODE counts.
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

const testFiles = (dir, out = [], base = dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) testFiles(p, out, base)
    else if (e.name.endsWith('.test.mjs')) out.push(p)
  }
  return out
}

export function measure(root, names) {
  const tests = join(root, 'tests')
  const out = {}
  if (!existsSync(tests)) return out
  for (const f of testFiles(tests)) {
    const code = strip(readFileSync(f, 'utf8'))
    let n = 0
    for (const d of names) n += (code.match(new RegExp(`['"\`]${d}['"\`]|['"\`][^'"\`\\n]*desks/${d}`, 'g')) || []).length
    if (n) out[f.slice(root.length + 1)] = n
  }
  return out
}

export const applies = (root) => existsSync(join(root, 'desks')) && existsSync(join(root, 'tests'))

export function report(root = process.cwd()) {
  if (!applies(root)) return { code: 0, applicable: false, why: 'no desks/ or no root tests/' }
  const { desks, broken } = rosterSafe(join(root, 'desks'))
  if (broken.length) return { code: 0, applicable: false, why: 'desk-readable owns unreadable desks; nothing to measure against' }
  if (!desks.length) return { code: 0, applicable: false, why: 'no desks yet' }

  const measured = measure(root, desks.map((d) => d.name))
  const rfile = join(root, RATCHET)

  if (!existsSync(rfile)) {
    const n = Object.keys(measured).length
    // Adoption is a visible, reviewed edit, never an ambush: a repo that has
    // not written the ratchet gets told, not failed.
    return {
      code: 0, applicable: true,
      why: n === 0
        ? 'no ratchet declared and no root test names a desk. Nothing to pin'
        : `no ratchet declared. ${n} root test file(s) name a desk in code; write ${RATCHET} to start the ratchet`,
    }
  }

  let pinned
  try { pinned = JSON.parse(readFileSync(rfile, 'utf8')).files ?? {} }
  catch (e) { return { code: 7, applicable: true, why: `${RATCHET} is not valid JSON: ${e.message}` } }

  const findings = []
  for (const [f, n] of Object.entries(measured)) {
    const p = pinned[f]
    if (p === undefined) findings.push({ desk: f, say: `NEW: names a desk ${n} time(s) and is not in the ratchet` })
    else if (n > p) findings.push({ desk: f, say: `grew: ${p} pinned, ${n} measured. Derive the name from the roster instead` })
    else if (n < p) findings.push({ desk: f, say: `improved: ${p} pinned, ${n} measured. Bank it in ${RATCHET} or it will be spent` })
  }
  for (const f of Object.keys(pinned)) {
    if (!(f in measured)) findings.push({ desk: f, say: 'pinned but now clean or gone. Remove its row, a stale ratchet is a loose one' })
  }

  if (!findings.length) {
    const files = Object.keys(measured).length
    return { code: 0, applicable: true, why: `${files} file(s) still name a desk, all pinned at their measured counts` }
  }
  return { code: 4, applicable: true, why: `the desk-literal ratchet does not match what is measured`, findings }
}

if (isMain(import.meta.url)) {
  const r = report(process.argv[2] ?? process.cwd())
  if (!r.applicable) { console.log(`   not applicable  ${r.why}`); process.exit(0) }
  if (r.code === 7) { console.log(`UNKNOWN  ${r.why}`); process.exit(7) }
  if (r.code === 0) { console.log(`ok  ${r.why}`); process.exit(0) }
  console.log(`⛔ ${r.why}\n`)
  for (const f of r.findings) console.log(`   ${f.desk}: ${f.say}`)
  process.exit(4)
}
