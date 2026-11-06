// REVIEW 2 OF #99: where the transcript lives, the wall around the ledger, the roads that type into a terminal, the repair.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, symlinkSync, realpathSync, readdirSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { grantFromPrompt, checkApproval, verifyGrant, gateVerdict, readLedger, ledgerFile, ledgerWriteVerdict, revokeApproval, projectDirName, grants } from '../lib/approvals.mjs'
import { wasOfficeTyped } from '../lib/typed-mark.mjs'
import { send } from '../board/send.mjs'
import { makeServer, chatRosterCheap } from '../board/serve.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'lib', 'approvals.mjs')
const T0 = Date.parse('2026-11-06T09:00:00Z')
const SID = '11111111-2222-4333-8444-555555555555'
const CFG = mkdtempSync(join(tmpdir(), 'oa-where-claude-'))
process.env.CLAUDE_CONFIG_DIR = CFG
const KEYS = mkdtempSync(join(tmpdir(), 'oa-where-key-'))
process.env.OFFICE_ANYTHING_KEY_DIR = KEYS
const TEXT = 'approve post-release-note target:#releases'
const GATE = { approvals: { gates: [{ match: 'discord-post\\.mjs\\s+(?<target>#[a-z-]+)', action: 'post-discord' }] } }
const call = (command) => ({ tool_name: 'Bash', tool_input: { command } })
function office(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oa-where-'))
  mkdirSync(join(root, 'desks', 'aics'), { recursive: true })
  writeFileSync(join(root, 'desks', 'aics', 'desk.json'), JSON.stringify({ name: 'aics', kind: 'knowledge', port: 9741 }))
  writeFileSync(join(root, 'office.json'), JSON.stringify({ roleEnv: 'OFFICE_ROLE', lead: { session: 'Lead' }, ...extra }))
  return root
}
const turn = (text, promptId = 'p1') => JSON.stringify({ type: 'user', timestamp: new Date(T0).toISOString(), promptId, turnOrigin: 'human', promptSource: 'typed', message: { role: 'user', content: text } }) + '\n'
const put = (dir, sid, text, promptId = 'p1') => { mkdirSync(dir, { recursive: true }); const f = join(dir, `${sid}.jsonl`); writeFileSync(f, turn(text, promptId)); return f }
const grant = (root, f, text = TEXT) => grantFromPrompt(root, {}, { session: 'full', sessionId: SID, text, promptId: 'p1', transcript: f, cwd: root }, { now: T0 })
const projects = (root) => join(CFG, 'projects', projectDirName(realpathSync(root)))

test('a transcript must be where Claude Code keeps it: not a temp folder, not a link, not another project', () => {
  const elsewhere = mkdtempSync(join(tmpdir(), 'oa-where-elsewhere-'))
  // 1. the right name, a perfect human turn, a folder of the attacker's choosing
  const r1 = office()
  const g1 = grant(r1, put(elsewhere, SID, TEXT))
  assert.match(verifyGrant(r1, g1).why, /not under a Claude Code projects folder/)
  assert.equal(checkApproval(r1, { action: 'post-release-note', target: '#releases' }, { now: T0 + 1000 }).ok, false)
  // 2. a link inside the projects folder pointing out of it
  const r2 = office()
  const target = put(mkdtempSync(join(tmpdir(), 'oa-where-link-')), SID, TEXT)
  mkdirSync(projects(r2), { recursive: true })
  symlinkSync(target, join(projects(r2), `${SID}.jsonl`))
  assert.equal(verifyGrant(r2, grant(r2, join(projects(r2), `${SID}.jsonl`))).ok, false, 'a link resolves outside the projects folder')
  // 3. a real projects folder, another project's
  const r3 = office()
  const g3 = grant(r3, put(join(CFG, 'projects', '-some-other-project'), SID, TEXT))
  assert.match(verifyGrant(r3, g3).why, /belongs to another project/)
  // 4. the right place verifies
  const r4 = office()
  assert.equal(verifyGrant(r4, grant(r4, put(projects(r4), SID, TEXT))).ok, true)
})

