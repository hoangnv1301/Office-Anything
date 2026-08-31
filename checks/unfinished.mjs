#!/usr/bin/env node
// ⛔ IS A DESK STILL WEARING THE STUBS IT WAS HIRED WITH?
//
// This check exists because the README makes a promise: "a new hire is not green". A
// promise nothing enforces is marketing. Without this, hiring a desk and walking away
// produces a clean board over a desk that knows nothing and has never been told anything.
//
// ⚠️ IT IS NOT A NAG ABOUT WORD COUNT. It looks for the SPECIFIC shapes `hire` writes:
// a heading with nothing under it, and the empty-facts marker. A desk with one real
// sentence per section passes, because at that point somebody has thought about it.
//
// Exit 0 clean, 4 finding, 7 UNKNOWN.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { roster } from '../lib/desk.mjs'
import { isMain } from '../lib/is-main.mjs'

export const applies = (root) => existsSync(join(root, 'desks'))

// The marker `hire` writes into a fresh facts.md. Its presence means nobody has been back.
const UNTOUCHED = /⛔ Empty\. Nothing here is true until somebody writes it\./

// A heading with no prose under it before the next heading or EOF.
export function emptySections(md) {
  const lines = md.split('\n')
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^#{2,}\s+(.+)$/)
    if (!h) continue
    let body = ''
    for (let j = i + 1; j < lines.length && !/^#{1,}\s/.test(lines[j]); j++) body += lines[j].trim()
    if (!body) out.push(h[1].trim())
  }
  return out
}

export function report(root = process.cwd()) {
  if (!applies(root)) return { code: 0, applicable: false, why: 'no desks/ directory' }
  const desks = roster(join(root, 'desks'))
  if (!desks.length) return { code: 7, applicable: true, why: 'desks/ exists but holds no desk.json' }

  const findings = []
  for (const d of desks) {
    const facts = join(d.dir, 'facts.md')
    if (existsSync(facts) && UNTOUCHED.test(readFileSync(facts, 'utf8'))) {
      findings.push({ desk: d.name, say: 'facts.md is still the stub. This desk knows nothing.' })
    }
    const claude = join(d.dir, 'CLAUDE.md')
    if (existsSync(claude)) {
      const empty = emptySections(readFileSync(claude, 'utf8'))
      if (empty.length) {
        findings.push({ desk: d.name, say: `CLAUDE.md has ${empty.length} empty section(s): ${empty.join(', ')}` })
      }
    }
  }

  if (!findings.length) return { code: 0, applicable: true, why: `${desks.length} desk(s), none still on stubs` }
  return { code: 4, applicable: true, why: `${findings.length} thing(s) never filled in after hiring`, findings }
}

if (isMain(import.meta.url)) {
  const r = report()
  if (!r.applicable) { console.log(`   not applicable  ${r.why}`); process.exit(0) }
  if (r.code === 7) { console.log(`UNKNOWN  ${r.why}`); process.exit(7) }
  if (r.code === 0) { console.log(`ok  ${r.why}`); process.exit(0) }
  console.log(`⛔ ${r.why}\n`)
  for (const f of r.findings) console.log(`   ${f.desk}: ${f.say}`)
  console.log('\n   This is what a fresh hire looks like. Fill them in and it goes green.')
  process.exit(4)
}
