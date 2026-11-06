// SESSIONS APPROVE EACH OTHER (owner, 2026-11-06), owner-only gates, and the review-5 hardening of the owner path.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { grantPeer, peerGranter, checkApproval, gateVerdict, grants, grantFromPrompt, verifyGrant, projectDirName, ledgerWriteVerdict, effectiveGatesCfg, run as cli, readLedger, repairFile } from '../lib/approvals.mjs'
import { existsSync } from 'node:fs'
import { identityVerdict } from '../lib/approvals.mjs'

const T0 = Date.parse('2026-11-06T09:00:00Z')
const SID = '99999999-2222-4333-8444-555555555555'
const CFG = mkdtempSync(join(tmpdir(), 'oa-peer-claude-'))
process.env.CLAUDE_CONFIG_DIR = CFG
process.env.OFFICE_ANYTHING_KEY_DIR = mkdtempSync(join(tmpdir(), 'oa-peer-key-'))
const GATES = [
  { match: 'discord-post\\.mjs\\s+(?<target>#[a-z-]+)', action: 'post-discord' },
  { match: 'send-price\\.mjs\\s+(?<target>\\S+)', action: 'send-price', owner: true },
]
const call = (command) => ({ tool_name: 'Bash', tool_input: { command } })
function office(approvals = { gates: GATES }) {
  const root = mkdtempSync(join(tmpdir(), 'oa-peer-'))
  mkdirSync(join(root, 'desks', 'aics'), { recursive: true })
  writeFileSync(join(root, 'desks', 'aics', 'desk.json'), JSON.stringify({ name: 'aics', kind: 'knowledge', port: 9771 }))
  const cfg = { roleEnv: 'OFFICE_ROLE', lead: { session: 'Lead' }, approvals }
  writeFileSync(join(root, 'office.json'), JSON.stringify(cfg))
  return { root, cfg }
}
// a fake process table and registry: shell 5000 under claude 4000, whose registry entry (in the claude process's own config dir) names it
function rg(name, { env = '', startedAt = T0, write = true, claudeComm = '/usr/local/bin/claude' } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'oa-peer-home-')); mkdirSync(join(home, '.claude', 'sessions'), { recursive: true })
  if (write) writeFileSync(join(home, '.claude', 'sessions', '4000.json'), JSON.stringify({ pid: 4000, startedAt, name }))
  const tbl = { 5000: { ppid: 4000, comm: '/bin/zsh', lstart: 'x' }, 4000: { ppid: 1, comm: claudeComm, lstart: new Date(T0 + 700).toString() } }
  return { pid: 5000, home, proc: { info: (p) => tbl[p] ?? null, env: () => env } }
}
const as = (root, cfg, name) => peerGranter(root, cfg, { env: { OFFICE_ROLE: name }, cwd: root, ...rg(name) })

