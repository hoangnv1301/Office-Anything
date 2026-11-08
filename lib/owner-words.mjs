// THE OWNER'S WORDS, RECORDED NATIVELY (owner, 2026-11-08: "you should have record what I said better ... we are
// missing many things during discussion"). An ask lived only in a long chat, and a compaction lost it.
//
//   .office/owner-words.jsonl   append-only EVENTS, one JSON per line (folded on read, like tasks.jsonl):
//     add   { ev:'add',  id:'W-YYMMDD-n', at, session, text, src? }      text VERBATIM, state is "open"
//     close { ev:'done'|'task'|'no-action', id, at, by, note?, taskId? }
//
// ⛔ CAPTURE IS A HOOK, NOT A HABIT (hooks/owner-words.mjs, UserPromptSubmit): every genuine typed prompt of an
// owner-facing session lands here before the model sees it. Not recorded: the office's own typed text, system
// traffic (task notices, hook feedback, peer envelopes), approval phrases, bare acks, and anything shaped like a key.
// ⛔ A SESSION CLOSES ONLY ITS OWN WORDS. done needs a note, no-action needs a why, task turns the words into a task
// (lib/tasks.mjs) whose "said" is the owner's text. An open word older than 24 h is an ALARM (boot and board).
//
//   node lib/owner-words.mjs [root] list [--all] [--json]
//   node lib/owner-words.mjs [root] done W-… --note "<what was done>"
//   node lib/owner-words.mjs [root] task W-… [--title "…"] [--assigned <session>] [--due YYYY-MM-DD]
//   node lib/owner-words.mjs [root] no-action W-… --why "<why nothing is needed>"
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync, unlinkSync, openSync, readSync, closeSync, fstatSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findOffice, readOfficeConfig } from './office.mjs'
import { ownerFacing, parseApproval } from './approvals.mjs'
import { wasOfficeTyped, textHash } from './typed-mark.mjs'
import { addTask } from './tasks.mjs'
import { isSystemText } from '../board/transcript.mjs'
import { scanText } from './secrets.mjs'
import { isMain } from './is-main.mjs'

const HOUR = 3600_000
export const ALARM_AFTER = 24 * HOUR
export const BOOT_CAP = 5
const MAX_TEXT = 8000
const TAIL_BYTES = 512 * 1024
export const wordsFile = (root) => join(root, '.office', 'owner-words.jsonl')
const two = (n) => String(n).padStart(2, '0')
const ymd = (ms) => { const d = new Date(ms); return `${String(d.getFullYear()).slice(2)}${two(d.getMonth() + 1)}${two(d.getDate())}` }
export const age = (ms) => (ms < HOUR ? `${Math.max(0, Math.floor(ms / 60_000))}m` : ms < 24 * HOUR ? `${Math.floor(ms / HOUR)}h` : `${Math.floor(ms / (24 * HOUR))}d`)

// ---- reading: the fold ----------------------------------------------------
export function readWords(root) {
  let text = ''
  try { text = readFileSync(wordsFile(root), 'utf8') } catch { return [] }
  const words = new Map()
  for (const l of text.split('\n')) {
    if (!l.trim()) continue
    let e; try { e = JSON.parse(l) } catch { continue }
    if (!e?.id) continue
    if (e.ev === 'add') { if (!words.has(e.id)) words.set(e.id, { id: e.id, at: e.at, session: e.session, text: e.text, src: e.src ?? null, state: 'open', closedAt: null, closedBy: null, note: null, taskId: null }) }
    else if (['done', 'task', 'no-action'].includes(e.ev)) { const w = words.get(e.id); if (w && w.state === 'open') Object.assign(w, { state: e.ev, closedAt: e.at, closedBy: e.by, note: e.note ?? null, taskId: e.taskId ?? null }) }
  }
  return [...words.values()]
}
export const openWords = (root, session) => readWords(root).filter((w) => w.state === 'open' && (!session || w.session === session))
export const alarmWords = (root, { session, now = Date.now() } = {}) => openWords(root, session).filter((w) => now - w.at > ALARM_AFTER)

// ---- writing: one lock, one append ------------------------------------------
const sleepMs = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } catch {} }
function withLock(root, fn) {
  const dir = join(root, '.office')
  mkdirSync(dir, { recursive: true })
  if (!existsSync(join(dir, '.gitignore'))) writeFileSync(join(dir, '.gitignore'), '# office-anything state and logs; never committed\n*\n')
  const lock = join(dir, 'owner-words.lock')
  const t0 = Date.now()
  for (;;) {
    try { writeFileSync(lock, String(process.pid), { flag: 'wx' }); break } catch {}
    try { if (Date.now() - statSync(lock).mtimeMs > 10_000) { unlinkSync(lock); continue } } catch {}
    if (Date.now() - t0 > 8000) throw new Error('owner-words: the file is locked by another writer; try again')
    sleepMs(15 + Math.random() * 25)
  }
  try { return fn() } finally { try { unlinkSync(lock) } catch {} }
}
const append = (root, e) => appendFileSync(wordsFile(root), JSON.stringify(e) + '\n')

