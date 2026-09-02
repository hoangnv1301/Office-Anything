#!/usr/bin/env node
// EVERY CHECK, ONE COMMAND, ONE EXIT CODE.
//
// ⛔ THIS FILE EXISTS BECAUSE CHECKS THAT ARE NOT WIRED TO ANYTHING DO NOT RUN. In the
// system this came from, a full-tree credential scan sat unwired for weeks. It was named
// in three documents and a lesson about not reading measurements, two tests imported it so
// the suite kept proving it worked, and no schedule ever ran it. When it was finally wired
// up, its first run was red.
//
// Adding a check here is ONE line. That is the entire point: the cost of surfacing a check
// has to be near zero, or it does not get surfaced.
//
//   0  every applicable check is clean
//   4  ⛔ at least one has a finding
//   7  at least one could not answer, and none had a finding
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { report as deskReadable } from './desk-readable.mjs'
import { report as sendWall } from './send-wall.mjs'
import { report as unfinished } from './unfinished.mjs'
import { report as strayWrites } from './stray-writes.mjs'
import { report as statedNumbers } from './stated-numbers.mjs'
import { isMain } from '../lib/is-main.mjs'

export const CHECKS = [
  // ⛔ FIRST, because every check below needs the roster. If a desk cannot be read, this
  // one says so and the others stay quiet rather than repeating it.
  { name: 'desk-readable', run: deskReadable, answers: 'can every desk be read, and does any port get claimed twice' },
  { name: 'send-wall',  run: sendWall,   answers: 'can a desk that should not reach a customer, reach one' },
  { name: 'unfinished', run: unfinished, answers: 'is a desk still wearing the stubs it was hired with' },
  { name: 'stray-writes', run: strayWrites, answers: 'did a desk leave anything outside its own folder' },
  { name: 'stated-numbers', run: statedNumbers, answers: 'does every number this project states about itself match reality' },
]

export function collect(root = process.cwd(), checks = CHECKS) {
  const rows = checks.map(c => {
    // ⛔ A CHECK THAT THROWS IS NOT A CHECK THAT PASSED. Without this, one bad import
    // takes down the runner and every check after it reports nothing, silently.
    try { return { ...c, ...c.run(root) } }
    catch (e) { return { ...c, code: 7, applicable: true, why: `threw: ${e.message}` } }
  })
  const bad = rows.filter(r => r.code === 4)
  const unknown = rows.filter(r => r.code === 7)
  return { rows, code: bad.length ? 4 : unknown.length ? 7 : 0, bad, unknown }
}

if (isMain(import.meta.url)) {
  // ⛔ THE ARGUMENT IS HONORED OR THE RUN REFUSES. collect(root) always took a
  // root, and the CLI never passed one, so `node checks/run.mjs /some/repo`
  // silently audited the directory you were STANDING IN and printed a clean
  // board about the wrong codebase. Found 2026-09-02 by pointing it at a repo
  // from a temp directory: the board reported the temp directory. The README
  // sells auditing "a repo you did not write", and that was the one thing the
  // CLI could not do. A guard on a path the docs do not use, in this repo's
  // own words -- and falling back to cwd on a BAD argument would be the same
  // bug with politeness: you asked about X, it answered about Y.
  const arg = process.argv[2]
  if (arg && !existsSync(arg)) {
    console.error(`⛔ no such directory: ${arg}. Refusing to audit the cwd in its place.`)
    process.exit(7)
  }
  const r = collect(arg ? resolve(arg) : process.cwd())
  // ⛔ DERIVED FROM THE LONGEST NAME, NEVER A LITERAL. This was padEnd(12), which broke the
  // day a check called "stray-writes" was added, then padEnd(14), which broke the day
  // "stated-numbers" was added. A width that has to be widened every time a check is added
  // is not a column width, it is a bug with a delay on it.
  const w = Math.max(...r.rows.map(x => x.name.length)) + 2
  for (const row of r.rows) {
    const tag = row.applicable === false ? '  --  ' : row.code === 0 ? '  ok  ' : row.code === 7 ? ' ???  ' : '  ⛔  '
    console.log(`${tag}${row.name.padEnd(w)}${row.why}`)
  }
  console.log('')
  if (r.code === 0) {
    // ⛔ SAY HOW MANY ACTUALLY LOOKED. "All checks passed" over a set that all reported
    // not-applicable is the most reassuring lie this tool could tell.
    const looked = r.rows.filter(x => x.applicable !== false).length
    console.log(looked ? `ok  ${looked} of ${r.rows.length} check(s) applied, all clean`
                       : `   nothing applied yet. Hire a desk and these switch on.`)
    process.exit(0)
  }
  if (r.code === 7) { console.log(`UNKNOWN  ${r.unknown.length} check(s) could not answer`); process.exit(7) }
  console.log(`⛔ ${r.bad.length} check(s) have a finding`)
  for (const b of r.bad) for (const f of b.findings ?? []) console.log(`   ${b.name}: ${f.desk} ${f.say}`)
  process.exit(4)
}
