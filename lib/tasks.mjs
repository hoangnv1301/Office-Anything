// THE LEAD'S PERSISTENT TASK LIST (owner request, 2026-10-18).
//
// What the owner asks for lived in chat and in memory, and a context summary lost
// it once: two buyers were found unanswered by the owner himself. So the list is a
// FILE the lead puts things down in, and hooks put the open ones back in its
// context (hooks/tasks-boot.mjs), so a context reset cannot lose them.
//
//   .office/tasks.jsonl   append-only EVENTS, one JSON per line:
//     add     { id, said, title, source, assigned, due? }
//     update  { id, state?, assigned?, due?, note? }
//     verify  { id, evidence, proof }
//     drop    { id, reason }
//   every event also carries { at, by, ev }. The task is a FOLD of its events,
//   computed on read and never stored, so the file cannot disagree with itself.
//
// ⛔ THE LEAD WRITES NO FILE ITSELF. This script writes it; the lead's wall allows
// one anchored command shape (wall.lead.bash with {plugin}, see lib/wall.mjs).
// ⛔ WHO YOU ARE COMES FROM THE SESSION, NOT A FLAG. A desk may add a task (for the
// lead unless it names someone) and work its own; verify and drop are the lead's:
// "done" is somebody saying so, "verified" is somebody checking.
// ⛔ verified AND dropped ARE FINAL. A reopened task is a task nobody can trust.
//
//   node lib/tasks.mjs [root] add --said "<owner's words>" --title "…" [--source chat|discord|desk|alert|other]
//                              [--assigned <session|desk-x>] [--due YYYY-MM-DD]
//   node lib/tasks.mjs [root] update T-… [--state open|working|waiting|done] [--note "…"] [--assigned …] [--due …]
//   node lib/tasks.mjs [root] verify T-… --evidence "<path|url|text>" --proof "<one line>"
//   node lib/tasks.mjs [root] ask --to <session> --question "…" [--minutes 30]   (an ask between sessions: re-rung when late, then raised)
//   node lib/tasks.mjs [root] answer T-… --text "<what you told them>"
//   node lib/tasks.mjs [root] handoff T-… --to "<person>" --via "<channel>" [--ref <post id>] [--days 3]   (handed to someone outside the office: waits, no nudges)
//   node lib/tasks.mjs [root] relay (T-…|--ref <post id>) --who "<person>" --text "<their words>" [--via <channel>]   (their captured reply answers it; the office's process or the lead only)
//   node lib/tasks.mjs [root] drop T-… --reason "<why, 10+ characters>"
//   node lib/tasks.mjs [root] list [--all] [--json] [--assigned <name>] [--overdue] [--owner]
//   node lib/tasks.mjs [root] digest        (writes .office/digest.md once a day, from 08:00)
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync, unlinkSync, copyFileSync, readdirSync, realpathSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readOfficeConfig, findOffice, whoIs, sessionName } from './office.mjs'
import { isMain } from './is-main.mjs'
import { writeAlert } from './alerts.mjs'
import { officeRoster, answersTo, namesOf, DESK_NAME, deskOfSession } from './desk.mjs'
import { allLeads } from './departments.mjs'
import { childOf } from './office.mjs'

const HOUR = 3600_000
export const SOURCES = ['chat', 'discord', 'desk', 'alert', 'other']
const OPEN = new Set(['open', 'working', 'waiting'])
// verified, dropped and answered (an ask a session replied to) are FINAL
export const FINAL = new Set(['verified', 'dropped', 'answered'])
const SETTABLE = new Set(['open', 'working', 'waiting', 'done'])
export const OPEN_STALE = 24 * HOUR
export const DONE_STALE = 6 * HOUR
const KEEP_SNAPSHOTS = 14

