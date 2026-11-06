// REVIEW 4 OF #99: replaying an old owner prompt by running the hook by hand, once-only gate and repair approvals, the pending file.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { grantFromPrompt, verifyGrant, gateVerdict, ledgerWriteVerdict, projectDirName, effectiveGatesCfg, grants, readLedger, ledgerFile } from '../lib/approvals.mjs'
import { appendFileSync } from 'node:fs'

const HERE = dirname(fileURLToPath(import.meta.url))
const HOOK = join(HERE, '..', 'hooks', 'typed-prompt.mjs')
const T0 = Date.parse('2026-11-06T09:00:00Z')
const MIN = 60_000
const SID = '11111111-2222-4333-8444-555555555555'
const CFG = mkdtempSync(join(tmpdir(), 'oa-r4-claude-'))
process.env.CLAUDE_CONFIG_DIR = CFG
process.env.OFFICE_ANYTHING_KEY_DIR = mkdtempSync(join(tmpdir(), 'oa-r4-key-'))
const GATE = { match: 'discord-post\\.mjs\\s+(?<target>#[a-z-]+)', action: 'post-discord' }
const call = (command) => ({ tool_name: 'Bash', tool_input: { command } })
function office(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oa-r4-'))
  mkdirSync(join(root, 'desks', 'aics'), { recursive: true })
  writeFileSync(join(root, 'desks', 'aics', 'desk.json'), JSON.stringify({ name: 'aics', kind: 'knowledge', port: 9761 }))
  writeFileSync(join(root, 'office.json'), JSON.stringify({ roleEnv: 'OFFICE_ROLE', lead: { session: 'Lead' }, ...extra }))
  return root
}
const projects = (root) => join(CFG, 'projects', projectDirName(realpathSync(root)))
// the turns of one session, each a prompt line with its timestamp (ms), as Claude Code writes them
function session(root, turns, sid = SID) {
  const dir = projects(root); mkdirSync(dir, { recursive: true })
  const f = join(dir, `${sid}.jsonl`)
  writeFileSync(f, turns.map(([promptId, text, at, extra = {}]) => JSON.stringify({ type: 'user', timestamp: at === undefined ? undefined : new Date(at).toISOString(), promptId, turnOrigin: 'human', promptSource: 'typed', sessionId: sid, message: { role: 'user', content: text }, ...extra })).join('\n') + '\n')
  return f
}
const run = (root, f, text, promptId, now) => grantFromPrompt(root, {}, { session: 'full', sessionId: SID, text, promptId, transcript: f, cwd: root }, { now })
const TEXT = 'approve post-discord target:#releases'

test('replay: an old owner prompt\'s real ids cannot be turned into a fresh grant', () => {
  const root = office({ approvals: { gates: [GATE] } })
  const f = session(root, [['old1', TEXT, T0]])
  // the hook run by hand a day later, with the old turn's ids: the grant is dated then, the turn is from T0
  const late = run(root, f, TEXT, 'old1', T0 + 24 * 60 * MIN)
  assert.match(verifyGrant(root, late).why, /minutes from the turn it cites/)
  // ... and the same ids cannot make a second grant, even a well-timed one
  assert.equal(run(root, f, TEXT, 'old1', T0 + 1000), null, 'one grant per session and prompt, ever')
  // a turn with no timestamp cannot hold a grant's time
  const root2 = office(); const f2 = session(root2, [['n1', TEXT, undefined]])
  assert.match(verifyGrant(root2, run(root2, f2, TEXT, 'n1', T0)).why, /no timestamp/)
  // the real thing: typed now, granted now
  const root3 = office(); const f3 = session(root3, [['ok1', TEXT, T0]])
  assert.equal(verifyGrant(root3, run(root3, f3, TEXT, 'ok1', T0 + 2000)).ok, true)
})

test('the used-prompt list is kept beside the key and survives a reset of the ledger', () => {
  const root = office()
  let f = session(root, [['p1', TEXT, T0]])
  assert.ok(run(root, f, TEXT, 'p1', T0 + 1000))
  f = session(root, [['p1', TEXT, T0], ['rp', 'approve repair-ledger target:ledger', T0 + 5000]])
  appendFileSync(ledgerFile(root), 'junk\n')
  assert.equal(readLedger(root).corrupt, 1)
  assert.equal(run(root, f, 'approve repair-ledger target:ledger', 'rp', T0 + 6000).reset, true)
  assert.equal(readLedger(root).corrupt, 0); assert.deepEqual(grants(root), [])
  assert.equal(run(root, f, TEXT, 'p1', T0 + 7000), null, 'the reset forgot the grant, not that its prompt was used')
  assert.equal(run(root, f, 'approve repair-ledger target:ledger', 'rp', T0 + 8000), null, 'a repair prompt works once too')
})

