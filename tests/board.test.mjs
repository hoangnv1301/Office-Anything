// ⛔ THE BOARD MUST BE TESTABLE WITHOUT A BROWSER, A SERVER OR THIS MACHINE'S
// TMP. Readers take injected roots; render is a pure function; the server is
// smoked once on an ephemeral port.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { slugFor, transcriptStats, worktop, gatherOffice } from '../board/read.mjs'
import { render } from '../board/page.mjs'
import { makeServer } from '../board/serve.mjs'

test('the slug is Claude Code\'s own: slashes and spaces flatten to dashes', () => {
  assert.equal(slugFor('/Volumes/Extreme SSD/x/repo'), '-Volumes-Extreme-SSD-x-repo')
})

test('transcript stats come from the NEWEST session, and a torn line is normal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oa-tx-'))
  const line = (usage, model) => JSON.stringify({ message: { usage, model } }) + '\n'
  writeFileSync(join(dir, 'old.jsonl'), line({ input_tokens: 999999, output_tokens: 1 }, 'ancient'))
  writeFileSync(join(dir, 'new.jsonl'),
    line({ input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5000 }, 'claude-opus-5')
    + line({ input_tokens: 50, output_tokens: 10 }, 'claude-opus-5')
    + '{"message":{"usage":{"input_tokens": 7')            // torn mid-write
  const s = transcriptStats(dir)
  assert.equal(s.sessions, 2)
  assert.equal(s.model, 'claude-opus-5')
  assert.equal(s.turns, 2, 'the torn line is skipped, not counted and not fatal')
  assert.equal(s.input, 150)
  assert.equal(s.cacheRead, 5000)
})

test('a desk that never ran reports null, not zeros pretending to be facts', () => {
  assert.equal(transcriptStats(join(tmpdir(), 'oa-definitely-not-here')), null)
})

test('the worktop reads the newest session\'s scratchpad, empty is the truth', () => {
  const base = mkdtempSync(join(tmpdir(), 'oa-wt-'))
  mkdirSync(join(base, 'aaa-old', 'scratchpad'), { recursive: true })
  writeFileSync(join(base, 'aaa-old', 'scratchpad', 'stale.txt'), 'x')
  const newer = join(base, 'bbb-new', 'scratchpad')
  mkdirSync(newer, { recursive: true })
  writeFileSync(join(newer, 'draft.md'), 'y')
  const files = worktop(base)
  assert.deepEqual(files.map((f) => f.name), ['draft.md'], 'only the newest session is the live worktop')
  assert.deepEqual(worktop(join(base, 'nowhere')), [])
})

const office = () => {
  const root = mkdtempSync(join(tmpdir(), 'oa-office-'))
  mkdirSync(join(root, 'desks', 'billing'), { recursive: true })
  writeFileSync(join(root, 'desks', 'billing', 'desk.json'),
    JSON.stringify({ name: 'billing', kind: 'knowledge', port: 9231, live: false }))
  return root
}

test('gatherOffice walks the roster and survives a machine with no transcripts', () => {
  const o = gatherOffice(office(), { home: mkdtempSync(join(tmpdir(), 'oa-h-')), tmp: mkdtempSync(join(tmpdir(), 'oa-t-')) })
  assert.equal(o.desks.length, 1)
  assert.equal(o.desks[0].stats, null)
  assert.deepEqual(o.desks[0].worktop, [])
})

test('render is pure, escapes, and shows an unreadable desk as a loud row', () => {
  const html = render({
    root: '/x', generatedAt: 0,
    desks: [{ name: 'b<b>', kind: 'knowledge', port: 1, live: true, stats: null, idleMin: null, worktop: [] }],
    broken: [{ desk: 'oops', why: 'not valid JSON' }],
  }, { rows: [{ name: 'send-wall', code: 4, applicable: true, why: 'a finding' }] })
  assert.ok(html.includes('b&lt;b&gt;'), 'desk names are escaped')
  assert.ok(html.includes('LIVE'))
  assert.ok(html.includes('oops'))
  assert.ok(html.includes('send-wall'))
  assert.ok(!html.includes('<b>'.repeat(2)))
})

test('the server answers on loopback with the office it was pointed at', async () => {
  const root = office()
  const srv = makeServer(root)
  await new Promise((res) => srv.listen(0, '127.0.0.1', res))
  const { port } = srv.address()
  const body = await (await fetch(`http://127.0.0.1:${port}`)).text()
  srv.close()
  assert.ok(body.includes('billing'), 'the page lists the pointed-at office, not the cwd')
})