export const tasksFile = (root) => join(root, '.office', 'tasks.jsonl')
// a desk is its session name now (desk-<name>, or its department's
// <prefix>-<name>: lib/desk.mjs); a dev session (ops-construction, alibaba-98…)
// is its registry name
const deskOfBy = (root, by) => (by?.kind === 'desk' && root ? officeRoster(root).desks.find((d) => d.name === by.desk) ?? null : null)
const selfName = (by, root = null) => (by?.kind === 'desk' ? (deskOfBy(root, by)?.session ?? namesOf({ title: by.desk, name: by.desk })[0]) : by?.kind === 'session' ? by.name : null)
// is this task the session's own: assigned to any name its desk answers to
const isMine = (root, by, t) => { const d = deskOfBy(root, by); return d ? answersTo(d, String(t.assigned ?? '')) : t.assigned === selfName(by, root) }
const label = (by, root = null) => (by?.kind === 'lead' ? 'lead' : selfName(by, root) ?? 'owner')
const two = (n) => String(n).padStart(2, '0')
const ymd = (ms) => { const d = new Date(ms); return `${String(d.getFullYear()).slice(2)}${two(d.getMonth() + 1)}${two(d.getDate())}` }
const isoDay = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}` }

// ---- reading: the fold ----------------------------------------------------
export function readEvents(root) {
  let text = ''
  try { text = readFileSync(tasksFile(root), 'utf8') } catch { return [] }
  const out = []
  for (const l of text.split('\n')) { if (!l.trim()) continue; try { const e = JSON.parse(l); if (e && typeof e === 'object' && e.id) out.push(e) } catch {} }
  return out
}

export function readTasks(root) {
  const tasks = new Map()
  for (const e of readEvents(root)) {
    if (e.ev === 'add') {
      if (tasks.has(e.id)) continue
      tasks.set(e.id, { id: e.id, said: e.said, source: e.source, title: e.title, assigned: e.assigned, state: 'open', due: e.due ?? null, evidence: [], notes: [], created: e.at, updated: e.at, by: e.by, doneAt: null, closedAt: null, kind: e.kind ?? 'task', blocked: null, key: e.key ?? null, from: e.from ?? null, dueAt: e.dueAt ?? null, rings: [] })
      continue
    }
    const t = tasks.get(e.id)
    if (!t || FINAL.has(t.state)) continue
    // a ring is the plugin's, not the assignee's: it never counts as an update
    if (e.ev === 'ring') { t.rings.push({ stage: e.stage, at: e.at, key: e.key ?? null }); continue }
    t.updated = e.at
    if (e.ev === 'update') {
      if (e.state) { t.state = e.state; t.doneAt = e.state === 'done' ? e.at : null; if (e.state !== 'waiting') { t.blocked = null; t.handed = null } }
      if (e.blockedBy) t.blocked = { ...blockOf(e.blockedBy), at: e.at }
      if (e.assigned) t.assigned = e.assigned
      if (e.due !== undefined) t.due = e.due
      if (e.note) t.notes.push({ at: e.at, by: e.by, text: e.note })
    } else if (e.ev === 'verify') { t.state = 'verified'; t.closedAt = e.at; t.evidence.push({ at: e.at, by: e.by, evidence: e.evidence, proof: e.proof }) }
    else if (e.ev === 'ack') { t.acks = [...(t.acks ?? []), { at: e.at, by: e.by }]; t.notes.push({ at: e.at, by: e.by, text: e.text }) }
    else if (e.ev === 'answer') { t.state = 'answered'; t.closedAt = e.at; t.answer = e.text; t.answeredBy = e.by; if (e.relay) t.relay = e.relay }
    else if (e.ev === 'handoff') { t.state = 'waiting'; t.blocked = null; t.handed = { who: e.to, via: e.via, ref: e.ref ?? null, at: e.at, until: e.until } }
    else if (e.ev === 'drop') { t.state = 'dropped'; t.closedAt = e.at; t.reason = e.reason }
  }
  return [...tasks.values()]
}

// ---- writing: one lock, one append ------------------------------------------
const sleepMs = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } catch {} }
function withLock(root, fn) {
  const dir = join(root, '.office')
  mkdirSync(dir, { recursive: true })
  if (!existsSync(join(dir, '.gitignore'))) writeFileSync(join(dir, '.gitignore'), '# office-anything state and logs; never committed\n*\n')
  const lock = join(dir, 'tasks.lock')
  const t0 = Date.now()
  for (;;) {
    try { writeFileSync(lock, String(process.pid), { flag: 'wx' }); break } catch {}
    try { if (Date.now() - statSync(lock).mtimeMs > 10_000) { unlinkSync(lock); continue } } catch {}
    if (Date.now() - t0 > 8000) throw new Error('tasks: the task file is locked by another writer; try again')
    sleepMs(15 + Math.random() * 25)
  }
  try { return fn() } finally { try { unlinkSync(lock) } catch {} }
}

// a copy of the day's first state, so a deleted or damaged file loses at most a day
export function snapshot(root, now = Date.now()) {
  try {
    const f = tasksFile(root)
    if (!existsSync(f)) return null
    const dir = join(root, '.office', 'tasks-snapshots')
    mkdirSync(dir, { recursive: true })
    const day = isoDay(now).replace(/-/g, '')
    const to = join(dir, `tasks-${day}.jsonl`)
    if (!existsSync(to)) copyFileSync(f, to)
    const all = readdirSync(dir).filter((n) => /^tasks-\d{8}\.jsonl$/.test(n)).sort()
    for (const n of all.slice(0, Math.max(0, all.length - KEEP_SNAPSHOTS))) { try { unlinkSync(join(dir, n)) } catch {} }
    return to
  } catch { return null }
}

const append = (root, ev, now, by) => appendFileSync(tasksFile(root), JSON.stringify({ at: now, by: label(by, root), ...ev }) + '\n')
const find = (root, id) => { const t = readTasks(root).find((x) => x.id === id); if (!t) throw new Error(`no task ${id}`); return t }
const oneLine = (s) => !/[\r\n]/.test(String(s))

export function addTask(root, { said, title, source, assigned, due, kind, key, from, dueAt } = {}, { by = { kind: 'owner' }, now = Date.now() } = {}) {
  if (typeof said !== 'string' || !said.trim()) throw new Error('add needs --said: the owner\'s words, verbatim')
  if (typeof title !== 'string' || !title.trim()) throw new Error('add needs --title')
  if (!oneLine(title)) throw new Error('the title is one line')
  const src = source ?? (selfName(by) ? 'desk' : 'chat')
  if (!SOURCES.includes(src)) throw new Error(`source is one of ${SOURCES.join(', ')}`)
  if (due != null && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error('due is YYYY-MM-DD')
  return withLock(root, () => {
    snapshot(root, now)
    const prefix = `T-${ymd(now)}-`
    const n = readEvents(root).filter((e) => e.ev === 'add' && e.id.startsWith(prefix)).map((e) => +e.id.slice(prefix.length)).reduce((a, b) => Math.max(a, b), 0) + 1
    const id = prefix + n
    append(root, { ev: 'add', id, said, source: src, title: title.trim(), assigned: (assigned && String(assigned).trim()) || 'lead', due: due ?? null, ...(kind ? { kind } : {}), ...(key ? { key } : {}), ...(from ? { from } : {}), ...(dueAt ? { dueAt } : {}) }, now, by)
    return readTasks(root).find((t) => t.id === id)
  })
}

// ⛔ A BLOCK NAMES WHO CAN UNBLOCK IT, IN ONE PLAIN LINE (#97): "owner: create the #dev channel, it has no id".
// "waiting" alone leaves the lead guessing who to ask, and nobody asks.
export const BLOCK_SHAPE = /^([^:\n]{2,40}):\s+(\S[^\n]{4,150})$/
export function blockOf(line) {
  const m = BLOCK_SHAPE.exec(String(line ?? '').trim())
  return m ? { who: m[1].trim(), what: m[2].trim() } : null
}
export function updateTask(root, id, patch = {}, { by = { kind: 'owner' }, now = Date.now() } = {}) {
  return withLock(root, () => {
    const t = find(root, id)
    if (FINAL.has(t.state)) throw new Error(`${id} is ${t.state}, which is final: add a new task`)
    if (patch.state === 'verified') throw new Error('use verify, with evidence and a proof')
    if (patch.state === 'dropped') throw new Error('use drop, with a reason')
    if (patch.state != null && !SETTABLE.has(patch.state)) throw new Error(`state is one of ${[...SETTABLE].join(', ')}`)
    if (patch.due != null && patch.due !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(patch.due)) throw new Error('due is YYYY-MM-DD')
    if (selfName(by)) {
      if (!isMine(root, by, t)) throw new Error(`${id} is not assigned to ${selfName(by, root)} (it is ${t.assigned}); a session works only its own tasks`)
      if (patch.assigned != null && patch.assigned !== t.assigned) throw new Error('a desk cannot reassign a task; tell the lead')
    }
    if (patch.state == null && patch.assigned == null && patch.due == null && !patch.note && !patch.blockedBy) throw new Error('update needs --state, --note, --assigned or --due')
    if (patch.note != null && !oneLine(patch.note)) throw new Error('a note is one line')
    if (patch.blockedBy != null && !blockOf(patch.blockedBy)) throw new Error('--blocked-by is one plain line, "<who can unblock it>: <what they must do>", such as "owner: create the #dev channel, it has no id"')
    if (patch.state === 'waiting' && !patch.blockedBy && !t.blocked) throw new Error('a task that is waiting says who can unblock it: add --blocked-by "<who>: <what they must do>" (one plain line)')
    if (patch.blockedBy != null && (patch.state ?? t.state) !== 'waiting') throw new Error('--blocked-by goes with --state waiting')
    snapshot(root, now)
    append(root, { ev: 'update', id, ...(patch.state ? { state: patch.state } : {}), ...(patch.assigned ? { assigned: patch.assigned } : {}), ...(patch.due != null ? { due: patch.due === '' ? null : patch.due } : {}), ...(patch.note ? { note: patch.note } : {}), ...(patch.blockedBy ? { blockedBy: patch.blockedBy.trim() } : {}) }, now, by)
    return find(root, id)
  })
}

export function verifyTask(root, id, { evidence, proof } = {}, { by = { kind: 'owner' }, now = Date.now() } = {}) {
  if (selfName(by)) throw new Error('only the lead verifies a task: a desk or session can say done, not checked')
  if (typeof evidence !== 'string' || !evidence.trim()) throw new Error('verify needs --evidence: a path, a link or what you saw')
  if (typeof proof !== 'string' || !proof.trim()) throw new Error('verify needs --proof: one line saying what the evidence proves')
  if (!oneLine(proof)) throw new Error('the proof is one line')
  return withLock(root, () => {
    const t = find(root, id)
    if (FINAL.has(t.state)) throw new Error(`${id} is ${t.state}, which is final`)
    snapshot(root, now)
    append(root, { ev: 'verify', id, evidence: evidence.trim(), proof: proof.trim() }, now, by)
    return find(root, id)
  })
}

export function dropTask(root, id, { reason } = {}, { by = { kind: 'owner' }, now = Date.now() } = {}) {
  if (selfName(by)) throw new Error('only the lead drops a task')
  if (typeof reason !== 'string' || reason.trim().length < 10) throw new Error('drop needs a --reason of at least 10 characters: why this is no longer wanted')
  return withLock(root, () => {
    const t = find(root, id)
    if (FINAL.has(t.state)) throw new Error(`${id} is ${t.state}, which is final`)
    snapshot(root, now)
    append(root, { ev: 'drop', id, reason: reason.trim() }, now, by)
    return find(root, id)
  })
}

// a case a script PROVED done (a posted note, an installed version): closed by its key, with the script's evidence
export function closeByKey(root, key, { evidence, proof }, { now = Date.now() } = {}) {
  return withLock(root, () => {
    const t = readTasks(root).find((x) => x.key === key && !FINAL.has(x.state))
    if (!t) return null
    append(root, { ev: 'verify', id: t.id, evidence: String(evidence).trim() || '-', proof: String(proof).trim() || '-' }, now, { kind: 'session', name: 'plugin' })
    return t.id
  })
}

// the plugin's own record that it rang someone about a task (never an update by the assignee)
export function ringsFor(root, fn, now = Date.now()) {
  return withLock(root, () => {
    const out = []
    fn(readTasks(root), (id, stage, key = null) => { append(root, { ev: 'ring', id, stage, key }, now, { kind: 'session', name: 'plugin' }); out.push({ id, stage, key }) })
    return out
  })
}

// ---- asks: a question between sessions is a case with a due time ---------------
// ⛔ AN ASK THAT NOBODY ANSWERS MUST NOT WAIT IN SILENCE (#97). `full` asked AICS and
// waited; nothing re-rang. An ask is a task of kind "ask": assigned to the one who must
// answer, from the one who asked, with dueAt. lib/follow.mjs rings it again when it is
// late and raises it to the lead, then the owner; an answer (or the answerer's message
// back to the asker, hooks/ask-track.mjs) closes it.
export const ASK_MINUTES = 30
// one name for one session: any lead name is 'lead', a desk's old or new name is its session
export function canonName(root, name) {
  const n = String(name ?? '').replace(/\s*\[[^\]]*\]\s*$/, '').trim()
  if (!n) return n
  try {
    if (n === 'lead' || allLeads(readOfficeConfig(root)).some((l) => l.names.includes(n))) return 'lead'
    const desks = officeRoster(root).desks
    // a desk's case session (desk-x--key) is the desk it works for: its replies are the desk's
    const kid = n.includes('--') ? childOf(root, n) : null
    if (kid) return desks.find((d) => d.name === kid.parent)?.session ?? n
    const d = deskOfSession(desks, n)
    if (d?.desk) return d.desk.session
  } catch {}
  return n
}
// is this a session the office knows by name: a lead, a desk, or a desk's case session
export function knownSession(root, name) {
  const n = String(name ?? '').trim()
  try {
    if (!n) return false
    if (allLeads(readOfficeConfig(root)).some((l) => l.names.includes(n))) return true
    return n.includes('--') ? !!childOf(root, n) : !!deskOfSession(officeRoster(root).desks, n)
  } catch { return false }
}
// who a caller is, as a task names it: 'lead', a desk's session, a dev session's name, 'owner'
export const actorName = (root, by) => (by?.kind === 'lead' ? 'lead' : selfName(by, root) ?? 'owner')

export function addAsk(root, { to, question, minutes } = {}, { by = { kind: 'owner' }, now = Date.now() } = {}) {
  if (typeof to !== 'string' || !to.trim()) throw new Error('ask needs --to: the session that must answer')
  if (typeof question !== 'string' || !question.trim()) throw new Error('ask needs --question')
  const mins = minutes == null ? ASK_MINUTES : Number(minutes)
  if (!(mins >= 1 && mins <= 7 * 24 * 60)) throw new Error('minutes is a number from 1 to 10080')
  const target = canonName(root, to), from = actorName(root, by)
  if (target === from) throw new Error('an ask goes to someone else')
  const q = question.trim().replace(/\s+/g, ' ')
  return addTask(root, { said: q, title: q.length > 100 ? q.slice(0, 99) + '…' : q, source: 'desk', assigned: target, kind: 'ask', from, dueAt: now + mins * 60_000 }, { by, now })
}

// the asked session answers (or the owner does); the ask is final
export function answerAsk(root, id, { text } = {}, { by = { kind: 'owner' }, now = Date.now() } = {}) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('answer needs --text: what you told them')
  return withLock(root, () => {
    const t = find(root, id)
    if (t.kind !== 'ask') throw new Error(`${id} is a task, not an ask: use update`)
    if (FINAL.has(t.state)) throw new Error(`${id} is ${t.state}, which is final`)
    const me = actorName(root, by)
    if (me !== 'owner' && canonName(root, t.assigned) !== me && canonName(root, t.from) !== me) throw new Error(`${id} was asked of ${t.assigned} by ${t.from}; only they (or the owner) close it`)
    snapshot(root, now)
    append(root, { ev: 'answer', id, text: text.trim().replace(/\s+/g, ' ').slice(0, 300) }, now, by)
    return find(root, id)
  })
}

// ---- hand-offs: work only someone outside the office can do ------------------
// ⛔ A CASE HANDED TO A PERSON WAITS ON THAT PERSON, NOT ON THE DESK (T-261114-75, 2026-11-14): one desk asked
// another to have a coworker check two box labels. Only he could answer; the ask rang the desk, then the lead, then the
// owner, and nothing she could do would stop it. handoff records who it went to, how, and the post it went in (ref);
// while it waits nobody is nudged (lib/follow.mjs, staleTasks), and after `days` it is said ONCE to the lead.
// relay is the answer path for that person's captured reply (the office's team-chat capture): it closes the case in
// their words and wakes the one who asked (an ASK-ANSWERED alert). Only the office's own process (no session) or the
// lead may relay: a desk saying "the coworker said …" is the forgery this guards.
export const HANDOFF_DAYS = 3
const shortLine = (v, max) => typeof v === 'string' && v.trim() && !/[\r\n]/.test(v) && v.trim().length <= max
export function handoffTask(root, id, { to, via, ref, days } = {}, { by = { kind: 'owner' }, now = Date.now() } = {}) {
  if (!shortLine(to, 60)) throw new Error('handoff needs --to: the person it went to, one short line (Sam)')
  if (!shortLine(via, 60)) throw new Error('handoff needs --via: how it reached them, one short line (team chat, Discord DM, email)')
  if (ref != null && !/^[\w.:#/-]{1,120}$/.test(String(ref))) throw new Error('--ref is the post or message id it went in (letters, digits, . : # / - _)')
  const d = days == null ? HANDOFF_DAYS : Number(days)
  if (!(d >= 1 && d <= 14)) throw new Error('--days is a number from 1 to 14')
  return withLock(root, () => {
    const t = find(root, id)
    if (FINAL.has(t.state)) throw new Error(`${id} is ${t.state}, which is final`)
    if (selfName(by) && !isMine(root, by, t)) throw new Error(`${id} is assigned to ${t.assigned}; only it (or the lead) hands it off`)
    if (ref != null && readTasks(root).some((x) => x.id !== t.id && !FINAL.has(x.state) && x.handed?.ref === String(ref))) throw new Error(`--ref ${ref} already names another open hand-off`)
    snapshot(root, now)
    append(root, { ev: 'handoff', id, to: to.trim(), via: via.trim(), ...(ref != null ? { ref: String(ref) } : {}), until: now + d * 24 * HOUR }, now, by)
    return find(root, id)
  })
}
const samePerson = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()
export function relayAnswer(root, { id, ref, who, via, text } = {}, { by = { kind: 'owner' }, now = Date.now(), cfg = null } = {}) {
  if (by?.kind !== 'owner' && by?.kind !== 'lead') throw new Error('relay is for the office\'s own reply capture (or the lead): a desk does not answer for a person')
  if (typeof text !== 'string' || !text.trim()) throw new Error('relay needs --text: what they said')
  if (!shortLine(who, 60)) throw new Error('relay needs --who: the person who answered')
  return withLock(root, () => {
    const all = readTasks(root)
    const t = id ? all.find((x) => x.id === id) : ref ? all.find((x) => !FINAL.has(x.state) && x.handed?.ref === String(ref)) : null
    if (!t) throw new Error(id ? `no task ${id}` : ref ? `no open hand-off with --ref ${ref}` : 'relay needs the task id or --ref')
    if (FINAL.has(t.state)) throw new Error(`${t.id} is ${t.state}, which is final`)
    if (!t.handed) throw new Error(`${t.id} was not handed off: only a hand-off is answered by relay (tasks.mjs handoff first)`)
    if (!samePerson(t.handed.who, who)) throw new Error(`${t.id} was handed to ${t.handed.who}, not ${who}`)
    const words = text.trim().replace(/\s+/g, ' ').slice(0, 300)
    const relay = { who: t.handed.who, via: (typeof via === 'string' && via.trim()) ? via.trim().slice(0, 60) : t.handed.via }
    // the one waiting: the asker of an ask, the holder of a task. ⛔ THE ALERT IS WRITTEN BEFORE THE CASE IS CLOSED (as lib/follow.mjs):
    // a failed write throws and leaves it open for the capture's retry; closing first would close it with nobody told.
    // The line is a NUDGE the lead's bell forwards as it forwards ASK-DUE, short enough for the bell's 300 characters.
    const wake = t.kind === 'ask' ? t.from : t.assigned
    if (wake) {
      const c = cfg ?? readOfficeConfig(root), subject = canonName(root, wake)
      writeAlert(root, c, { type: 'ASK-ANSWERED', kase: t.id, subject, text: `NUDGE ${subject} ${t.id}: ${relay.who} answered (${relay.via}): "${words.length > 170 ? words.slice(0, 169) + '…' : words}"`, now })
    }
    snapshot(root, now)
    // an ask is answered; a task handed off is done in their words (the lead still verifies it)
    if (t.kind === 'ask') append(root, { ev: 'answer', id: t.id, text: `${relay.who} (${relay.via}): ${words}`, relay }, now, by)
    else append(root, { ev: 'update', id: t.id, state: 'done', note: `${relay.who} answered (${relay.via}): ${words}` }, now, by)
    return { ...find(root, t.id), relay, wake: wake ?? null }
  })
}

// a message from `from` to `to` answers every open ask `to` put to `from`; and (track) a
// question from `from` to `to` opens one, once while one is open. -> ids
export function isQuestion(text) {
  const t = String(text ?? '')
  if (/^\s*ask\b/i.test(t)) return true
  const own = t
    .replace(/```[\s\S]*?```/g, ' ')                       // code blocks
    .replace(/^\s*>.*$/gm, ' ')                            // quoted lines
    .replace(/"[^"\n]*"|“[^”\n]*”|'[^'\n]{12,}'/g, ' ')     // quoted text
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+|\bwww\.\S+/gi, ' ') // URLs, with their query strings
  return /\?(?=\s|$|[)"'])/.test(own)
}

// "on it" is an acknowledgement, not an answer: the ask stays open and keeps its clock
export const isAck = (text) => { const t = String(text ?? '').trim(); return t.length <= 80 && /^(on it|ok(ay)?|got it|ack(nowledged)?|noted|looking( into it)?|checking|working on it|will do|one moment|give me a (minute|moment))\b[\s.!,:;-]*$/i.test(t) || (t.length <= 80 && /^(on it|got it|looking|checking|will do)\b/i.test(t) && !/\b(done|posted|sent|yes|no|here)\b/i.test(t)) }
export function ackAsksByReply(root, { from, to }, { now = Date.now() } = {}) {
  const f = canonName(root, from), t = canonName(root, to)
  const open = readTasks(root).filter((x) => x.kind === 'ask' && !FINAL.has(x.state) && canonName(root, x.assigned) === f && canonName(root, x.from) === t)
  return open.map((x) => withLock(root, () => { append(root, { ev: 'ack', id: x.id, text: '(acknowledged by message, not answered)' }, now, { kind: 'session', name: f }); return x.id }))
}
export function closeAsksByReply(root, { from, to }, { now = Date.now() } = {}) {
  const f = canonName(root, from), t = canonName(root, to)
  // a hand-off stays open: "handed to Sam, waiting" told to the asker is not the answer; the person's reply (relay) is
  const open = readTasks(root).filter((x) => x.kind === 'ask' && !FINAL.has(x.state) && !x.handed && canonName(root, x.assigned) === f && canonName(root, x.from) === t)
  return open.map((x) => withLock(root, () => { append(root, { ev: 'answer', id: x.id, text: '(replied by message)' }, now, { kind: 'session', name: f }); return x.id }))
}
export function trackAsk(root, { from, to, text }, { now = Date.now(), minutes } = {}) {
  const f = canonName(root, from), t = canonName(root, to)
  if (!f || !t || f === t) return null
  if (readTasks(root).some((x) => x.kind === 'ask' && !FINAL.has(x.state) && canonName(root, x.assigned) === t && canonName(root, x.from) === f)) return null
  const by = f === 'lead' ? { kind: 'lead' } : { kind: 'session', name: f }
  return addAsk(root, { to: t, question: text, minutes }, { by, now })
}

// ---- views ---------------------------------------------------------------
export const age = (ms) => (ms < HOUR ? `${Math.max(0, Math.floor(ms / 60_000))}m` : ms < 24 * HOUR ? `${Math.floor(ms / HOUR)}h` : `${Math.floor(ms / (24 * HOUR))}d`)
const overdue = (t, now) => !!t.due && OPEN.has(t.state) && t.due < isoDay(now)

export function usageLines() {
  const cli = fileURLToPath(import.meta.url)
  return [
    `put down:  node ${cli} add --said "<the owner's words>" --title "<short>" [--assigned <session>] [--due YYYY-MM-DD] [--source chat|discord|desk|alert]`,
    `  node ${cli} update T-… --state working|done [--note "…"]  |  update T-… --state waiting --blocked-by "<who can unblock>: <what>"  |  verify T-… --evidence "…" --proof "<one line>"  |  drop T-… --reason "…"  |  list [--all] [--json]`,
  ]
}

// the compact table a context reset can not lose. '' when nothing is open.
export function openTable(root, { now = Date.now() } = {}) {
  const open = readTasks(root).filter((t) => !FINAL.has(t.state)).sort((a, b) => a.created - b.created)
  if (!open.length) return ''
  const rows = open.map((t) => `${t.id}  ${age(now - t.created)}  ${t.state}  ${t.assigned}  ${t.title.slice(0, 60)}${t.title.length > 60 ? '…' : ''}${overdue(t, now) ? `  OVERDUE (due ${t.due})` : ''}${t.blocked ? `  WAITING ON ${t.blocked.who}: ${t.blocked.what}` : ''}`)
  return [`OPEN TASKS (${open.length}): what the owner asked and has not seen finished. Close each with evidence (verify) or a reason (drop).`, ...rows, ...usageLines()].join('\n')
}

// the same name, with or without the desk- prefix
// a filter word and an assignee are one when they are equal, or both name one
// desk (its id, its name, any name it answers to: lib/desk.mjs answersTo)
// (no roster: a bare id and desk-<id> are one, as before)
const bare = (w) => (DESK_NAME.test(w) ? { name: w, title: w, names: namesOf({ title: w, name: w }) } : null)
const sameName = (a, b, desks = []) => {
  const x = String(a ?? ''), y = String(b ?? '')
  if (x === y) return true
  if (desks.some((d) => answersTo(d, x) && answersTo(d, y))) return true
  return [bare(x), bare(y)].some((d) => d && answersTo(d, x) && answersTo(d, y))
}
export function filterTasks(tasks, { assigned, overdue, owner, desks = [] } = {}, now = Date.now()) {
  return tasks.filter((t) => (!assigned || sameName(t.assigned, assigned, desks)) && (!owner || t.assigned === 'owner') && (!overdue || overdue_(t, now)))
}
const overdue_ = (t, now) => !!t.due && OPEN.has(t.state) && t.due < isoDay(now)

// what ONE session holds: only the tasks assigned to its name, and only what it may do about them.
// '' when it has none.
export function sessionTable(root, name, { now = Date.now() } = {}) {
  const mine = filterTasks(readTasks(root), { assigned: name, desks: officeRoster(root).desks }, now).filter((t) => !FINAL.has(t.state)).sort((a, b) => a.created - b.created)
  if (!mine.length) return ''
  const cli = fileURLToPath(import.meta.url)
  return [
    `YOUR TASKS (${mine.length}), assigned to ${name} by the lead for the owner. Work them, and keep them true:`,
    ...mine.map((t) => `${t.id}  ${t.state}  ${t.title.slice(0, 60)}${t.title.length > 60 ? '…' : ''}${t.due ? `  due ${t.due}` : ''}${overdue_(t, now) ? '  OVERDUE' : ''}${t.handed ? `  HANDED TO ${t.handed.who} (${t.handed.via})` : ''}`),
    `update:  node ${cli} update T-... --state working|done --note "<what changed>"   (the lead verifies; you never verify or drop)`,
    `only a person outside the office can do it:  node ${cli} handoff T-... --to "<person>" --via "<channel>" [--ref <post id>]   (it waits for them, no nudges)`,
  ].join('\n')
}

// the day's summary. The first section is plain text and fits one Discord post.
export function digestText(root, { now = Date.now() } = {}) {
  const all = readTasks(root)
  const open = all.filter((t) => OPEN.has(t.state) || t.state === 'done').sort((a, b) => a.created - b.created)
  const by = new Map()
  for (const t of open) { const k = t.assigned; const r = by.get(k) ?? { open: 0, over: 0 }; r.open++; if (overdue_(t, now)) r.over++; by.set(k, r) }
  const over = open.filter((t) => overdue_(t, now))
  const fin = all.filter((t) => (t.state === 'done' || t.state === 'verified') && now - Math.max(t.closedAt ?? 0, t.doneAt ?? 0) < 24 * HOUR)
  const row = (t) => `${t.id} ${t.title.slice(0, 60)} (${t.assigned}${t.due ? `, due ${t.due}` : ''})`
  // each list shows its first eight and says how many more: a long one must not push the other off the post
  const cap = (l) => [...l.slice(0, 8).map(row), ...(l.length > 8 ? [`+${l.length - 8} more (see digest.md)`] : [])]
  const head = [`# Task queue ${isoDay(now)}: ${open.length} open`, ...[...by].sort((a, b) => b[1].open - a[1].open).map(([k, r]) => `${k}: ${r.open} open (${r.over} overdue)`), `OVERDUE: ${over.length}`, `done in the last 24 h: ${fin.length}`]
  // the lists come after the counts, so a long one is the part that gets cut
  let first = [...head, ...(over.length ? ['OVERDUE:', ...cap(over)] : []), ...(fin.length ? ['DONE:', ...cap(fin)] : [])].join('\n')
  if (first.length > 1800) first = first.slice(0, 1790).replace(/\n[^\n]*$/, '') + '\n…'
  const detail = open.map((t) => `${t.id}  ${age(now - t.created)}  ${t.state}  ${t.assigned}  ${t.title}${t.due ? `  due ${t.due}` : ''}`)
  return open.length || fin.length ? `${first}\n\n## All open work\n${detail.join('\n')}\n` : ''
}

