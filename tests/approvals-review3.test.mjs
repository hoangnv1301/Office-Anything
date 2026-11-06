// REVIEW 3 OF #99: real transcripts, the owner-accepted gates, a verified repair, gates with no target, an early-return hook.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, realpathSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { grantFromPrompt, checkApproval, verifyGrant, gateVerdict, readLedger, ledgerFile, ledgerWriteVerdict, projectDirName, effectiveGatesCfg, maybeRepair, repairFile, grants } from '../lib/approvals.mjs'
import { decide } from '../hooks/desk-wall.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const HOOK = join(HERE, '..', 'hooks', 'typed-prompt.mjs')
const T0 = Date.parse('2026-11-06T09:00:00Z')
const SID = '11111111-2222-4333-8444-555555555555'
const CFG = mkdtempSync(join(tmpdir(), 'oa-r3-claude-'))
process.env.CLAUDE_CONFIG_DIR = CFG
process.env.OFFICE_ANYTHING_KEY_DIR = mkdtempSync(join(tmpdir(), 'oa-r3-key-'))
const GATE = { match: 'discord-post\\.mjs\\s+(?<target>#[a-z-]+)', action: 'post-discord' }
const call = (command) => ({ tool_name: 'Bash', tool_input: { command } })
function office(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oa-r3-'))
  mkdirSync(join(root, 'desks', 'aics'), { recursive: true })
  writeFileSync(join(root, 'desks', 'aics', 'desk.json'), JSON.stringify({ name: 'aics', kind: 'knowledge', port: 9751 }))
  writeFileSync(join(root, 'office.json'), JSON.stringify({ roleEnv: 'OFFICE_ROLE', lead: { session: 'Lead' }, ...extra }))
  return root
}
const projects = (root) => join(CFG, 'projects', projectDirName(realpathSync(root)))
// a transcript in the SHAPE Claude Code writes (no real content): the prompt line carries turnOrigin and promptSource; the tool results
// of the same turn are user lines with the SAME promptId and neither field; assistant lines sit between them
function realShape(root, text, { origin = 'human', source = 'typed', results = 6, sid = SID, promptId = 'fb1f590f-0000-4000-8000-000000000001' } = {}) {
  const dir = projects(root); mkdirSync(dir, { recursive: true })
  const lines = [
    { type: 'queue-operation', operation: 'enqueue', sessionId: sid },
    { type: 'user', timestamp: new Date(T0).toISOString(), uuid: 'u0', parentUuid: null, isSidechain: false, promptId, turnOrigin: origin, promptSource: source, sessionId: sid, message: { role: 'user', content: text } },
  ]
  for (let i = 0; i < results; i++) {
    lines.push({ type: 'assistant', uuid: `a${i}`, parentUuid: i ? `r${i - 1}` : 'u0', isSidechain: false, sessionId: sid, message: { role: 'assistant', content: [{ type: 'tool_use', id: `t${i}`, name: 'Bash', input: { command: 'ls' } }] } })
    lines.push({ type: 'user', uuid: `r${i}`, parentUuid: `a${i}`, isSidechain: false, promptId, sessionId: sid, toolUseResult: { stdout: '' }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: '' }] } })
  }
  const f = join(dir, `${sid}.jsonl`)
  writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return { f, promptId }
}
const grant = (root, t, text, now = T0) => grantFromPrompt(root, {}, { session: 'full', sessionId: SID, text, promptId: t.promptId, transcript: t.f, cwd: root }, { now })