test('the hook run by hand with an old prompt\'s ids makes nothing, and a tool call that runs a hook is refused', () => {
  const root = office()
  const f = session(root, [['old2', TEXT, Date.now() - 3 * 3600_000]])
  const payload = { prompt: TEXT, cwd: root, prompt_id: 'old2', session_id: SID, transcript_path: f }
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, OFFICE_ROLE: 'full' } })
  assert.equal(r.status, 0)
  assert.equal(grants(root).length === 0 || verifyGrant(root, grants(root)[0]).ok === false, true, 'nothing that verifies')
  const v = (c) => ledgerWriteVerdict(call(c))
  assert.match(v('LCC_ROLE=lead node /p/office-anything/hooks/typed-prompt.mjs < p.json'), /run by Claude Code, never by hand/)
  assert.match(v('node hooks/desk-wall.mjs < payload.json'), /never by hand/)
  assert.match(v(`node -e "import('/p/hooks/typed-prompt.mjs')"`), /never by hand/)
  assert.match(v('cd /p && node --input-type=module hooks/typed-prompt.mjs'), /never by hand/)
  assert.equal(v('cat hooks/typed-prompt.mjs'), null)
  assert.equal(v('node --test tests/approvals.test.mjs'), null)
  assert.equal(v('git log -- hooks/typed-prompt.mjs'), null)
})

test('gates-change and repair-ledger are single use: one acceptance, never a window', () => {
  const root = office({ approvals: { gates: [GATE, { match: 'mail\\.mjs\\s+(?<target>\\S+)', action: 'send-mail' }] } })
  const cfgOf = () => JSON.parse(readFileSync(join(root, 'office.json'), 'utf8'))
  const bare = { roleEnv: 'OFFICE_ROLE', lead: { session: 'Lead' } }
  effectiveGatesCfg(root, cfgOf(), { now: T0 })                       // the owner-accepted list: two gates
  const f = session(root, [['g1', 'approve gates-change target:office hours:24', T0 + MIN]])
  const g = run(root, f, 'approve gates-change target:office hours:24', 'g1', T0 + MIN)
  assert.equal(g.max, 1, 'the owner did not say once; the action is once-only anyway')
  writeFileSync(join(root, 'office.json'), JSON.stringify({ ...bare, approvals: { gates: [GATE] } }))       // one gate dropped
  assert.equal(effectiveGatesCfg(root, cfgOf(), { now: T0 + 2 * MIN }).approvals.gates.length, 1, 'accepted')
  // the next removal, an hour later in the 24 h window, is not accepted
  writeFileSync(join(root, 'office.json'), JSON.stringify(bare))
  const again = effectiveGatesCfg(root, cfgOf(), { now: T0 + 60 * MIN })
  assert.equal(again.approvals.gates.length, 1, 'the one accepted gate keeps applying')
  assert.match(gateVerdict(root, again, call('node discord-post.mjs #general "x"'), { now: T0 + 60 * MIN }), /owner's approval/)
})

test('a broken added gate says how the owner accepts a change', () => {
  const root = office({ approvals: { gates: [GATE, { match: '(unclosed', action: 'x-broken' }] } })
  const cfg = JSON.parse(readFileSync(join(root, 'office.json'), 'utf8'))
  assert.match(gateVerdict(root, cfg, call('ls'), { now: T0 }), /approve gates-change target:office/)
})

test('the pending repair file is wall-protected like the ledger', () => {
  assert.match(ledgerWriteVerdict({ tool_name: 'Write', tool_input: { file_path: '/o/.office/repair-pending.json' } }), /ledger/)
  assert.match(ledgerWriteVerdict(call("echo '{}' > .office/repair-pending.json")), /ledger/)
  assert.match(ledgerWriteVerdict(call("cd .office && echo '{}' > repair-pending.json")), /ledger/)
  assert.equal(ledgerWriteVerdict(call('cat .office/repair-pending.json')), null)
})
