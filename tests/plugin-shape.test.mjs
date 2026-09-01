import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'))

// ⛔ VERIFIED AGAINST THE PUBLISHED SPEC, not against memory. The first version of these
// manifests was written from recollection, and the layout was right by luck while the
// README was wrong: it advertised `/desk hire` with a SPACE, and commands/ produces
// `/desk-hire` from the filename. A doc claiming a capability the layout does not provide
// is the exact failure this project sells a fix for.

test('marketplace.json has the fields the spec requires', () => {
  const m = read('.claude-plugin/marketplace.json')
  assert.ok(m.name, 'name is required')
  assert.match(m.name, /^[a-z0-9-]+$/, 'kebab-case, no spaces')
  assert.ok(m.owner?.name, 'owner.name is required')
  assert.ok(Array.isArray(m.plugins) && m.plugins.length, 'plugins[] is required')
  for (const p of m.plugins) {
    assert.ok(p.name && p.source && p.description, `${p.name}: needs name, source, description`)
  }
})

test('plugin.json has the one field the spec requires, in the right shape', () => {
  const p = read('.claude-plugin/plugin.json')
  assert.ok(p.name, 'name is the only required field')
  assert.match(p.name, /^[a-z0-9-]+$/, 'kebab-case')
})

test('the marketplace entry and the plugin agree on a name', () => {
  const m = read('.claude-plugin/marketplace.json')
  const p = read('.claude-plugin/plugin.json')
  assert.ok(m.plugins.some(x => x.name === p.name),
    `marketplace lists ${m.plugins.map(x => x.name)}, plugin.json says ${p.name}`)
})

// ⛔ THE ONE THAT ACTUALLY BIT. Commands are FLAT markdown in commands/, so the filename
// IS the slash command. Every command the README advertises must exist as a file.
test('⛔ every /command the README advertises exists as a file', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
  const claimed = [...new Set([...readme.matchAll(/(?:^|\s)\/([a-z][a-z0-9-]*)/g)].map(m => m[1]))]
    .filter(c => !['plugin'].includes(c))     // /plugin install is Claude Code's own
  const have = readdirSync(join(ROOT, 'commands')).map(f => f.replace(/\.md$/, ''))
  for (const c of claimed) {
    assert.ok(have.includes(c),
      `README advertises /${c} and commands/${c}.md does not exist. Have: ${have.join(', ')}`)
  }
})

// ⛔ AND BOTH DIRECTIONS: a command nobody documents is a command nobody finds.
test('⛔ every command file is advertised in the README', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
  for (const f of readdirSync(join(ROOT, 'commands'))) {
    const c = f.replace(/\.md$/, '')
    assert.match(readme, new RegExp(`/${c}\\b`), `commands/${f} exists and the README never mentions /${c}`)
  }
})

test('commands live where the spec says they are discovered', () => {
  assert.ok(existsSync(join(ROOT, 'commands')), 'commands/ at the plugin root')
  for (const f of readdirSync(join(ROOT, 'commands'))) {
    assert.match(f, /\.md$/, 'commands are flat markdown files, not directories')
  }
})

// ⛔ The test that used to live here watched ONE file's count. checks/stated-numbers.mjs
// now watches all four places the number appears, so this was a second owner for a question
// that already had one. Retired rather than left to disagree with it.
// See tests/stated-numbers.test.mjs.