// ---- capture ---------------------------------------------------------------
const ACK = /^\W*(y|yes|yep|yeah|ok|okay|k|no|nope|thanks|thank you|thx|continue|go|go on|go ahead|done|good|great|sure|stop)\W*$/i
// -> why this prompt is NOT recorded, or null when it is the owner's words
export function skipReason(root, text) {
  if (typeof text !== 'string' || !text.trim()) return 'empty'
  if (isSystemText(text)) return 'system traffic'
  if (/^\s*\/[a-z][\w:-]*(\s|$)/i.test(text) && text.trim().length < 120) return 'a slash command'
  if (parseApproval(text)) return 'an approval phrase'
  if (ACK.test(text)) return 'a bare ack'
  if (root && wasOfficeTyped(root, text)) return 'typed by the office'
  if (scanText(text).length) return 'looks like a credential'
  return null
}
// -> the new word, or null (not recorded). The same text by the same session within a minute, or the same
// transcript entry (src), is one word.
export function recordWords(root, { session, text, src = null }, { now = Date.now() } = {}) {
  if (!session || skipReason(root, text)) return null
  const body = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + '\n[cut at 8000 characters]' : text
  return withLock(root, () => {
    const all = readWords(root)
    const h = textHash(body)
    if (src && all.some((w) => w.src === src)) return null
    if (all.some((w) => w.session === session && now - w.at < 60_000 && textHash(w.text) === h)) return null
    const prefix = `W-${ymd(now)}-`
    const n = all.filter((w) => w.id.startsWith(prefix)).map((w) => +w.id.slice(prefix.length)).reduce((a, b) => Math.max(a, b), 0) + 1
    append(root, { ev: 'add', id: prefix + n, at: now, session, text: body, ...(src ? { src } : {}) })
    return readWords(root).find((w) => w.id === prefix + n)
  })
}

// ⚠ A MESSAGE TYPED MID-TURN fires no UserPromptSubmit: Claude Code queues it and writes an attachment line,
// type queued_command, origin {kind:"human"} (see board/transcript.mjs). Read the tail of the transcript and record
// the human ones not seen yet (by their own uuid). -> how many were recorded.
export function recordQueued(root, session, transcript, { now = Date.now() } = {}) {
  let buf = ''
  let fd
  try { fd = openSync(transcript, 'r'); const size = fstatSync(fd).size, from = Math.max(0, size - TAIL_BYTES); const b = Buffer.alloc(size - from); readSync(fd, b, 0, b.length, from); buf = b.toString('utf8') } catch { return 0 } finally { if (fd !== undefined) closeSync(fd) }
  let n = 0
  for (const line of buf.split('\n')) {
    if (!line.includes('queued_command')) continue
    let j; try { j = JSON.parse(line) } catch { continue }
    const a = j?.type === 'attachment' ? j.attachment : null
    if (a?.type !== 'queued_command' || a.origin?.kind !== 'human' || a.commandMode === 'task-notification') continue
    const text = typeof a.prompt === 'string' ? a.prompt : Array.isArray(a.prompt) ? a.prompt.filter((x) => x?.type === 'text').map((x) => x.text).join('\n') : ''
    const src = a.source_uuid ?? j.uuid
    if (src && recordWords(root, { session, text, src: String(src) }, { now })) n++
  }
  return n
}

// ---- closing the loop: only the session's own words ---------------------------
function mine(root, id, session) {
  const w = readWords(root).find((x) => x.id === id)
  if (!w) throw new Error(`no owner word ${id}`)
  if (w.session !== session) throw new Error(`${id} was said in ${w.session}; only that session closes it`)
  if (w.state !== 'open') throw new Error(`${id} is already closed (${w.state})`)
  return w
}
const oneLineTitle = (t) => { const s = t.replace(/\s+/g, ' ').trim(); return s.length > 80 ? s.slice(0, 79) + '…' : s }
export function closeWord(root, id, kind, { session, note, why, title, assigned, due }, { now = Date.now() } = {}) {
  const need = (v, what) => { if (typeof v !== 'string' || v.trim().length < 3) throw new Error(`${kind} needs ${what}`) }
  if (kind === 'done') need(note, '--note: what was done')
  if (kind === 'no-action') need(why, '--why: why nothing is needed')
  return withLock(root, () => {
    const w = mine(root, id, session)
    let taskId
    if (kind === 'task') taskId = addTask(root, { said: w.text, title: title || oneLineTitle(w.text), assigned: assigned || session, due, source: 'chat' }, { by: { kind: 'session', name: session }, now }).id
    append(root, { ev: kind, id, at: now, by: session, ...(kind === 'done' ? { note: note.trim() } : {}), ...(kind === 'no-action' ? { note: why.trim() } : {}), ...(taskId ? { taskId, note: `task ${taskId}` } : {}) })
    return readWords(root).find((x) => x.id === id)
  })
}

