// IDLE COMPACT (0.13.0). A desk or lead idle at its prompt with a fat context
// has /compact <focus> typed into it by heal, so its next request starts small.
// Off unless office.json says "compact"; never mid-turn; never into a dialog.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compactConfig, compactVerdict, focusText, transcriptTail, FOCUS_MAX } from '../lib/compact.mjs'
import { officeHealth } from '../lib/health.mjs'
import { heal } from '../lib/heal.mjs'
import { projectDirOf } from '../lib/conversation.mjs'

const NOW = Date.now()
const MIN = 60_000
function office({ cfg = { compact: { focus: 'Keep: open buyers, promises, owner decisions of the last 7 days.' } }, desk = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oa-cmp-'))
  const home = mkdtempSync(join(tmpdir(), 'oa-cmp-home-'))
  mkdirSync(join(home, '.claude', 'sessions'), { recursive: true })
  mkdirSync(join(root, 'desks', 'inventory'), { recursive: true })
  writeFileSync(join(root, 'desks', 'inventory', 'desk.json'), JSON.stringify({ name: 'inventory', kind: 'knowledge', port: 9701, ...desk }))
  writeFileSync(join(root, 'office.json'), JSON.stringify({ lead: { session: 'Office Lead' }, ...cfg }))
  const procs = new Map([[1, { pid: 1, ppid: 0, ageSec: 1e6, cmd: 'launchd' }]])
  // a live session: idle idleMin, its last turn's context ctx tokens, last entry pending?
  const live = (name, cwd, pid, { idleMin = 45, ctx = 300_000, status = 'idle', pending = false } = {}) => {
    const sid = `00000000-0000-4000-8000-00000000${pid}`
    writeFileSync(join(home, '.claude', 'sessions', `${pid}.json`), JSON.stringify({ pid, name, cwd, sessionId: sid, status, statusUpdatedAt: NOW - idleMin * MIN, updatedAt: NOW, startedAt: NOW - 7200_000 }))
    procs.set(pid, { pid, ppid: 1, ageSec: 7200, cmd: `claude --name ${name}` })
    const p = projectDirOf(cwd, join(home, '.claude'))
    mkdirSync(p, { recursive: true })
    const turns = [
      { type: 'user', message: { content: 'hi' } },
      { type: 'assistant', timestamp: new Date(NOW - idleMin * MIN).toISOString(), message: { usage: { input_tokens: 2, cache_read_input_tokens: ctx - 1002, cache_creation_input_tokens: 1000 }, content: pending ? [{ type: 'tool_use', id: 'q', name: 'AskUserQuestion', input: {} }] : [{ type: 'text', text: 'done' }] } },
    ]
    writeFileSync(join(p, sid + '.jsonl'), turns.map((t) => JSON.stringify(t)).join('\n') + '\n')
  }
  const typed = []
  const term = (titles) => ({ titles: () => titles, close: () => {}, send: (h, text) => typed.push({ h, text }) })
  const health = () => officeHealth(root, { home, procs, now: NOW, checks: false, cwd: () => null })
  const healIt = (h, titles = [{ handle: 't-inv', title: 'desk-inventory' }, { handle: 't-lead', title: 'Office Lead' }]) => heal(root, h, { home, now: NOW, kill: () => {}, freshProcs: () => procs, cwd: () => null, terminal: term(titles) })
  return { root, home, procs, live, health, healIt, typed, desk: join(root, 'desks', 'inventory') }
}

test('config: off without office.json "compact"; desk.json overrides; the lead and a desk can opt out', () => {
  assert.equal(compactConfig({}), null)
  assert.deepEqual(compactConfig({ compact: {} }), { idleMin: 30, aboveK: 150, everyMin: 120, focus: '' })
  assert.deepEqual(compactConfig({ compact: { idleMin: 20, focus: 'A.' } }, { desk: { compactIdleMin: 60, compactAboveK: 200, compactFocus: 'B.' } }), { idleMin: 60, aboveK: 200, everyMin: 120, focus: 'A. B.' })
  assert.equal(compactConfig({ compact: { lead: false } }, { isLead: true }), null)
  assert.equal(compactConfig({ compact: {} }, { desk: { compact: false } }), null)
  assert.equal(compactConfig({ compact: { idleMin: 1 } }).idleMin, 30, 'an out-of-range value is the default, not a hair trigger')
})

test('focus: one line, no control characters, at most FOCUS_MAX, pointers dropped whole when they do not fit', () => {
  const f = focusText('Keep:\nopen\tbuyers.\u001b[B', ['Open tasks: T1.', 'x'.repeat(400)])
  assert.equal(f, 'Keep: open buyers. [B Open tasks: T1.')
  assert.ok(focusText('y'.repeat(900)).length <= FOCUS_MAX)
})

test('verdict: compact only when idle long enough, above the size, nothing open, and not just compacted', () => {
  const conf = compactConfig({ compact: {} })
  const s = (o = {}) => ({ status: 'idle', statusUpdatedAt: NOW - 45 * MIN, ...o })
  const big = { ctx: 300_000, pending: false }
  assert.equal(compactVerdict(conf, s(), big, { now: NOW }).verdict, 'compact')
  assert.match(compactVerdict(conf, s(), { ctx: 90_000, pending: false }, { now: NOW }).why, /90K, under 150K/)
  assert.match(compactVerdict(conf, s({ status: 'busy' }), big, { now: NOW }).why, /busy, not idle/)
  assert.match(compactVerdict(conf, s({ status: 'waiting' }), big, { now: NOW }).why, /waiting, not idle/)
  assert.match(compactVerdict(conf, s(), { ctx: 300_000, pending: true }, { now: NOW }).why, /question or prompt is open/)
  assert.match(compactVerdict(conf, s({ statusUpdatedAt: NOW - 10 * MIN }), big, { now: NOW }).why, /idle 10 of 30 min/)
  assert.match(compactVerdict(conf, s(), big, { now: NOW, last: NOW - 30 * MIN }).why, /compacted 30 min ago/)
  assert.match(compactVerdict(conf, s(), { ctx: null }, { now: NOW }).why, /unknown/)
})

test('the transcript tail: the last turn\'s whole prompt is the context; a tool call with no result is pending', () => {
  const o = office()
  o.live('desk-inventory', o.desk, 701, { ctx: 412_000 })
  o.live('Office Lead', o.root, 702, { ctx: 200_000, pending: true })
  const reg = (pid) => JSON.parse(readFileSync(join(o.home, '.claude', 'sessions', `${pid}.json`), 'utf8'))
  assert.deepEqual(transcriptTail(o.home, reg(701)), { ctx: 412_000, pending: false })
  assert.deepEqual(transcriptTail(o.home, reg(702)), { ctx: 200_000, pending: true })
})

test('⛔ heal types /compact <focus> into the idle fat desk and the idle fat lead, once, by their own tabs', () => {
  const o = office()
  writeFileSync(join(o.root, 'office.json'), JSON.stringify({ lead: { session: 'Office Lead' }, compact: { focus: 'Keep: open buyers.' } }))
  o.live('desk-inventory', o.desk, 711, { ctx: 400_000 })
  o.live('Office Lead', o.root, 712, { ctx: 500_000 })
  const h = o.health()
  assert.match(h.line, /fat contexts: Office Lead 500K, desk-inventory 400K/)
  const r = o.healIt(h)
  assert.deepEqual(o.typed.map((t) => t.h).sort(), ['t-inv', 't-lead'])
  assert.ok(o.typed.every((t) => t.text.startsWith('/compact Keep: open buyers.')), JSON.stringify(o.typed))
  assert.equal(r.acts.filter((a) => a.act === 'compact' && a.ok).length, 2)
  // not again within everyMin: the next health keeps it
  const again = o.health()
  assert.match(again.desks[0].compact.why, /compacted 0 min ago/)
  o.typed.length = 0
  o.healIt(again)
  assert.equal(o.typed.length, 0)
})

test('⛔ never into a busy session, an open dialog, a session that moved, or a tab name held twice', () => {
  const cases = [
    ['busy', { status: 'busy' }, undefined, /busy, not idle/],
    ['dialog', { pending: true }, undefined, /question or prompt is open/],
    ['two tabs', {}, [{ handle: 'a', title: 'desk-inventory' }, { handle: 'b', title: 'desk-inventory' }], /2 tabs are titled desk-inventory/],
    ['no tab', {}, [], /no tab titled desk-inventory/],
  ]
  for (const [label, opt, titles, why] of cases) {
    const o = office({ cfg: { lead: { session: 'Office Lead' }, compact: { lead: false } } })
    o.live('desk-inventory', o.desk, 721, { ctx: 400_000, ...opt })
    const h = o.health()
    const r = o.healIt(h, titles)
    assert.equal(o.typed.length, 0, label)
    const reason = r.acts.find((a) => a.act === 'compact')?.why ?? h.desks[0].compact.why
    assert.match(reason, why, label)
  }
  // moved: the status stamp changed between health and heal
  const o = office()
  o.live('desk-inventory', o.desk, 731, { ctx: 400_000 })
  const h = o.health()
  o.live('desk-inventory', o.desk, 731, { ctx: 400_000, idleMin: 31 })
  const r = o.healIt(h)
  assert.equal(o.typed.length, 0)
  assert.match(r.acts.find((a) => a.act === 'compact').why, /moved since health looked/)
})

test('⛔ off by default: no "compact" in office.json types nothing, but health still shows the fat ones', () => {
  const o = office({ cfg: {} })
  o.live('desk-inventory', o.desk, 741, { ctx: 400_000 })
  const h = o.health()
  assert.match(h.line, /fat contexts: desk-inventory 400K/)
  o.healIt(h)
  assert.equal(o.typed.length, 0)
})

test('the README says idle compact is off unless office.json says "compact"', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  assert.match(readme, /\*\*Off unless `office\.json` says `"compact"`\.\*\*/)
})