// .office/digest.md, once a day, from 08:00 local; nothing to say writes nothing
export function writeDigest(root, { now = Date.now() } = {}) {
  if (new Date(now).getHours() < 8) return { written: false, why: 'before 08:00' }
  const f = join(root, '.office', 'digest.md')
  const day = isoDay(now)
  try { if (readFileSync(f, 'utf8').startsWith(`# Task queue ${day}`)) return { written: false, why: 'already written today' } } catch {}
  const text = digestText(root, { now })
  if (!text) return { written: false, why: 'nothing to say' }
  mkdirSync(join(root, '.office'), { recursive: true })
  writeFileSync(f, text)
  return { written: true, file: f }
}

// THE BOARD'S VIEW: the same fold, grouped by assignee. Read-only; closed work is listed apart.
export function queueView(root, { now = Date.now() } = {}) {
  const all = readTasks(root).sort((a, b) => a.created - b.created)
  const stale = new Set(staleTasks(root, { now }).map((t) => t.id))
  const row = (t) => ({ id: t.id, title: t.title, said: t.said, state: t.state, assigned: t.assigned, due: t.due, age: age(now - t.created), idle: age(now - t.updated), overdue: overdue_(t, now), stale: stale.has(t.id), blocked: t.blocked ? { who: t.blocked.who, what: t.blocked.what } : null,
    notes: t.notes, evidence: t.evidence.map((e) => ({ evidence: e.evidence, proof: e.proof, at: e.at })), ...(t.reason ? { reason: t.reason } : {}) })
  const live = all.filter((t) => !FINAL.has(t.state))
  const names = [...new Set(live.map((t) => t.assigned))]
  const assignees = names.map((name) => {
    const tasks = live.filter((t) => t.assigned === name).map(row)
    const counts = { open: 0, working: 0, waiting: 0, done: 0 }
    for (const t of tasks) counts[t.state]++
    return { name, counts, overdue: tasks.filter((t) => t.overdue).length, stale: tasks.filter((t) => t.stale).length, tasks }
  }).sort((a, b) => b.overdue - a.overdue || b.tasks.length - a.tasks.length || a.name.localeCompare(b.name))
  // the assignees keep first-seen order when equal; the sort above is for the board
  const totals = { open: 0, working: 0, waiting: 0, done: 0, overdue: 0, stale: 0 }
  for (const a of assignees) { for (const k of ['open', 'working', 'waiting', 'done']) totals[k] += a.counts[k]; totals.overdue += a.overdue; totals.stale += a.stale }
  const closed = all.filter((t) => FINAL.has(t.state)).sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)).slice(0, 30).map(row)
  return { at: now, assignees, totals, closed }
}

