import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'))

// ⛔ ONE OWNER PER FACT. The description lives in plugin.json, in marketplace.json, and
// on the GitHub repo page. Three copies of one sentence means two of them go stale, and
// the stale ones are the two a stranger reads first.
test('⛔ both manifests carry the SAME description, word for word', () => {
  const p = read('.claude-plugin/plugin.json').description
  const m = read('.claude-plugin/marketplace.json').plugins[0].description
  assert.ok(p, 'plugin.json needs a description; it is the listing')
  assert.equal(p, m, 'the two manifests disagree, so one of them is already stale')
})

test('the description fits where GitHub actually shows it', () => {
  const d = read('.claude-plugin/plugin.json').description
  assert.ok(d.length <= 200, `${d.length} chars; GitHub truncates a long one in search results`)
  assert.ok(d.length >= 40, 'too short to say what this is')
})

// ⛔ THE TWO WORDS A STRANGER SEARCHES FOR. If the description does not say what it runs
// on, it is a description of nothing in particular.
test('⛔ the description names Claude Code', () => {
  const d = read('.claude-plugin/plugin.json').description
  assert.match(d, /Claude Code/, 'the one phrase someone would search to find this')
})

test('the manifests agree with each other on the name too', () => {
  const p = read('.claude-plugin/plugin.json')
  const m = read('.claude-plugin/marketplace.json')
  assert.equal(p.name, m.plugins[0].name)
  assert.match(p.name, /^[a-z0-9-]+$/, 'kebab-case, per the spec')
  assert.equal(p.displayName, 'Office-Anything')
})

test('⛔ the README leads with the same name the manifest declares', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
  const { displayName } = read('.claude-plugin/plugin.json')
  assert.match(readme.split('\n')[0], new RegExp(displayName),
    'the front page and the manifest must not disagree about what this is called')
})