// ── 0.14.0: what compaction keeps ───────────────────────────────────────────
import { instructionsBlock, hasInstructions, afterLines, KEEP } from '../lib/compact.mjs'
import { report as compactInstructionsCheck } from '../checks/compact-instructions.mjs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('instructions: a CLAUDE.md "Compact Instructions" section, defaults or office.json keep/drop, plus the desk\'s or the lead\'s own lines', () => {
  const b = instructionsBlock({}, { desk: { name: 'inventory', compactKeep: ['stock counts promised today'] } })
  assert.ok(hasInstructions(b))
  for (const k of KEEP) assert.ok(b.includes(`- ${k}`))
  assert.match(b, /- stock counts promised today/)
  assert.match(b, /Drop:\n- tool output/)
  const lead = instructionsBlock({ compact: { keep: ['A'], drop: ['B'], leadKeep: ['the owner\'s owed list'] } }, { isLead: true })
  assert.match(lead, /keep:\n- A\n- the owner's owed list\n\nDrop:\n- B\n/)
  assert.doesNotMatch(lead, /open buyers/, 'office.json keep replaces the defaults')
})

test('check: an office that compacts and a desk or the lead without the section is a finding; pasting it clears it', () => {
  const o = office()
  writeFileSync(join(o.desk, 'CLAUDE.md'), '# inventory\n')
  const r = compactInstructionsCheck(o.root)
  assert.equal(r.code, 4)
  assert.deepEqual(r.findings.map((f) => f.desk).sort(), ['inventory', 'lead'])
  writeFileSync(join(o.desk, 'CLAUDE.md'), '# inventory\n\n' + instructionsBlock({}, { desk: { name: 'inventory' } }))
  writeFileSync(join(o.root, 'CLAUDE.md'), instructionsBlock({}, { isLead: true }))
  assert.equal(compactInstructionsCheck(o.root).code, 0)
  assert.equal(compactInstructionsCheck(office({ cfg: {} }).root).applicable, false)
})

