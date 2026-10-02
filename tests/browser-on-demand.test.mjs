// A BROWSER STARTS WHEN A TOOL NEEDS IT, never because a session began. The
// owner's screen filled with a Chrome per desk at every start-up, for desks
// that never opened a page.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { report, launchIn } from '../checks/browser-on-demand.mjs'

function office() {
  const root = mkdtempSync(join(tmpdir(), 'oa-bod-'))
  for (const n of ['chat', 'pricing']) {
    mkdirSync(join(root, 'desks', n, '.claude'), { recursive: true })
    writeFileSync(join(root, 'desks', n, 'desk.json'), JSON.stringify({ name: n, kind: n === 'chat' ? 'channel' : 'knowledge', port: n === 'chat' ? 9230 : 9231 }))
  }
  return root
}
const hooks = (event, command) => JSON.stringify({ hooks: { [event]: [{ hooks: [{ type: 'command', command }] }] } })

test('a start-up hook that opens a browser is a finding, named by desk and by what it ran', () => {
  const root = office()
  writeFileSync(join(root, 'desks', 'chat', '.claude', 'settings.json'), hooks('SessionStart', 'open -a "Google Chrome" http://127.0.0.1:7719/hello?desk=chat'))
  const r = report(root)
  assert.equal(r.code, 4)
  assert.equal(r.findings.length, 1)
  assert.equal(r.findings[0].desk, 'chat')
  assert.match(r.findings[0].say, /SessionStart hook starts a browser/)
})

test('the script a hook runs is read too, one level deep', () => {
  const root = office()
  mkdirSync(join(root, 'desks', 'hooks'), { recursive: true })
  writeFileSync(join(root, 'desks', 'hooks', 'boot.mjs'), "spawn(chrome, ['--remote-debugging-port=9230', '--user-data-dir=/x'])\n")
  writeFileSync(join(root, 'desks', 'pricing', '.claude', 'settings.json'), hooks('SessionStart', 'node "$CLAUDE_PROJECT_DIR/../hooks/boot.mjs"'))
  // the form real desks use to name the office root from inside desks/<name>
  writeFileSync(join(root, 'desks', 'chat', '.claude', 'settings.json'), hooks('SessionStart', 'node "${CLAUDE_PROJECT_DIR%%/desks/*}/desks/hooks/boot.mjs" || true'))
  const r = report(root)
  assert.equal(r.findings.length, 2, 'both spellings of the path reach the script')
  assert.equal(r.code, 4)
  assert.match(r.findings[0].say, /--remote-debugging-port/)
  assert.match(r.findings[0].say, /desks\/hooks\/boot\.mjs/)
})

test('a browser started by a TOOL hook, or no hook at all, is the rule working', () => {
  const root = office()
  writeFileSync(join(root, 'desks', 'chat', '.claude', 'settings.json'), hooks('PreToolUse', 'open -a "Google Chrome"'))
  assert.equal(report(root).code, 0, 'PreToolUse fires because a tool was called: that is on demand')
  assert.equal(report(office()).code, 0)
  assert.equal(report(mkdtempSync(join(tmpdir(), 'oa-none-'))).applicable, false)
})

test('the launch shapes it knows, and the near misses it must not flag', () => {
  for (const s of ['chrome --remote-debugging-port=9223', 'open -a Safari', 'open https://x.test', 'xdg-open http://x', 'await chromium.launch({ headless: false })', 'puppeteer.launch()', 'chromium.launchPersistentContext(dir)'])
    assert.ok(launchIn(s), s)
  for (const s of ['openFile(path)', 'node scripts/open-orders.mjs', 'reopen the ticket', 'fetch("http://127.0.0.1:9223/json")'])
    assert.equal(launchIn(s), null, s)
})
