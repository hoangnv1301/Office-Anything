#!/usr/bin/env node
// ⛔ DOES EVERY NUMBER THIS PROJECT STATES ABOUT ITSELF MATCH REALITY?
//
// The test count lives in FOUR places: a README badge, a CLAUDE.md command, and twice in
// the landing page. Every one is hand-written, and until this file existed exactly ONE of
// them was covered by a test. Adding a single test made three of them quietly wrong, and
// the wrong ones are the two a stranger sees first.
//
// ⚠️ THE FAULT IS NOT CARELESSNESS, IT IS SHAPE. A number that describes the code, stored
// somewhere the code cannot reach, drifts the moment anybody works. You do not fix that by
// being careful; you fix it by checking, or by having one copy.
//
// Exit 0 clean, 4 finding, 7 UNKNOWN.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isMain } from '../lib/is-main.mjs'

export function realTestCount(root) {
  let n = 0
  for (const f of readdirSync(join(root, 'tests'))) {
    if (!f.endsWith('.test.mjs')) continue
    n += (readFileSync(join(root, 'tests', f), 'utf8').match(/^test\(/gm) ?? []).length
  }
  return n
}

// Every place that states the count, and the pattern that finds it there. Adding a new
// surface means adding a line here, which is the cost of stating a number in one more place.
export const STATED = [
  { file: 'README.md',       re: /tests-(\d+)%20passing/g },
  { file: 'CLAUDE.md',       re: /#\s*(\d+)\s*tests/g },
  { file: 'docs/index.html', re: /tests-(\d+)%20passing|>(\d+) tests<|(\d+) tests · no dependencies/g },
]

// ⛔ THIS CHECK IS ABOUT THIS PROJECT, NOT ABOUT YOUR OFFICE, AND IT HAS TO SAY SO.
//
// `applies` was "there is a tests/ directory", which is true in every project that uses
// this plugin, because `hire` creates tests/desks/. So a user hired one desk and got a
// permanent amber row about a test count they had never stated. A check that cannot be
// satisfied by the person seeing it is worse than no check: it teaches them that amber
// means nothing, and the next amber row is a real one.
//
// It applies where there are tests to count AND somewhere claiming a count. That is a
// repo describing itself, which is the only place this question exists.
export const applies = (root) => {
  if (!existsSync(join(root, 'tests'))) return false
  try {
    if (!readdirSync(join(root, 'tests')).some(f => f.endsWith('.test.mjs'))) return false
  } catch { return false }
  return STATED.some(({ file, re }) => {
    const p = join(root, file)
    try { return existsSync(p) && new RegExp(re.source).test(readFileSync(p, 'utf8')) } catch { return false }
  })
}

export function report(root = process.cwd()) {
  // ⚠️ The reason must be TRUE. This said "no tests/ directory" in projects that have one,
  // which sends the reader to look at a directory that is sitting right there.
  if (!applies(root)) {
    return { code: 0, applicable: false, why: 'this project does not state a test count about itself' }
  }
  const real = realTestCount(root)
  if (!real) return { code: 7, applicable: true, why: 'tests/ exists but defines no tests, so there is nothing to compare' }

  const findings = []
  let checked = 0
  for (const { file, re } of STATED) {
    const p = join(root, file)
    if (!existsSync(p)) continue
    const text = readFileSync(p, 'utf8')
    for (const m of text.matchAll(re)) {
      const said = Number(m.slice(1).find(Boolean))
      checked++
      if (said !== real) findings.push({ desk: file, say: `says ${said} tests, there are ${real}` })
    }
  }
  if (!checked) return { code: 7, applicable: true, why: 'no file states a test count, so nothing was compared' }
  if (findings.length) return { code: 4, applicable: true, why: `${findings.length} of ${checked} stated count(s) are wrong`, findings }
  return { code: 0, applicable: true, why: `${checked} stated test count(s), all of them ${real}` }
}

if (isMain(import.meta.url)) {
  const r = report()
  if (!r.applicable) { console.log(`   not applicable  ${r.why}`); process.exit(0) }
  if (r.code === 7) { console.log(`UNKNOWN  ${r.why}`); process.exit(7) }
  if (r.code === 0) { console.log(`ok  ${r.why}`); process.exit(0) }
  console.log(`⛔ ${r.why}\n`)
  for (const f of r.findings) console.log(`   ${f.desk} ${f.say}`)
  process.exit(4)
}