test('after compaction: the office\'s read-only command, {desk} filled with the id, at most 40 lines; a failure says UNKNOWN', () => {
  const o = office()
  const cfg = { compact: { after: { lead: 'printf "owed: Q1\\ndecided: D7\\n"', desk: 'echo open for {desk}' } } }
  assert.deepEqual(afterLines(o.root, cfg, { isLead: true, run: spawnSync }), ['After compaction, what is open right now:', 'owed: Q1', 'decided: D7'])
  assert.deepEqual(afterLines(o.root, cfg, { desk: 'inventory', run: spawnSync }), ['After compaction, what is open right now:', 'open for inventory'])
  assert.equal(afterLines(o.root, cfg, { desk: 'x; rm -rf /', run: spawnSync }).length, 0, 'a desk id is never shell text')
  assert.match(afterLines(o.root, { compact: { after: { lead: 'exit 3' } } }, { isLead: true, run: spawnSync })[0], /did not answer: exit 3; what is open is UNKNOWN/)
  const many = afterLines(o.root, { compact: { after: { lead: 'seq 1 60' } } }, { isLead: true, run: spawnSync })
  assert.equal(many.length, 42)
  assert.match(many.at(-1), /and 20 more lines/)
})

test('⛔ the boot hook prints it on a SessionStart from compaction only, and leaves every other boot exactly as it was', () => {
  const o = office()
  writeFileSync(join(o.root, 'office.json'), JSON.stringify({ roleEnv: 'OFFICE_ROLE', lead: { session: 'Office Lead' }, compact: { after: { lead: 'echo owed Q1', desk: 'echo open {desk}' } } }))
  const hook = fileURLToPath(new URL('../hooks/desk-boot.mjs', import.meta.url))
  const run = (source, role, cwd) => spawnSync(process.execPath, [hook], { input: JSON.stringify({ source, cwd }), env: { ...process.env, OFFICE_ROLE: role }, encoding: 'utf8' }).stdout
  assert.match(run('compact', 'Office Lead', o.root), /After compaction, what is open right now:\nowed Q1/)
  assert.match(run('compact', 'desk-inventory', o.desk), /open inventory/)
  assert.equal(run('startup', 'Office Lead', o.root), '', 'no boot block, no wake: a fresh start prints nothing, as before')
  assert.equal(run('resume', 'desk-inventory', o.desk), '')
})
