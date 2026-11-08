// THE OWNER'S WORDS ARE RECORDED NATIVELY (owner, 2026-11-08): every genuine typed prompt of an owner-facing session is
// kept verbatim in .office/owner-words.jsonl, shown back at boot, closed by the session that heard it, and alarmed
// after 24 h. Hook, boot, CLI and board view, each against a real temp office.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { recordWords, recordQueued, readWords, openWords, closeWord, bootBlock, boardView, skipReason, ALARM_AFTER, wordsFile } from '../lib/owner-words.mjs'
import { readTasks } from '../lib/tasks.mjs'
import { markOfficeTyped } from '../lib/typed-mark.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const HOOK = join(HERE, '..', 'hooks', 'owner-words.mjs')
const BOOT = join(HERE, '..', 'hooks', 'owner-words-boot.mjs')
const CLI = join(HERE, '..', 'lib', 'owner-words.mjs')
const HOUR = 3600_000
const NOW = new Date(2026, 10, 8, 12, 0, 0).getTime()

function office() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'oa-ow-')))
  mkdirSync(join(root, 'desks', 'design'), { recursive: true })
  writeFileSync(join(root, 'desks', 'design', 'desk.json'), JSON.stringify({ name: 'design', kind: 'knowledge', port: 9811 }))
  writeFileSync(join(root, 'office.json'), JSON.stringify({ roleEnv: 'OFFICE_ROLE', lead: { session: 'Lead' } }))
  return root
}
// a dev session called "full" (a registry name from OFFICE_ROLE), or a desk by cwd
const env = (role) => { const e = { ...process.env, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'oa-ow-cfg-')) }; delete e.OFFICE_ROLE; delete e.CLAUDE_PROJECT_DIR; if (role) e.OFFICE_ROLE = role; return e }
const hook = (root, payload, role = 'full', cwd = root) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd, ...payload }), encoding: 'utf8', env: env(role) })
const cli = (root, args, role = 'full') => spawnSync(process.execPath, [CLI, root, ...args], { encoding: 'utf8', env: env(role), cwd: root })

test('the hook records an owner prompt VERBATIM with id, time, session and open state, and prints nothing', () => {
  const root = office()
  const text = '  Please move the Cheyenne quote to Friday,\n  and tell David!  '
  const r = hook(root, { prompt: text })
  assert.equal(r.status, 0); assert.equal(r.stdout, '')
  const [w] = readWords(root)
  assert.match(w.id, /^W-\d{6}-1$/)
  assert.equal(w.text, text); assert.equal(w.session, 'full'); assert.equal(w.state, 'open'); assert.ok(w.at > 0)
})

test('not the owner: system traffic, approval phrases, bare acks, slash commands, office-typed text are NOT recorded', () => {
  const root = office()
  markOfficeTyped(root, 'Scheduled office job nightly is due, do it now')
  for (const t of ['<task-notification><task-id>x</task-id></task-notification>', '<system-reminder>hook says</system-reminder>', 'Stop hook feedback: no', '<cross-session-message from-name="a">hi</cross-session-message>',
    'This session is being continued from a previous conversation', 'approve send-price target:buyer-1 once', 'yes', 'OK.', '/compact', 'Scheduled office job nightly is due, do it now', '   ']) {
    assert.ok(skipReason(root, t), `should skip: ${t}`)
    hook(root, { prompt: t })
  }
  assert.deepEqual(readWords(root), [])
})

test('⛔ a prompt that looks like a key or token is never written, anywhere', () => {
  const root = office()
  const key = 'use this sk-ant-' + 'a'.repeat(40) + ' for the api'
  const assigned = 'tok' + 'en = "' + 'abcdefghijkl' + 'mnop1234"'
  hook(root, { prompt: key }); hook(root, { prompt: assigned })
  assert.deepEqual(readWords(root), [])
  let file = ''; try { file = readFileSync(wordsFile(root), 'utf8') } catch {}
  assert.ok(!file.includes('sk-ant'))
})

