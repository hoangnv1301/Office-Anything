// CORE IS GENERIC. The plugin grows by promoting machinery one office proved
// (local-cabinets-ops), and the easy mistake is to promote that office's words
// with it: its desk names, its case codes, its role variable. A comment may
// tell the history of a fault; CODE may not name a project.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PROJECT = /alibaba|cabinet|工厂|onetalk|\bBT-\d|design-quotation|speedship|\bLCC_[A-Z]/i

function* files(dir) {
  for (const n of readdirSync(dir)) {
    const f = join(dir, n)
    if (statSync(f).isDirectory()) { if (!['node_modules', 'dist', 'ui'].includes(n)) yield* files(f) }
    else if (/\.(mjs|js|json|md)$/.test(n)) yield f
  }
}

export function projectWordsIn(text) {
  const hits = []
  let block = false
  text.split('\n').forEach((line, i) => {
    const t = line.trim()
    if (block) { if (t.includes('*/')) block = false; return }
    if (t.startsWith('/*')) { block = !t.includes('*/'); return }
    if (t.startsWith('//') || t.startsWith('*')) return
    const code = line.replace(/\s\/\/\s.*$/, '')
    if (PROJECT.test(code)) hits.push(`${i + 1}: ${t.slice(0, 100)}`)
  })
  return hits
}

test('no project word in core code (lib, hooks, checks, commands, board server)', () => {
  const found = []
  for (const d of ['lib', 'hooks', 'checks', 'commands']) for (const f of files(join(ROOT, d))) {
    for (const h of f.endsWith('.md') ? [] : projectWordsIn(readFileSync(f, 'utf8'))) found.push(`${f.slice(ROOT.length + 1)}:${h}`)
  }
  for (const n of readdirSync(join(ROOT, 'board'))) if (n.endsWith('.mjs')) for (const h of projectWordsIn(readFileSync(join(ROOT, 'board', n), 'utf8'))) found.push(`board/${n}:${h}`)
  assert.deepEqual(found, [])
})

test('the scanner catches a project word in code and lets a comment tell history', () => {
  assert.equal(projectWordsIn("const desk = 'design-quotation'").length, 1)
  assert.equal(projectWordsIn('// the first repo\'s alibaba incident').length, 0)
})