// A task's evidence for the board: only what a task RECORDED (never a path from the request),
// a file only when it resolves inside the office and is not a secret, a link as a link.
export function evidenceOf(root, id, n) {
  const refuse = (why) => ({ kind: 'refused', why })
  const t = readTasks(root).find((x) => x.id === id)
  const e = t?.evidence[Number(n)]
  if (!e) return refuse('no such evidence')
  const text = String(e.evidence)
  if (/^https?:\/\/\S+$/.test(text)) return { kind: 'link', url: text }
  if (/[\r\n]/.test(text) || /\s/.test(text.trim()) || text.length > 300) return { kind: 'note', content: text }
  let real, top
  try { top = realpathSync(root); real = realpathSync(resolve(root, text)) } catch { return { kind: 'note', content: text } }
  if (real !== top && !real.startsWith(top + sep)) return refuse('that file is outside the office')
  const rel = real.slice(top.length + 1)
  if (/(^|\/)(\.env[^/]*|\.dev\.vars|runtime|\.claude|\.git)(\/|$)|secret|token|credential|\.pem$|\.key$/i.test(rel)) return refuse('that file is not shown by the board')
  try {
    const st = statSync(real)
    if (!st.isFile()) return refuse('not a file')
    if (st.size > 2_000_000) return refuse('too large to show')
    const buf = readFileSync(real)
    if (buf.includes(0)) return refuse('binary file')
    return { kind: 'text', content: buf.toString('utf8'), path: rel }
  } catch { return refuse('cannot read it') }
}