test('a desk records nothing; a repeat inside a minute is one word; ids count up in the day', () => {
  const root = office()
  hook(root, { prompt: 'do the closet quote now' }, null, join(root, 'desks', 'design'))
  assert.deepEqual(readWords(root), [])
  recordWords(root, { session: 'full', text: 'check the freight rates' }, { now: NOW })
  assert.equal(recordWords(root, { session: 'full', text: 'check the  freight rates' }, { now: NOW + 5000 }), null)
  const b = recordWords(root, { session: 'full', text: 'second thing please' }, { now: NOW + 70_000 })
  assert.match(b.id, /-2$/)
})

test('a message typed mid-turn is recovered from the transcript (queued_command, origin human), once; peers and job notices are not', () => {
  const root = office()
  const tr = join(root, 't.jsonl')
  const line = (o) => JSON.stringify(o)
  writeFileSync(tr, [
    line({ type: 'attachment', uuid: 'u1', attachment: { type: 'queued_command', prompt: 'also fix the invoice date', origin: { kind: 'human' } } }),
    line({ type: 'attachment', uuid: 'u2', attachment: { type: 'queued_command', prompt: 'from a peer', origin: { kind: 'peer', from: 'x' } } }),
    line({ type: 'attachment', uuid: 'u3', attachment: { type: 'queued_command', prompt: '<task-notification>done</task-notification>', commandMode: 'task-notification', origin: { kind: 'human' } } }),
  ].join('\n') + '\n')
  assert.equal(recordQueued(root, 'full', tr, { now: NOW }), 1)
  assert.equal(recordQueued(root, 'full', tr, { now: NOW + HOUR }), 0, 'the same entry is not recorded twice')
  assert.deepEqual(readWords(root).map((w) => w.text), ['also fix the invoice date'])
  // and through the hook, beside the prompt that starts the next turn
  hook(root, { prompt: 'what is next', transcript_path: tr })
  assert.equal(readWords(root).length, 2)
})

test('boot shows only this session\'s open words, newest first, capped, with the close commands; closed ones vanish', () => {
  const root = office()
  for (let i = 1; i <= 7; i++) recordWords(root, { session: 'full', text: `ask number ${i}` }, { now: NOW + i * 120_000 })
  recordWords(root, { session: 'other', text: 'not mine' }, { now: NOW })
  const b = bootBlock(root, 'full', { now: NOW + HOUR })
  assert.match(b, /OWNER WORDS STILL OPEN \(7\)/)
  assert.ok(b.indexOf('ask number 7') < b.indexOf('ask number 3'), 'newest first')
  assert.ok(!b.includes('ask number 1"') && !b.includes('not mine'))
  assert.match(b, /\+2 more/); assert.match(b, /done W-… --note/)
  assert.ok(b.split('\n').length <= 9, 'short')
  assert.equal(bootBlock(root, 'nobody'), '')
  const r = spawnSync(process.execPath, [BOOT], { input: JSON.stringify({ cwd: root }), encoding: 'utf8', env: env('full') })
  assert.match(r.stdout, /OWNER WORDS STILL OPEN \(7\)/)
  assert.equal(spawnSync(process.execPath, [BOOT], { input: JSON.stringify({ cwd: join(root, 'desks', 'design') }), encoding: 'utf8', env: env() }).stdout, '', 'a desk is shown nothing')
})