test('a peer grant passes a normal gate, for the session it names, and check says who granted it', () => {
  const { root, cfg } = office()
  const g = as(root, cfg, 'Lead'); assert.equal(g.name, 'Lead')
  const l = grantPeer(root, cfg, { by: g.name, to: 'full', action: 'post-discord', target: '#releases', why: 'release 0.27 note, checked' }, { now: T0 })
  assert.equal(l.kind, 'peer'); assert.equal(l.grantedBy, 'lead')
  const call1 = call('node scripts/discord-post.mjs #releases hi')
  assert.match(gateVerdict(root, cfg, call1, { now: T0 + 1000, asker: 'construction' }), /not for construction/, 'a grant for full is not for construction')
  assert.equal(gateVerdict(root, cfg, call1, { now: T0 + 1000, asker: 'full' }), null)
  const r = checkApproval(root, { action: 'post-discord', target: '#releases', asker: 'full' }, { now: T0 + 2000 })
  assert.equal(r.ok, true); assert.equal(r.by, 'lead')
  const out = []; cli(['check', '--action', 'post-discord', '--target', '#releases'], { cwd: root, env: { OFFICE_ROLE: 'full' }, ...rg('full'), out: (s) => out.push(s), now: T0 + 3000 })
  assert.match(out[0], /approved by lead \(a peer grant to full/); assert.match(out[0], /release 0.27 note/)
  // outside its target nothing passes
  assert.match(gateVerdict(root, cfg, call('node scripts/discord-post.mjs #general'), { now: T0 + 1000, asker: 'full' }), /only for #releases/)
})

test('a peer grant never satisfies an owner-only gate; the message says the owner types it himself', () => {
  const { root, cfg } = office()
  assert.throws(() => grantPeer(root, cfg, { by: 'Lead', to: 'full', action: 'send-price', target: 'BT-1', why: 'quote checked twice' }, { now: T0 }), /owner's alone/)
  for (const a of ['gates-change', 'repair-ledger']) assert.throws(() => grantPeer(root, cfg, { by: 'Lead', to: 'full', action: a, target: 'office', why: 'because I say so' }, { now: T0 }), /owner's alone/)
  // even if a peer line for it were forced into an office that did not mark the gate yet, the gate marked owner refuses it
  const free = office({ gates: [{ match: 'send-price\\.mjs\\s+(?<target>\\S+)', action: 'send-price' }] })
  grantPeer(free.root, free.cfg, { by: 'Lead', to: 'full', action: 'send-price', target: 'BT-1', why: 'quote checked twice' }, { now: T0 })
  const strict = { ...free.cfg, approvals: { gates: GATES } }
  const v = gateVerdict(free.root, strict, call('node x/send-price.mjs BT-1'), { now: T0 + 1000, asker: 'full' })
  assert.match(v, /owner's alone/)
  assert.match(v, /approve send-price target:BT-1/)
  assert.equal(checkApproval(free.root, { action: 'send-price', target: 'BT-1', asker: 'full', ownerOnly: true }, { now: T0 + 1000 }).ok, false)
})

test('no self-grant: not to yourself by name, and a * grant never covers its granter', () => {
  const { root, cfg } = office()
  assert.throws(() => grantPeer(root, cfg, { by: 'full', to: 'full', action: 'post-discord', target: '#releases', why: 'my own say-so' }, { now: T0 }), /cannot approve for itself/)
  grantPeer(root, cfg, { by: 'full', to: '*', action: 'post-discord', target: '#releases', why: 'for anyone else to use' }, { now: T0 })
  assert.equal(checkApproval(root, { action: 'post-discord', target: '#releases', asker: 'full' }, { now: T0 + 1000 }).ok, false, 'the granter is not covered')
  assert.equal(checkApproval(root, { action: 'post-discord', target: '#releases', asker: 'construction' }, { now: T0 + 1000 }).ok, true)
  assert.equal(checkApproval(root, { action: 'post-discord', target: '#releases' }, { now: T0 + 1000 }).ok, false, 'a call that cannot name its session gets nothing from a peer grant')
})

test('a desk cannot grant unless office.json allows it; a session the office does not know cannot either', () => {
  const { root, cfg } = office()
  assert.match(as(root, cfg, 'desk-aics').why, /desksMayGrant/)
  assert.match(as(root, cfg, 'desk-nope').why, /does not have/)
  const ok = office({ gates: GATES, desksMayGrant: true })
  assert.equal(as(ok.root, ok.cfg, 'desk-aics').name, 'desk-aics')
  const out = []
  assert.throws(() => cli(['grant', '--to', 'full', '--action', 'post-discord', '--target', '#releases', '--why', 'because'], { cwd: root, env: { OFFICE_ROLE: 'desk-aics' }, ...rg('desk-aics'), out: (s) => out.push(s), now: T0 }), /desksMayGrant/)
  cli(['grant', '--to', 'full', '--action', 'post-discord', '--target', '#releases', '--why', 'checked it by hand'], { cwd: root, env: { OFFICE_ROLE: 'Lead' }, ...rg('Lead'), out: (s) => out.push(s), now: T0 })
  assert.match(out[0], /lead approves post-discord for #releases to full/)
})

test('peer grants are bounded: hours, once, why, one-line target, revoke; a tampered ledger line fails closed', () => {
  const { root, cfg } = office()
  assert.throws(() => grantPeer(root, cfg, { by: 'Lead', to: 'full', action: 'post-discord', target: '#r', hours: 500, why: 'too long a time' }), /at most/)
  assert.throws(() => grantPeer(root, cfg, { by: 'Lead', to: 'full', action: 'post-discord', target: '#r', why: 'x' }), /--why/)
  assert.throws(() => grantPeer(root, cfg, { by: 'Lead', to: 'full', action: 'post-discord', target: '', why: 'no target here' }), /--target/)
  grantPeer(root, cfg, { by: 'Lead', to: 'full', action: 'post-discord', target: '#r', once: true, why: 'a single use' }, { now: T0 })
  assert.equal(checkApproval(root, { action: 'post-discord', target: '#r', asker: 'full', use: true }, { now: T0 + 1 }).ok, true)
  assert.match(checkApproval(root, { action: 'post-discord', target: '#r', asker: 'full' }, { now: T0 + 2 }).why, /used up/)
  grantPeer(root, cfg, { by: 'Lead', to: 'full', action: 'post-discord', target: '#s', why: 'checked and fine' }, { now: T0 })
  const out = []; cli(['list'], { cwd: root, env: { OFFICE_ROLE: 'Lead' }, ...rg('Lead'), out: (s) => out.push(s), now: T0 + 5 })
  assert.match(out.join('\n'), /peer lead -> full/)
  // forging a peer line by hand (no key) breaks the chain: nothing passes until the owner repairs it
  const f = join(root, '.office', 'approvals.jsonl')
  writeFileSync(f, readFileSyncSafe(f) + JSON.stringify({ ev: 'grant', kind: 'peer', id: 'A-x', at: T0, session: 'full', grantedBy: 'Lead', to: 'full', action: 'post-discord', target: '#z', why: 'forged line here', expires: T0 + 1e9, max: null, mac: 'deadbeef' }) + '\n')
  assert.equal(checkApproval(root, { action: 'post-discord', target: '#s', asker: 'full' }, { now: T0 + 6 }).ok, false)
})
import { readFileSync } from 'node:fs'
const readFileSyncSafe = (f) => readFileSync(f, 'utf8')

// ---- review 5 on the owner path -------------------------------------------------------------------------------
const projects = (root) => join(CFG, 'projects', projectDirName(realpathSync(root)))
function session(root, turns) {
  const dir = projects(root); mkdirSync(dir, { recursive: true })
  const f = join(dir, `${SID}.jsonl`)
  writeFileSync(f, turns.map(([promptId, text, at]) => JSON.stringify({ type: 'user', timestamp: new Date(at).toISOString(), promptId, turnOrigin: 'human', promptSource: 'typed', message: { role: 'user', content: text } })).join('\n') + '\n')
  return f
}
const grant = (root, f, text, promptId, now) => grantFromPrompt(root, {}, { session: 'full', sessionId: SID, text, promptId, transcript: f, cwd: root }, { now })
const TEXT = 'approve post-discord target:#releases'

test('only the newest human-typed turn can make a grant; a prompt refused by a damaged ledger stays used', () => {
  const { root } = office()
  const f = session(root, [['old', TEXT, T0], ['new', 'something else', T0 + 60_000]])
  assert.equal(grant(root, f, TEXT, 'old', T0 + 61_000), null, 'an older turn cannot be replayed')
  // a prompt whose grant is refused (damaged ledger) is still spent: it cannot win after the repair
  const b = office(); const fb = session(b.root, [['p1', TEXT, T0]])
  mkdirSync(join(b.root, '.office'), { recursive: true })
  writeFileSync(join(b.root, '.office', 'approvals.jsonl'), 'not json\n')
  assert.equal(grant(b.root, fb, TEXT, 'p1', T0 + 1000), null)
  writeFileSync(join(b.root, '.office', 'approvals.jsonl'), '')
  assert.equal(grant(b.root, fb, TEXT, 'p1', T0 + 2000), null, 'the same prompt does not grant later')
})

test('the wall refuses a hook run by its bare file name, a copy of it or a shell -c, in any case; reading it is fine', () => {
  const { root } = office()
  const no = (c) => assert.ok(ledgerWriteVerdict(call(c)), c)
  for (const c of ['cd hooks && node typed-prompt.mjs', 'sh -c "node typed-prompt.mjs"', 'cp hooks/typed-prompt.mjs /tmp/x.mjs', 'NODE hooks/TYPED-PROMPT.mjs']) no(c)
  for (const c of ['cat hooks/typed-prompt.mjs', 'git add hooks/typed-prompt.mjs', 'git log -- hooks/typed-prompt.mjs']) assert.equal(ledgerWriteVerdict(call(c)) ?? null, null, c)
})

test('the wall refuses any tool call that sets a role variable: prefix, export, env, sh -c, process.env, any case; reading it is fine', () => {
  const bad = ['OFFICE_ROLE=Lead node lib/approvals.mjs grant --to full', 'export CLAUDE_CODE_SESSION_NAME=lead', 'env office_role=lead node x.mjs', 'sh -c "CLAUDE_CODE_SESSION_NAME=Lead node y.mjs"',
    'bash -c \'export OFFICE_ROLE="Lead"; node z\'', 'node -e "process.env.OFFICE_ROLE = \'Lead\'"', 'node -e "spawn(a,b,{env:{OFFICE_ROLE:\'Lead\'}})"', 'declare -x OFFICE_ROLE=lead', 'MYROLE=lead node q']
  for (const c of bad.slice(0, -1)) assert.match(identityVerdict(call(c)) ?? '', /may not set the session's role/, c)
  assert.match(identityVerdict(call(bad.at(-1)), ['MYROLE']) ?? '', /MYROLE/, 'the office\'s own roleEnv name counts too')
  for (const c of ['echo $OFFICE_ROLE', 'printenv MYROLE', 'node lib/approvals.mjs list', '[ "$OFFICE_ROLE" == lead ]']) assert.equal(identityVerdict(call(c)), null, c)
  assert.equal(identityVerdict({ tool_name: 'Edit', tool_input: { new_string: 'OFFICE_ROLE=x' } }), null)
})

test('the granter is the live claude process\'s registry entry; no env fallback for a grant; mismatch and a missing role variable are refused', () => {
  const { root, cfg } = office()
  const who = (reg, env, extra = {}) => peerGranter(root, cfg, { cwd: root, pid: 5000, ...reg, env, ...extra })
  assert.equal(who(rg('Lead'), { OFFICE_ROLE: 'lead' }).name, 'Lead')
  assert.match(who(rg('Lead'), { OFFICE_ROLE: 'full' }).why, /registered as Lead, but its environment says full/)
  // THE REVIEWED ATTACK: an entry for the shell, the role variable unset, then the command
  assert.match(who(rg('Lead'), {}).why, /OFFICE_ROLE is missing/, 'registry set, role variable gone (env -u): refused')
  assert.equal(who(rg('Lead'), {}, { lenient: true }).name, 'Lead', 'a check still names the caller')
  const forged = rg('ERP', { write: false }); writeFileSync(join(forged.home, '.claude', 'sessions', '5000.json'), JSON.stringify({ pid: 5000, startedAt: T0, name: 'ERP' }))
  assert.match(who(forged, { OFFICE_ROLE: 'ERP' }).why, /cannot name the live claude process/, 'an entry for the shell counts for nothing, and there is no env fallback')
  assert.equal(who(forged, { OFFICE_ROLE: 'Lead' }, { lenient: true }).name, 'Lead', 'for a check env is the fallback')
  assert.match(who(rg('Lead', { startedAt: T0 - 3_600_000 }), { OFFICE_ROLE: 'Lead' }).why, /cannot name/)
  assert.match(who(rg('Lead', { claudeComm: '/usr/bin/node' }), { OFFICE_ROLE: 'Lead' }).why, /cannot name/)
  // the registry folder comes from the claude process's own environment, never from the caller's env
  const planted = mkdtempSync(join(tmpdir(), 'oa-peer-planted-')); mkdirSync(join(planted, 'sessions'))
  writeFileSync(join(planted, 'sessions', '4000.json'), JSON.stringify({ pid: 4000, startedAt: T0, name: 'ERP' }))
  const r = rg('Lead')
  assert.equal(who(r, { OFFICE_ROLE: 'Lead', CLAUDE_CONFIG_DIR: planted }).name, 'Lead', 'a CLAUDE_CONFIG_DIR in the caller env is ignored')
  assert.equal(who({ ...r, proc: { ...r.proc, env: () => `claude CLAUDE_CONFIG_DIR=${planted} X=1` } }, { OFFICE_ROLE: 'ERP' }).name, 'ERP', 'the claude process\'s own env decides')
  const out = []
  assert.throws(() => cli(['grant', '--to', 'construction', '--action', 'post-discord', '--target', '#r', '--why', 'posing as lead'], { cwd: root, ...rg('full'), env: { OFFICE_ROLE: 'Lead' }, out: (x) => out.push(x), now: T0 }), /registered as full/)
  assert.throws(() => cli(['grant', '--to', 'construction', '--action', 'post-discord', '--target', '#r', '--why', 'no role var'], { cwd: root, ...rg('Lead'), env: {}, out: (x) => out.push(x), now: T0 }), /missing/)
  cli(['grant', '--to', 'construction', '--action', 'post-discord', '--target', '#r', '--why', 'registered grant'], { cwd: root, ...rg('full'), env: { OFFICE_ROLE: 'full' }, out: (x) => out.push(x), now: T0 })
  assert.match(out[0], /full approves post-discord/)
})

test('the wall refuses writing the session registry and unsetting a role variable, including the exact reviewed command', () => {
  const attack = "cd ~/.claude/sessions && echo '{\"name\":\"ERP\"}' > $$.json && env -u OFFICE_ROLE node /p/lib/approvals.mjs grant --to full --action x --target y --why because"
  assert.match(ledgerWriteVerdict(call(attack)) ?? '', /session registry/, 'the exact command is refused')
  assert.match(identityVerdict(call(attack)) ?? '', /may not set/, 'and so is its env -u')
  for (const c of ['tee ~/.claude/sessions/1.json < x', 'cp x ~/.claude/sessions/1.json', 'mv x sessions/1.json', "python3 -c \"open('sessions/1.json','w')\""]) assert.match(ledgerWriteVerdict(call(c)) ?? '', /session registry/, c)
  for (const f of ['/Users/x/.claude/sessions/4000.json', '/tmp/cfg/sessions/9.json']) for (const tool_name of ['Write', 'Edit']) assert.match(ledgerWriteVerdict({ tool_name, tool_input: { file_path: f } }) ?? '', /session registry/, f)
  for (const c of ['env -u OFFICE_ROLE node x.mjs', 'unset OFFICE_ROLE', 'sh -c "unset CLAUDE_CODE_SESSION_NAME; node x"', 'export CLAUDE_CONFIG_DIR=/tmp/x', 'CLAUDE_CONFIG_DIR=/tmp/x node y']) assert.match(identityVerdict(call(c)) ?? '', /may not set/, c)
  assert.equal(ledgerWriteVerdict(call('cat ~/.claude/sessions/4000.json')), null)
  assert.equal(ledgerWriteVerdict({ tool_name: 'Write', tool_input: { file_path: '/repo/tests/sessions/a.test.mjs' } }), null)
})