// open with no update for a day, or done and not checked for six hours
export function staleTasks(root, { now = Date.now() } = {}) {
  const out = []
  for (const t of readTasks(root)) {
    if (t.handed && now < t.handed.until) continue
    if (OPEN.has(t.state) && now - t.updated > OPEN_STALE) out.push({ id: t.id, title: t.title, assigned: t.assigned, quiet: true, hours: Math.floor((now - t.updated) / HOUR), why: `open ${Math.floor((now - t.updated) / HOUR)}h with no update` })
    else if (t.state === 'done' && now - (t.doneAt ?? t.updated) > DONE_STALE) out.push({ id: t.id, title: t.title, assigned: t.assigned, why: `done ${Math.floor((now - (t.doneAt ?? t.updated)) / HOUR)}h ago and not verified` })
  }
  return out
}

// ---- the command line ------------------------------------------------------
const COMMANDS = new Set(['add', 'update', 'verify', 'drop', 'list', 'digest', 'ask', 'answer', 'handoff', 'relay'])
function parse(argv) {
  const words = [], flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) flags[k] = true; else { flags[k] = v; i++ } } else words.push(a)
  }
  return { words, flags }
}

export function run(argv, { cwd = process.cwd(), env = process.env, out = (s) => console.log(s) } = {}) {
  let { words, flags } = parse(argv)
  let root = null
  if (words.length && !COMMANDS.has(words[0])) root = findOffice(resolve(words.shift()))
  root = root ?? findOffice(cwd)
  const cmd = words.shift()
  if (!root || !COMMANDS.has(cmd)) throw new Error('usage: node lib/tasks.mjs [root] add|update|verify|drop|list …  (run inside an office)')
  const cfg = readOfficeConfig(root)
  const w = whoIs(root, cfg, { cwd, env })
  if (w?.kind === 'unknown') throw new Error(`this session calls itself ${w.role}, and this office has no such desk`)
  const sess = w?.kind ? null : (env[cfg.roleEnv] || sessionName({ configDir: env.CLAUDE_CONFIG_DIR || undefined }))
  const by = w?.kind === 'lead' ? { kind: 'lead' } : w?.kind === 'desk' ? { kind: 'desk', desk: w.desk } : sess ? { kind: 'session', name: sess } : { kind: 'owner' }
  const str = (v) => (typeof v === 'string' ? v : undefined)
  if (cmd === 'add') { const t = addTask(root, { said: str(flags.said), title: str(flags.title), source: str(flags.source), assigned: str(flags.assigned), due: str(flags.due) }, { by }); out(`${t.id} added (${t.assigned})`) }
  else if (cmd === 'update') { const t = updateTask(root, words[0], { state: str(flags.state), note: str(flags.note), assigned: str(flags.assigned), due: flags.due === true ? '' : str(flags.due), blockedBy: str(flags['blocked-by']) }, { by }); out(`${t.id} ${t.state} (${t.assigned})`) }
  else if (cmd === 'verify') { const t = verifyTask(root, words[0], { evidence: str(flags.evidence), proof: str(flags.proof) }, { by }); out(`${t.id} verified`) }
  else if (cmd === 'digest') { const r = writeDigest(root); out(r.written ? `digest written: ${r.file}` : `no digest: ${r.why}`) }
  else if (cmd === 'ask') { const t = addAsk(root, { to: str(flags.to), question: str(flags.question), minutes: str(flags.minutes) }, { by }); out(`${t.id} asked of ${t.assigned}, due in ${Math.round((t.dueAt - Date.now()) / 60000)} min`) }
  else if (cmd === 'answer') { const t = answerAsk(root, words[0], { text: str(flags.text) }, { by }); out(`${t.id} answered`) }
  else if (cmd === 'handoff') { const t = handoffTask(root, words[0], { to: str(flags.to), via: str(flags.via), ref: str(flags.ref), days: str(flags.days) }, { by }); out(`${t.id} handed to ${t.handed.who} via ${t.handed.via}: waiting, no nudges until ${new Date(t.handed.until).toISOString().slice(0, 16)}Z`) }
  else if (cmd === 'relay') { const t = relayAnswer(root, { id: words[0], ref: str(flags.ref), who: str(flags.who), via: str(flags.via), text: str(flags.text) }, { by }); out(`${t.id} ${t.state} by ${t.relay?.who ?? t.answeredBy}; ${t.wake ? `${t.wake} told` : 'nobody to tell'}`) }
  else if (cmd === 'drop') { const t = dropTask(root, words[0], { reason: str(flags.reason) }, { by }); out(`${t.id} dropped`) }
  else {
    const all = readTasks(root).sort((a, b) => a.created - b.created)
    const live = flags.all ? all : all.filter((t) => !FINAL.has(t.state))
    const filtered = flags.assigned || flags.overdue || flags.owner
    const shown = filterTasks(live, { assigned: str(flags.assigned), overdue: !!flags.overdue, owner: !!flags.owner, desks: officeRoster(root).desks })
    if (flags.json) out(JSON.stringify(shown, null, 2))
    else out(flags.all || filtered ? (shown.map((t) => `${t.id}  ${t.state}  ${t.assigned}  ${t.title}`).join('\n') || 'no tasks') : (openTable(root) || 'no open tasks'))
  }
}

if (isMain(import.meta.url)) {
  try { run(process.argv.slice(2)) } catch (e) { console.error(`tasks: ${e.message}`); process.exit(1) }
}