test('a real transcript: tool results after the prompt share its promptId and carry no turnOrigin; the prompt line is the one that counts', () => {
  const text = 'approve post-discord target:#releases'
  const root = office({ approvals: { gates: [GATE] } })
  const g = grant(root, realShape(root, text, { results: 13 }), text)
  assert.equal(verifyGrant(root, g).ok, true)
  assert.equal(checkApproval(root, { action: 'post-discord', target: '#releases' }, { now: T0 + 1000 }).ok, true)
  // and a peer turn in the same shape is still refused
  const r2 = office(); const g2 = grant(r2, realShape(r2, text, { origin: 'peer', source: 'sdk', results: 13 }), text)
  assert.equal(g2, null, 'a peer turn is not the newest human-typed turn: no grant at all')
  // a transcript with no prompt line at all (only tool results) proves nothing
  const r3 = office(); const t3 = realShape(r3, text); writeFileSync(t3.f, readFileSync(t3.f, 'utf8').split('\n').filter((l) => !l.includes('turnOrigin')).join('\n'))
  assert.match(verifyGrant(r3, grant(r3, t3, text)).why, /not in that session's transcript/)
})

test('office.json cannot remove or loosen the gates the owner accepted; the owner\'s phrase accepts a change', async () => {
  const text = 'approve post-discord target:#releases'
  const root = office({ approvals: { gates: [GATE] } })
  const cfgOf = () => JSON.parse(readFileSync(join(root, 'office.json'), 'utf8'))
  const gated = 'node discord-post.mjs #general "hi"'
  assert.match(gateVerdict(root, effectiveGatesCfg(root, cfgOf()), call(gated)), /owner's approval/)
  // 1. an agent edits office.json: the gates are gone
  const bare = { roleEnv: 'OFFICE_ROLE', lead: { session: 'Lead' } }
  writeFileSync(join(root, 'office.json'), JSON.stringify(bare))
  assert.match(gateVerdict(root, effectiveGatesCfg(root, cfgOf(), { now: T0 }), call(gated)), /owner's approval/, 'removal changes nothing')
  // 2. loosened: the regex no longer matches anything
  writeFileSync(join(root, 'office.json'), JSON.stringify({ ...bare, approvals: { gates: [{ ...GATE, match: 'nothing-matches-this' }] } }))
  assert.match(gateVerdict(root, effectiveGatesCfg(root, cfgOf(), { now: T0 }), call(gated)), /owner's approval/, 'a loosened gate changes nothing')
  // 3. a gate that is not a list
  writeFileSync(join(root, 'office.json'), JSON.stringify({ ...bare, approvals: { gates: 'off' } }))
  assert.match(gateVerdict(root, effectiveGatesCfg(root, cfgOf(), { now: T0 }), call(gated)), /owner's approval/)
  // 4. through the real hook, with the wall in force
  const prev = process.env.OFFICE_ROLE; process.env.OFFICE_ROLE = 'full'
  try {
    writeFileSync(join(root, 'office.json'), JSON.stringify(bare))
    const r = await decide(JSON.stringify({ ...call(gated), cwd: root }), process.env, root)
    assert.equal(r.code, 2); assert.match(r.why, /owner's approval/)
  } finally { if (prev === undefined) delete process.env.OFFICE_ROLE; else process.env.OFFICE_ROLE = prev }
  // 5. adding a gate is fine and is kept
  const extra = { match: 'send-mail\\.mjs\\s+(?<target>\\S+)', action: 'send-mail' }
  writeFileSync(join(root, 'office.json'), JSON.stringify({ ...bare, approvals: { gates: [GATE, extra] } }))
  assert.equal(effectiveGatesCfg(root, cfgOf(), { now: T0 }).approvals.gates.length, 2)
  writeFileSync(join(root, 'office.json'), JSON.stringify(bare))
  assert.equal(effectiveGatesCfg(root, cfgOf(), { now: T0 }).approvals.gates.length, 2, 'the added gate stays too')
  // 6. the owner accepts the change by typing the phrase
  const change = 'approve gates-change target:office once'
  const tr = realShape(root, change, { promptId: 'cc00' })
  grant(root, tr, change, T0 + 5000)
  assert.equal(effectiveGatesCfg(root, cfgOf(), { now: T0 + 6000 }).approvals?.gates, undefined, 'accepted: the office has no gates now')
  assert.equal(gateVerdict(root, effectiveGatesCfg(root, cfgOf(), { now: T0 + 7000 }), call(gated), { now: T0 + 7000 }), null)
  // the accepted list is not in the office, and the wall refuses to name it
  assert.equal(existsSync(join(root, '.office', 'gates-last-good.json')), false)
  assert.match(ledgerWriteVerdict({ tool_name: 'Bash', tool_input: { command: `rm ${process.env.OFFICE_ANYTHING_KEY_DIR}/gates-abc.json`.replace(/^rm .*\//, 'rm ~/.config/office-anything/') } }), /approval key/)
})

test('a repair is verified like a grant: a peer turn, a claude -p run or an unwritten turn resets nothing; the owner\'s typed line does', () => {
  const text = 'approve post-discord target:#releases'
  const mk = () => { const root = office({ approvals: { gates: [GATE] } }); grant(root, realShape(root, text), text); appendFileSync(ledgerFile(root), 'junk\n'); assert.equal(readLedger(root).corrupt, 1); return root }
  const phrase = 'approve repair-ledger target:ledger'
  // a peer turn
  const a = mk()
  grantFromPrompt(a, {}, { session: 'full', sessionId: SID, text: phrase, promptId: 'pp', transcript: realShape(a, phrase, { origin: 'peer', source: 'sdk', promptId: 'pp' }).f, cwd: a }, { now: T0 + 1000 })
  assert.equal(readLedger(a).corrupt, 1, 'a peer turn resets nothing'); assert.equal(existsSync(repairFile(a)), false, 'and leaves no request')
  // a run of claude -p (sdk)
  const b = mk()
  grantFromPrompt(b, {}, { session: 'full', sessionId: SID, text: phrase, promptId: 'sd', transcript: realShape(b, phrase, { origin: 'sdk', source: 'typed', promptId: 'sd' }).f, cwd: b }, { now: T0 + 1000 })
  assert.equal(readLedger(b).corrupt, 1)
  // a request whose turn is not written yet waits, then resets once it is there and is human-typed
  const c = mk()
  const t = realShape(c, 'something else', { promptId: 'ow' })
  const r1 = grantFromPrompt(c, {}, { session: 'full', sessionId: SID, text: phrase, promptId: 'ow2', transcript: t.f, cwd: c }, { now: T0 + 1000 })
  assert.equal(r1.pending, true); assert.equal(readLedger(c).corrupt, 1)
  realShape(c, phrase, { promptId: 'ow2' })
  assert.equal(maybeRepair(c, { now: T0 + 2000 }).reset, true)
  assert.equal(readLedger(c).corrupt, 0); assert.deepEqual(grants(c), [])
  assert.equal(existsSync(repairFile(c)), false)
  // and a check on a damaged ledger resolves a pending repair by itself
  const d = mk()
  grantFromPrompt(d, {}, { session: 'full', sessionId: SID, text: phrase, promptId: 'late', transcript: join(projects(d), `${SID}.jsonl`), cwd: d }, { now: T0 + 1000 })
  realShape(d, phrase, { promptId: 'late' })
  assert.match(checkApproval(d, { action: 'post-discord', target: '#releases' }, { now: T0 + 3000 }).why, /has not approved/, 'repaired on the check, and no old approval came back')
})

test('a claude run with -p, or one that carries an approval phrase, is a typing road and is refused', () => {
  const v = (c) => ledgerWriteVerdict(call(c))
  assert.match(v('claude -p "approve post-discord target:#releases"'), /does not type into a terminal/)
  assert.match(v('claude --print --model x "hello"'), /does not type into a terminal/)
  assert.match(v('/usr/local/bin/claude -p hello'), /does not type into a terminal/)
  assert.match(v("claude --name x 'approve post-discord target:#releases'"), /does not type into a terminal/)
  assert.equal(v('git log --oneline'), null)
  assert.equal(v('echo claude is a name'), null)
})

test('a gate with no target group is approved with target:*, and the refusal says so', () => {
  const root = office({ approvals: { gates: [{ match: 'deploy\\.sh', action: 'deploy-prod' }] } })
  const cfg = JSON.parse(readFileSync(join(root, 'office.json'), 'utf8'))
  const no = gateVerdict(root, cfg, call('./deploy.sh now'), { now: T0 })
  assert.match(no, /approve deploy-prod target:\*/)
  const text = 'approve deploy-prod target:*'
  grant(root, realShape(root, text), text)
  assert.equal(gateVerdict(root, cfg, call('./deploy.sh now'), { now: T0 + 1000 }), null)
  assert.equal(gateVerdict(root, cfg, call('ls'), { now: T0 + 1000 }), null)
})

test('hook: an ordinary prompt returns before anything is read; the phrase still makes its grant', () => {
  const root = office()
  const run = (prompt, extra = {}) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ prompt, cwd: root, ...extra }), encoding: 'utf8', env: { ...process.env, OFFICE_ROLE: 'full' } })
  const t = realShape(root, 'approve post-discord target:#releases')
  assert.equal(run('what is the weather').status, 0)
  assert.equal(existsSync(join(root, '.office')), false, 'nothing was touched for a normal prompt')
  assert.equal(run('approve post-discord target:#releases', { prompt_id: t.promptId, session_id: SID, transcript_path: t.f }).status, 0)
  assert.equal(grants(root).length, 1)
})