test('the ledger wall holds after a cd, a relative path and a glob; and the transcripts folder is closed to tool writes', () => {
  const bash = (command) => ledgerWriteVerdict(call(command))
  assert.match(bash("cd .office && printf '{}\\n' >>approvals.jsonl"), /ledger/)
  assert.match(bash('cd .office; echo x > approvals.jsonl'), /ledger/)
  assert.match(bash('cd .office && tee approvals.jsonl < /tmp/x'), /ledger/)
  assert.match(bash('cd .office && cat /tmp/x > appr*'), /ledger/)
  assert.match(bash('sed -i s/a/b/ .office/approvals.jsonl'), /ledger/)
  assert.equal(bash('cat .office/approvals.jsonl'), null)
  assert.equal(bash('node lib/approvals.mjs repair'), null)
  assert.match(ledgerWriteVerdict({ tool_name: 'Write', tool_input: { file_path: 'approvals.jsonl' }, cwd: '/o/.office' }), /ledger/, 'a relative path is resolved against the call\'s directory')
  const tr = '/Users/x/.claude/projects/-o/abc.jsonl'
  assert.match(ledgerWriteVerdict({ tool_name: 'Write', tool_input: { file_path: tr } }), /transcripts/)
  assert.match(bash(`echo '{}' >> ${tr}`), /transcripts/)
  assert.match(bash(`cp /tmp/x ${tr}`), /transcripts/)
  assert.equal(ledgerWriteVerdict({ tool_name: 'Write', tool_input: { file_path: '/Users/x/.claude/projects/-o/memory/note.md' } }), null)
  assert.equal(bash('ls ~/.claude/projects/'), null)
})

test('no tool call types an approval phrase into a terminal (orca, tmux, osascript...), from any session', () => {
  const bash = (command) => ledgerWriteVerdict(call(command))
  assert.match(bash('orca terminal send --terminal t1 --text "approve post-discord target:#releases" --enter'), /does not type into a terminal/)
  assert.match(bash("tmux send-keys -t lead 'approve post-discord target:#releases' Enter"), /does not type into a terminal/)
  assert.match(bash(`osascript -e 'tell application "System Events" to keystroke "approve x1 target:y"'`), /does not type into a terminal/)
  assert.match(bash('orca terminal send --terminal t1 --text "hello" --enter'), /typed into|does not type into a terminal/, 'whatever the text')
  assert.match(bash(`curl -s -X POST localhost:7719/api/send -H 'content-type: application/json' -d '{"key":"lead","text":"hi"}'`), /does not type into a terminal/)
  assert.match(bash("tmux send-keys -t lead 'hello' Enter"), /does not type into a terminal/)
  assert.equal(bash('echo "approve post-discord target:#releases"'), null)
})