// ---- views -----------------------------------------------------------------
const cliPath = () => fileURLToPath(import.meta.url)
const short = (t, n = 90) => { const s = t.replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s }
// the short block a session boot shows. '' when nothing is open.
export function bootBlock(root, session, { now = Date.now() } = {}) {
  const open = openWords(root, session).sort((a, b) => b.at - a.at)
  if (!open.length) return ''
  const late = open.filter((w) => now - w.at > ALARM_AFTER)
  const lines = [`OWNER WORDS STILL OPEN (${open.length}), what the owner said in this session and nobody closed:`]
  if (late.length) { const o = late[late.length - 1]; lines.push(`ALARM: ${late.length} open more than 24h (oldest ${o.id}, ${age(now - o.at)}). Close each, or tell the owner why not.`) }
  for (const w of open.slice(0, BOOT_CAP)) lines.push(`${w.id}  ${age(now - w.at)}  "${short(w.text)}"${now - w.at > ALARM_AFTER ? '  ALARM' : ''}`)
  if (open.length > BOOT_CAP) lines.push(`+${open.length - BOOT_CAP} more: node ${cliPath()} list`)
  lines.push(`close:  node ${cliPath()} done W-… --note "…"  |  task W-… [--title "…"]  |  no-action W-… --why "…"`)
  return lines.join('\n')
}
// the board's view: open words per session, the oldest one's age, alarms
export function boardView(root, { now = Date.now() } = {}) {
  const by = new Map()
  for (const w of openWords(root)) { const r = by.get(w.session) ?? { session: w.session, open: 0, alarms: 0, oldest: 0 }; r.open++; if (now - w.at > ALARM_AFTER) r.alarms++; r.oldest = Math.max(r.oldest, now - w.at); by.set(w.session, r) }
  const sessions = [...by.values()].map((r) => ({ ...r, oldest: age(r.oldest) })).sort((a, b) => b.alarms - a.alarms || b.open - a.open || a.session.localeCompare(b.session))
  return { sessions, open: sessions.reduce((n, s) => n + s.open, 0), alarms: sessions.reduce((n, s) => n + s.alarms, 0) }
}

// ---- the command line ------------------------------------------------------
const COMMANDS = new Set(['list', 'done', 'task', 'no-action'])
function parse(argv) {
  const words = [], flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) flags[k] = true; else { flags[k] = v; i++ } } else words.push(a)
  }
  return { words, flags }
}
export function run(argv, { cwd = process.cwd(), env = process.env, out = (s) => console.log(s) } = {}) {
  const { words, flags } = parse(argv)
  let root = null
  if (words.length && !COMMANDS.has(words[0])) root = findOffice(resolve(words.shift()))
  root = root ?? findOffice(cwd)
  const cmd = words.shift()
  if (!root || !COMMANDS.has(cmd)) throw new Error('usage: node lib/owner-words.mjs [root] list|done|task|no-action …  (run inside an office)')
  const cfg = readOfficeConfig(root)
  const session = ownerFacing(root, cfg, { cwd, env })
  if (!session) throw new Error('this session has no owner words (a desk or an unknown session)')
  const str = (v) => (typeof v === 'string' ? v : undefined)
  if (cmd === 'list') {
    const shown = (flags.all ? readWords(root).filter((w) => w.session === session) : openWords(root, session)).sort((a, b) => b.at - a.at)
    out(flags.json ? JSON.stringify(shown, null, 2) : shown.map((w) => `${w.id}  ${w.state}  ${age(Date.now() - w.at)}  ${short(w.text, 120)}`).join('\n') || 'no open owner words')
    return
  }
  const w = closeWord(root, words[0], cmd, { session, note: str(flags.note), why: str(flags.why), title: str(flags.title), assigned: str(flags.assigned), due: str(flags.due) })
  out(`${w.id} ${w.state}${w.taskId ? ` (${w.taskId})` : ''}`)
}

if (isMain(import.meta.url)) {
  try { run(process.argv.slice(2)) } catch (e) { console.error(`owner-words: ${e.message}`); process.exit(1) }
}
