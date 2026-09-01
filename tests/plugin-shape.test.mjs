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

// ⛔ FOUND IN AN AUDIT: desk-hire.md told the model to pick a port and write desk.json by
// hand, and never mentioned hire(). A model following the documented path would have
// hand-rolled a desk and skipped every guard inside hire() — the name rules, the port
// check, the one-lead rule, and the second-reader agreement about who may talk to a
// customer. A guard on a path the docs do not use is not a guard.
test('⛔ EVERY command points at a guarded entry point, not at the parts', () => {
  // ⛔ THIS TEST NAMED TWO COMMANDS AND MISSED THE THIRD. desk-try.md shipped saying
  // "hire a desk for it" in prose, pointing at no function, and this guard could not see
  // it because it checked desk-hire.md and desk-fire.md by name. A guard with a hardcoded
  // list does not cover the member added after it was written, which is the same fault as
  // a hardcoded column width: correct until somebody adds one more thing.
  for (const f of readdirSync(join(ROOT, 'commands'))) {
    const text = readFileSync(join(ROOT, 'commands', f), 'utf8')
    assert.match(text, /\b(hire|fire)\(/,
      `commands/${f} never tells the model to call hire() or fire(). A model following it ` +
      `assembles a desk by hand and skips every guard inside those functions.`)
  }
})

test('⛔ and each command warns against the manual path it replaces', () => {
  for (const f of readdirSync(join(ROOT, 'commands'))) {
    const text = readFileSync(join(ROOT, 'commands', f), 'utf8')
    assert.match(text, /not assemble|Do not work around|do not retry/i,
      `commands/${f} points at the guarded call but never says why the hand-rolled path is wrong`)
  }
})

test('⛔ a command may not name an export that does not exist', async () => {
  const libs = { hire: await import('../lib/hire.mjs'), desk: await import('../lib/desk.mjs'), fire: await import('../lib/fire.mjs') }
  const known = new Set(Object.values(libs).flatMap(m => Object.keys(m)))
  for (const f of readdirSync(join(ROOT, 'commands'))) {
    const text = readFileSync(join(ROOT, 'commands', f), 'utf8')
    for (const m of text.matchAll(/`([a-zA-Z][a-zA-Z0-9]*)\(/g)) {
      assert.ok(known.has(m[1]), `${f} tells the model to call ${m[1]}(), which nothing exports`)
    }
  }
})

// ⛔ THE SITE IS AN ADVERTISING SURFACE AND IT WENT STALE. /desk-try shipped, the README
// documented it, and the landing page never mentioned it — so the strongest feature was
// missing from the page most people see first. Two surfaces advertising the same product,
// and nothing checking they agree, which is this project's recurring fault in a new place.
test('⛔ the landing page advertises every command the README does', () => {
  const site = readFileSync(join(ROOT, 'docs', 'index.html'), 'utf8')
  for (const f of readdirSync(join(ROOT, 'commands'))) {
    const c = f.replace(/\.md$/, '')
    assert.match(site, new RegExp(`/${c}\\b`),
      `commands/${f} ships and docs/index.html never mentions /${c}`)
  }
})

// ⛔ FOUND BY RUNNING `claude plugin update` AND WATCHING IT DO NOTHING.
//
// The plugin cache is keyed by VERSION. Twelve rounds of fixes went into the repo with
// plugin.json still saying 0.1.0, so `claude plugin update` answered "already at the latest
// version" and a user would have received none of them. The install had 3 checks and 2
// commands while the repo had 6 and 3.
//
// Bumping the version is not bookkeeping. It is the only thing that delivers a fix.
test('⛔ plugin.json and marketplace.json state the SAME version', () => {
  const p = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'))
  const m = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'))
  assert.ok(p.version, 'without a version, update has nothing to compare and delivers nothing')
  assert.equal(p.version, m.plugins[0].version,
    'the two disagree, so the marketplace offers one version and the plugin claims another')
  assert.match(p.version, /^\d+\.\d+\.\d+$/, 'semver, because the updater compares it as one')
})

// ⛔ THE HIGHEST-STAKES HARDCODED LIST IN THIS PROJECT.
//
// checks/run.mjs registers every check by hand. A file that lands in checks/ and never gets
// a line there SILENTLY NEVER RUNS, and its own tests keep passing, so nothing anywhere
// says it is unwired. That is not hypothetical: the system this came from had a full-tree
// credential scan sitting unregistered for weeks, named in three documents and a lesson,
// with two tests proving it worked. Its first scheduled run was red.
//
// A check nobody runs is worse than no check, because the board looks complete.
test('⛔ every check in checks/ is REGISTERED in run.mjs', async () => {
  const { CHECKS } = await import('../checks/run.mjs')
  const registered = new Set(CHECKS.map(c => c.name))
  for (const f of readdirSync(join(ROOT, 'checks'))) {
    if (!f.endsWith('.mjs') || f === 'run.mjs') continue
    const name = f.replace(/\.mjs$/, '')
    assert.ok(registered.has(name),
      `checks/${f} exists and is not in CHECKS. It will never run, and its own tests will ` +
      `keep passing while the board looks complete.`)
  }
})

// ⛔ AND BOTH DIRECTIONS. A registration whose file has gone is a row that throws on every
// run, or worse, a name somebody trusts that answers nothing.
test('⛔ every registration in run.mjs has a file behind it', async () => {
  const { CHECKS } = await import('../checks/run.mjs')
  const onDisk = new Set(readdirSync(join(ROOT, 'checks')).map(f => f.replace(/\.mjs$/, '')))
  for (const c of CHECKS) {
    assert.ok(onDisk.has(c.name), `CHECKS registers "${c.name}" and checks/${c.name}.mjs does not exist`)
    assert.ok(c.answers && c.answers.length > 20, `"${c.name}" must say what it ANSWERS, in a line somebody can read`)
  }
})