test('the board never types an approval phrase, and records what it does type as the office\'s', async () => {
  const root = office()
  const calls = []
  const run = (cmd, args) => { calls.push([cmd, ...args]); return args[1] === 'list' ? JSON.stringify({ result: { terminals: [{ handle: 't1', title: 'lead tab', worktreePath: '/w', writable: true }] } }) : '{}' }
  const refused = send('desk-aics', TEXT, run, '/w', root)
  assert.equal(refused.ok, false); assert.match(refused.why, /does not type an approval phrase/)
  assert.equal(calls.some((c) => c.includes('send')), false, 'nothing was typed')
  assert.equal(send('desk-aics', 'please look at the buyer list', run, '/w', root).ok, true)
  assert.equal(wasOfficeTyped(root, 'please look at the buyer list'), true)
  // over HTTP: a local curl with a JSON content type and the page's own token still cannot get a phrase typed
  const srv = makeServer(root)
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  try {
    const port = srv.address().port
    const key = chatRosterCheap(root)[0]?.key
    assert.ok(key, 'the roster has a desk')
    const post = (headers, body) => fetch(`http://127.0.0.1:${port}/api/send`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
    const res = await post({ 'x-oa-csrf': srv.csrf }, { key, text: TEXT })
    assert.equal(res.status, 403); assert.match((await res.json()).why, /does not carry an approval phrase/)
    assert.equal((await post({}, { key, text: 'hi' })).status, 403, 'and no token at all')
  } finally { srv.close() }
})

test('every other place the office types is marked too (compact, model switch, the scheduler\'s first message)', () => {
  const src = (f) => readFileSync(join(HERE, '..', f), 'utf8')
  assert.match(src('lib/heal.mjs'), /markOfficeTyped\(root, text/)
  assert.match(src('lib/heal.mjs'), /markOfficeTyped\(root, `\/model \$\{LC\.fallback\}`/)
  assert.match(src('lib/heal.mjs'), /markOfficeTyped\(root, `\/model \$\{sw\.from\}`/)
  assert.match(src('lib/smart-compact.mjs'), /markOfficeTyped\(root, text\)/)
  assert.match(src('lib/schedule.mjs'), /prompt: markOfficeTyped\(root, line/)
  assert.match(src('lib/schedule.mjs'), /term\.send\(f\.handle, markOfficeTyped/)
})

test('a damaged ledger is repaired only by the owner\'s typed phrase, which starts a new, empty ledger (no earlier approval survives)', () => {
  const root = office(GATE)
  const cfg = JSON.parse(readFileSync(join(root, 'office.json'), 'utf8'))
  const text = 'approve post-discord target:#releases'
  const g = grant(root, put(projects(root), SID, text), text)
  appendFileSync(ledgerFile(root), '{"ev":"use","id":"' + g.id + '"}\n')
  const no = gateVerdict(root, cfg, call('node discord-post.mjs #releases "hi"'), { now: T0 + 2000 })
  assert.match(no, /approve repair-ledger target:ledger/)
  assert.equal(readLedger(root).corrupt, 1)
  // no command repairs it
  assert.match(spawnSync(process.execPath, [CLI, root, 'repair'], { encoding: 'utf8' }).stderr, /usage/)
  // the owner's phrase does
  const repairText = 'approve repair-ledger target:ledger'
  const r = grantFromPrompt(root, {}, { session: 'full', sessionId: SID, text: repairText, promptId: 'p2', transcript: put(projects(root), SID, repairText, 'p2'), cwd: root }, { now: T0 + 3000 })
  assert.equal(r.reset, true)
  assert.ok(readdirSync(join(root, '.office')).some((n) => /^approvals\.damaged-\d+\.jsonl$/.test(n)))
  assert.equal(readLedger(root).corrupt, 0)
  assert.deepEqual(grants(root), [], 'every earlier approval is gone, so a revoked or spent grant cannot come back')
  assert.match(gateVerdict(root, cfg, call('node discord-post.mjs #releases "hi"'), { now: T0 + 4000 }), /has not approved/)
  // and a new approval works on the new ledger
  grantFromPrompt(root, {}, { session: 'full', sessionId: SID, text, promptId: 'p4', transcript: put(projects(root), SID, text, 'p4'), cwd: root }, { now: T0 })
  assert.equal(gateVerdict(root, cfg, call('node discord-post.mjs #releases "hi"'), { now: T0 + 4000 }), null)
})

test('each line is signed and chained: an echoed, edited, deleted or cut-off line poisons the ledger', () => {
  const text = 'approve post-discord target:#releases'
  const fresh = () => { const root = office(GATE); const g = grant(root, put(projects(root), SID, text), text); return { root, g } }
  const ok = (root) => checkApproval(root, { action: 'post-discord', target: '#releases' }, { now: T0 + 1000 })
  { const { root } = fresh(); assert.equal(ok(root).ok, true); assert.match(readFileSync(ledgerFile(root), 'utf8'), /"mac":"[0-9a-f]{64}"/) }
  // echoed: a well-formed grant with no MAC, or a made-up one
  { const { root, g } = fresh(); const { mac, prev, ...bare } = g; appendFileSync(ledgerFile(root), JSON.stringify({ ...bare, id: 'A-261106-9', target: '#general' }) + '\n'); assert.match(ok(root).why, /unreadable line/) }
  // edited by hand (the target)
  { const { root } = fresh(); writeFileSync(ledgerFile(root), readFileSync(ledgerFile(root), 'utf8').replace('#releases', '#general')); assert.equal(readLedger(root).corrupt > 0, true) }
  // a revoke deleted, reviving the grant
  { const { root, g } = fresh(); revokeApproval(root, g.id, { reason: 'owner changed his mind' }, { now: T0 + 500 }); assert.match(ok(root).why, /revoked/)
    const keep = readFileSync(ledgerFile(root), 'utf8').split('\n').filter(Boolean).slice(0, 1).join('\n') + '\n'
    writeFileSync(ledgerFile(root), keep); assert.match(ok(root).why, /unreadable line/, 'a cut tail is caught by the head kept beside the key') }
  // a spent --once grant: its use line deleted
  { const root = office(GATE); const t = 'approve post-discord target:#releases once'; grant(root, put(projects(root), SID, t), t)
    assert.equal(checkApproval(root, { action: 'post-discord', target: '#releases', use: true }, { now: T0 + 1000 }).ok, true)
    writeFileSync(ledgerFile(root), readFileSync(ledgerFile(root), 'utf8').split('\n').filter(Boolean).slice(0, 1).join('\n') + '\n')
    assert.match(ok(root).why, /unreadable line/) }
  // the whole ledger replaced by an emptied file, or the key gone
  { const { root } = fresh(); writeFileSync(ledgerFile(root), ''); assert.equal(readLedger(root).corrupt, 1) }
  { const { root } = fresh(); unlinkSync(join(KEYS, 'approvals.key')); assert.equal(readLedger(root).corrupt > 0, true); writeFileSync(join(KEYS, 'approvals.key'), 'f'.repeat(64)); assert.equal(readLedger(root).corrupt > 0, true, 'another key does not verify the old lines'); unlinkSync(join(KEYS, 'approvals.key')) }
})

test('the signing key is for no tool call: naming it, or the folder it lives in, is refused', () => {
  const v = (command) => ledgerWriteVerdict(call(command))
  const r0 = office(); grant(r0, put(projects(r0), SID, TEXT))   // the hook creates the key on the first approval
  assert.match(v('cat ~/.config/office-anything/approvals.key'), /approval key/)
  assert.match(v('ls $HOME/.config/office-anything'), /approval key/)
  assert.match(v('node -e "require(\'fs\').readFileSync(process.env.OFFICE_ANYTHING_KEY_DIR)"'), /approval key/)
  assert.match(ledgerWriteVerdict({ tool_name: 'Read', tool_input: { file_path: '/Users/x/.config/office-anything/approvals.key' } }), /approval key/)
  assert.match(ledgerWriteVerdict({ tool_name: 'Grep', tool_input: { pattern: 'x', path: '/Users/x/.config/office-anything' } }), /approval key/)
  assert.equal(v('ls'), null)
  assert.equal(readFileSync(join(KEYS, 'approvals.key'), 'utf8').trim().length, 64)
  assert.equal(require_mode(join(KEYS, 'approvals.key')), 0o600)
})
const require_mode = (f) => statSync(f).mode & 0o777

test('the project match is exact: a longer folder name that merely starts with the office\'s does not count; a desk\'s folder inside the office does', () => {
  const root = office()
  const top = realpathSync(root)
  // 1. a sibling whose project name starts with this office's
  const g1 = grant(root, put(join(CFG, 'projects', projectDirName(top) + '-evil'), SID, TEXT))
  assert.match(verifyGrant(root, g1).why, /belongs to another project/)
  // 2. a session started in a desk's folder inside the office (grant.cwd says where)
  const desk = join(top, 'desks', 'aics')
  const g2 = grantFromPrompt(root, {}, { session: 'full', sessionId: SID, text: TEXT, promptId: 'p3', transcript: put(join(CFG, 'projects', projectDirName(desk)), SID, TEXT, 'p3'), cwd: desk }, { now: T0 })
  assert.equal(verifyGrant(root, g2).ok, true)
  // 3. a cwd that only shares the office's name as a prefix is not inside it
  const near = top + '-evil'; mkdirSync(near, { recursive: true })
  const root3 = office()
  const g3 = grantFromPrompt(root3, {}, { session: 'full', sessionId: SID, text: TEXT, promptId: 'p1', transcript: put(join(CFG, 'projects', projectDirName(realpathSync(near))), SID, TEXT), cwd: near }, { now: T0 })
  assert.match(verifyGrant(root3, g3).why, /belongs to another project/)
})

test('office.json cannot widen where a transcript may live', () => {
  const extra = mkdtempSync(join(tmpdir(), 'oa-where-extra-'))
  const root = office({ approvals: { configDirs: [extra] } })
  const g = grant(root, put(join(extra, 'projects', projectDirName(realpathSync(root))), SID, TEXT))
  assert.match(verifyGrant(root, g).why, /not under a Claude Code projects folder/)
})