test('done needs a note, no-action a why, task makes a real task whose said is the owner\'s words; each word closes once', () => {
  const root = office()
  const a = recordWords(root, { session: 'full', text: 'reply to Cheyenne today' }, { now: NOW })
  const b = recordWords(root, { session: 'full', text: 'is the freight right?' }, { now: NOW + 70_000 })
  const c = recordWords(root, { session: 'full', text: 'order the samples' }, { now: NOW + 140_000 })
  assert.throws(() => closeWord(root, a.id, 'done', { session: 'full' }), /--note/)
  assert.throws(() => closeWord(root, b.id, 'no-action', { session: 'full', why: ' ' }), /--why/)
  const d = closeWord(root, a.id, 'done', { session: 'full', note: 'replied at 14:02' }, { now: NOW + HOUR })
  assert.deepEqual([d.state, d.note, d.closedBy], ['done', 'replied at 14:02', 'full'])
  assert.throws(() => closeWord(root, a.id, 'done', { session: 'full', note: 'again' }), /already closed/)
  closeWord(root, b.id, 'no-action', { session: 'full', why: 'a question, answered in chat' })
  const t = closeWord(root, c.id, 'task', { session: 'full', title: 'Order samples' }, { now: NOW + HOUR })
  assert.equal(t.state, 'task')
  const task = readTasks(root).find((x) => x.id === t.taskId)
  assert.equal(task.said, 'order the samples'); assert.equal(task.title, 'Order samples'); assert.equal(task.assigned, 'full')
  assert.deepEqual(openWords(root), [])
})

test('⛔ a session closes only its own words', () => {
  const root = office()
  const w = recordWords(root, { session: 'full', text: 'plan the move' }, { now: NOW })
  assert.throws(() => closeWord(root, w.id, 'done', { session: 'construction', note: 'x y z' }), /said in full/)
  const r = cli(root, ['done', w.id, '--note', 'x y z'], 'construction')
  assert.notEqual(r.status, 0); assert.match(r.stderr, /said in full/)
  assert.equal(openWords(root).length, 1)
})

test('the CLI: list, then done, task and no-action, as the session that heard the words', () => {
  const root = office()
  const [a, b, c] = ['one thing', 'two things', 'three things'].map((text, i) => recordWords(root, { session: 'full', text }, { now: Date.now() - 3 * HOUR + i * 70_000 }))
  assert.match(cli(root, ['list']).stdout, /three things[\s\S]*two things[\s\S]*one thing/)
  assert.match(cli(root, ['done', a.id, '--note', 'finished it']).stdout, /done/)
  assert.match(cli(root, ['no-action', b.id, '--why', 'just a question']).stdout, /no-action/)
  assert.match(cli(root, ['task', c.id, '--title', 'Three things']).stdout, /T-\d{6}-1/)
  assert.equal(cli(root, ['list']).stdout.trim(), 'no open owner words')
  assert.notEqual(cli(root, ['done', a.id, '--note', 'x y z'], 'full').status, 0, 'already closed')
})

test('⛔ an owner word open more than 24 h is an ALARM at boot and on the board; closing it clears both', () => {
  const root = office()
  const old = recordWords(root, { session: 'full', text: 'chase the supplier' }, { now: NOW })
  recordWords(root, { session: 'full', text: 'fresh ask' }, { now: NOW + ALARM_AFTER })
  recordWords(root, { session: 'ops', text: 'ops ask' }, { now: NOW + ALARM_AFTER + 1000 })
  const now = NOW + ALARM_AFTER + HOUR
  const b = bootBlock(root, 'full', { now })
  assert.match(b, /ALARM: 1 open more than 24h \(oldest W-\d{6}-1, 1d\)/)
  assert.match(b, /chase the supplier"\s+ALARM/); assert.ok(!/fresh ask".*ALARM/.test(b))
  const v = boardView(root, { now })
  assert.deepEqual(v.sessions.map((s) => [s.session, s.open, s.alarms]), [['full', 2, 1], ['ops', 1, 0]])
  assert.deepEqual([v.open, v.alarms], [3, 1])
  closeWord(root, old.id, 'done', { session: 'full', note: 'chased' }, { now })
  assert.doesNotMatch(bootBlock(root, 'full', { now }), /ALARM/)
  assert.equal(boardView(root, { now }).alarms, 0)
})
