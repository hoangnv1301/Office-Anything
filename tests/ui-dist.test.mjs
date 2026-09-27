// THE BUILT UI SHIPS IN THE REPO. board/serve.mjs serves board/ui/dist, and
// `claude plugin install` from GitHub copies only what git tracks. dist sat in
// board/ui/.gitignore, so a GitHub install (2026-09-27, 0.7.31) had a board
// with no page: the first request threw after its headers went out and took
// the server down. The directory-sourced marketplace had hidden it by copying
// the untracked build from the maintainer's disk.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'board', 'ui', 'dist')

test('git tracks the built UI, so an install from GitHub has a page to serve', () => {
  const tracked = execFileSync('git', ['ls-files', 'board/ui/dist'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
  assert.ok(tracked.includes('board/ui/dist/index.html'), 'dist/index.html is not in git')
})

test('every file the built page references exists beside it', () => {
  const html = readFileSync(join(dist, 'index.html'), 'utf8')
  const refs = [...html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map((m) => m[1])
  assert.ok(refs.length > 0, 'index.html references nothing: not a built page')
  for (const r of refs) assert.ok(existsSync(join(dist, r)), 'missing ' + r)
})

test('a route that throws after its headers went out does not take the board down', async () => {
  // the same install: `/` wrote its headers, then readFileSync(dist/index.html)
  // threw, and the catch-all's own writeHead threw ERR_HTTP_HEADERS_SENT
  // outside any handler. A board copy with no dist reproduces it exactly.
  const { mkdtempSync, cpSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const copy = mkdtempSync(join(tmpdir(), 'oa-nodist-'))
  for (const d of ['board', 'lib', 'checks']) cpSync(join(root, d), join(copy, d), { recursive: true, filter: (p) => !p.includes(join('ui', 'dist')) && !p.includes('node_modules') })
  const { makeServer } = await import(join(copy, 'board', 'serve.mjs'))
  const srv = makeServer(root)
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const base = 'http://127.0.0.1:' + srv.address().port
  await fetch(base + '/').then((r) => r.text()).catch(() => null)
  const alive = await fetch(base + '/api/version').then((r) => r.status).catch(() => 0)
  srv.closeAllConnections(); srv.close()
  assert.equal(alive, 200, 'the server answers the next request')
})
