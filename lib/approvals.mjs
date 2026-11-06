// THE OWNER'S APPROVAL LEDGER (Office-Anything #97, 2026-11-06; reworked after review). The owner said yes in
// the `full` session; AICS rightly refused to act on a yes relayed by a peer, and asked the owner again in
// its own chat. An approval the owner gives must travel, and a peer's word must never count.
//
// HOW AN APPROVAL IS GIVEN. The owner types, as the first line of a prompt in an owner-facing session:
//
//     approve <action> target:<where> [hours:<1-168>] [once]
//
//     approve post-release-note target:#releases hours:12
//     approve notify-release target:David once
//
// ⛔ NO SESSION WRITES A GRANT. The UserPromptSubmit hook (hooks/typed-prompt.mjs) does, from that one line, and
// only that line: the action AND the target must both be named, there is no "approve everything", and there is
// no command to record one. A model that wants an approval asks the owner to type the line.
//
// HOW IT IS CHECKED. `check` (and the office's gates) re-verify the grant EVERY TIME against the transcript
// entry it cites: the file must be that session's own (<session id>.jsonl), the entry with the grant's promptId
// must be a user turn Claude Code marked turnOrigin "human" / promptSource "typed"|"queued", the approve line
// found there must hash to the grant's hash and say the same action, target, hours and once, and the text must
// not be one the office itself typed (lib/typed-mark.mjs: a scheduled job line, the usage-limit resume text,
// the doorbell kickoff all look "typed"). A grant line written by anything else fails this.
//
//   node lib/approvals.mjs [root] check  --action <what> --target <where> [--use]   exit 0 ok, 4 not approved
//   node lib/approvals.mjs [root] list [--all]
//   node lib/approvals.mjs [root] revoke A-… --reason "<why>"                         (only ever removes authority)
//   a damaged ledger is repaired by the owner typing: approve repair-ledger target:ledger   (archives it, starts empty)
//
// ⛔ SCOPE IS EXACT: a grant for (post, #releases) passes only (post, #releases). Desks never get a grant made for
// them (office.json approvals.desks: true lifts it). A gate refuses EVERY target a call names, and a --once grant
// is spent at the gate, not left to the caller.
// ⛔ FAIL CLOSED: an unreadable line in the ledger denies every gated call (and alerts); a gate whose regex does not
// compile denies all but office.json repairs (and alerts); a gate that throws denies; a broken office.json keeps
// enforcing the gates it last read cleanly.
// ⛔ THE LEDGER IS WALL-PROTECTED: the wall hook refuses any tool call that writes .office/approvals*, office-typed
// or gates-, in every session (ledgerWriteVerdict).
// HONEST LIMIT: a session that can write the transcript file, type into a terminal as a person, or run a program that
// bypasses the tool hooks (a script it wrote, another process of this user) can still forge a "typed" turn. The
// transcript is Claude Code's, outside this plugin; an office closes those roads with its own wall (local-cabinets-ops'
// owner-words guard does). This module makes forging need that, instead of one echo into a file.
import { chmodSync, appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync, unlinkSync, openSync, readSync, fstatSync, closeSync, realpathSync, copyFileSync } from 'node:fs'
import { join, resolve, basename, dirname, sep } from 'node:path'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { readOfficeConfig, findOffice, whoIs, sessionName } from './office.mjs'
import { isMain } from './is-main.mjs'
import { canonName } from './tasks.mjs'
import { wasOfficeTyped } from './typed-mark.mjs'
import { writeAlert } from './alerts.mjs'

const HOUR = 3600_000
export const MAX_HOURS = 7 * 24
const TAIL_BYTES = 8 << 20
export const ledgerFile = (root) => join(root, '.office', 'approvals.jsonl')
export const repairFile = (root) => join(root, '.office', 'repair-pending.json')

const norm = (s) => String(s).replace(/\s+/g, ' ').trim()
const sha = (s) => createHash('sha256').update(norm(s)).digest('hex')
// these two change what the whole office enforces: each approval is spent by its first use and is never a standing window
const ONCE_ONLY = new Set(['gates-change', 'repair-ledger'])
const isOnce = (a) => a.once || ONCE_ONLY.has(a.action)
const validAction = (a) => typeof a === 'string' && /^[a-z0-9][a-z0-9:_.-]{1,59}$/.test(a)

// ---- the phrase ------------------------------------------------------------------
const PHRASE = /^approve\s+([a-z0-9][a-z0-9:_.-]{1,59})\s+target:(\S{1,200})((?:\s+(?:hours:\d{1,3}|once))*)$/i
// the first non-empty line of a prompt -> { action, target, hours, once, line } | null
export function parseApproval(text) {
  const first = String(text ?? '').split('\n').map((l) => l.trim()).find(Boolean)
  const m = first ? PHRASE.exec(first) : null
  if (!m) return null
  let hours = 24, once = false
  for (const tok of m[3].trim().split(/\s+/).filter(Boolean)) {
    if (/^once$/i.test(tok)) once = true
    else hours = Number(tok.slice(6))
  }
  if (!(hours >= 1 && hours <= MAX_HOURS)) return null
  return { action: m[1].toLowerCase(), target: m[2], hours, once, line: norm(first) }
}

// who may speak for the owner: the lead, or a developer / role session; a desk only if the office says so
export function ownerFacing(root, cfg, { cwd, env = process.env, name } = {}) {
  const w = whoIs(root, cfg, { cwd, env, name })
  if (w?.kind === 'unknown') return null
  if (w?.kind === 'desk' && cfg.approvals?.desks !== true) return null
  return (typeof cfg.roleEnv === 'string' && env[cfg.roleEnv]) || name || sessionName({ configDir: env.CLAUDE_CONFIG_DIR || undefined }) || null
}

// ---- the ledger ------------------------------------------------------------------
function dir(root) {
  mkdirSync(join(root, '.office'), { recursive: true })
  if (!existsSync(join(root, '.office', '.gitignore'))) writeFileSync(join(root, '.office', '.gitignore'), '# office-anything state and logs; never committed\n*\n')
}
function withLedger(root, fn) {
  dir(root)
  const lock = join(root, '.office', 'approvals.lock')
  const t0 = Date.now()
  for (;;) {
    try { writeFileSync(lock, String(process.pid), { flag: 'wx' }); break } catch {}
    try { if (Date.now() - statSync(lock).mtimeMs > 10_000) { unlinkSync(lock); continue } } catch {}
    if (Date.now() - t0 > 8000) throw new Error('approvals: the ledger is locked by another writer; try again')
    try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20) } catch {}
  }
  try { return fn() } finally { try { unlinkSync(lock) } catch {} }
}
// ---- the ledger is signed and chained, with its key outside the office --------------------------------------------
// Every line carries `prev` (the previous line's MAC) and `mac` = HMAC(key, office id, the line). The key lives under
// ~/.config/office-anything/ (0700 dir, 0600 file), created by the UserPromptSubmit hook and named by no tool call (the wall refuses
// any call that names it). The newest MAC is also kept beside the key, so a line that is deleted, edited or inserted, or a tail that
// is cut off, breaks the chain or the head and poisons the ledger: check() trusts nothing then. This is the boundary; the regex wall
// over command text is a second layer only (variables, quoting, a script file all beat a regex).
// HONEST LIMIT: a process of this user that reads the key file (a program the agent wrote that computes the path) can still sign.
// The key is outside the office and outside the tool hooks' view, not outside the user's reach.
export const keyDir = () => process.env.OFFICE_ANYTHING_KEY_DIR || join(homedir(), '.config', 'office-anything')
const keyFile = () => join(keyDir(), 'approvals.key')
const officeId = (root) => createHash('sha256').update(real(root) ?? resolve(root)).digest('hex').slice(0, 16)
const headFile = (root) => join(keyDir(), `head-${officeId(root)}`)
function ensureKey() {
  const d = keyDir()
  mkdirSync(d, { recursive: true, mode: 0o700 })
  try { chmodSync(d, 0o700) } catch {}
  try { writeFileSync(keyFile(), randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }) } catch (e) { if (e.code !== 'EEXIST') throw e }
  return readFileSync(keyFile(), 'utf8').trim()
}
const readKey = () => { try { return readFileSync(keyFile(), 'utf8').trim() || null } catch { return null } }
const canon = (o) => JSON.stringify(Object.fromEntries(Object.keys(o).sort().filter((k) => k !== 'mac').map((k) => [k, o[k]])))
const macOf = (key, root, ev) => createHmac('sha256', key).update(`${officeId(root)}\n${canon(ev)}`).digest('hex')
const readHead = (root) => { try { return readFileSync(headFile(root), 'utf8').trim() || null } catch { return null } }

// -> { events, corrupt, last }: a line that is not a JSON object, has no valid MAC, or does not chain poisons the ledger
// (counted, never skipped); so does a head that does not match the last line.
export function readLedger(root) {
  let t = null
  try { t = readFileSync(ledgerFile(root), 'utf8') } catch (e) { if (e.code !== 'ENOENT') return { events: [], corrupt: 1, last: null } }
  const head = readHead(root)
  const lines = t == null ? [] : t.split('\n').filter((l) => l.trim())
  if (!lines.length) return head ? { events: [], corrupt: 1, last: null } : { events: [], corrupt: 0, last: null }
  const key = readKey()
  if (!key) return { events: [], corrupt: lines.length, last: null }
  const events = []
  let corrupt = 0, prev = 'genesis'
  for (const l of lines) {
    let e
    try { e = JSON.parse(l) } catch { corrupt++; continue }
    if (e && typeof e === 'object' && !Array.isArray(e) && typeof e.ev === 'string' && e.prev === prev && typeof e.mac === 'string' && e.mac === macOf(key, root, e)) { events.push(e); prev = e.mac } else corrupt++
  }
  if (!corrupt && head !== (prev === 'genesis' ? null : prev)) corrupt++
  return { events, corrupt, last: corrupt ? null : (prev === 'genesis' ? null : prev) }
}
// append one signed, chained event. Only the hook (a grant), a gate or the CLI (use, revoke) reach this.
function appendEvent(root, ev) {
  const led = readLedger(root)
  if (led.corrupt) throw new Error('the approval ledger is damaged; the owner repairs it with "approve repair-ledger target:ledger"')
  const key = ensureKey()
  const line = { ...ev, prev: led.last ?? 'genesis' }
  line.mac = macOf(key, root, line)
  dir(root)
  appendFileSync(ledgerFile(root), JSON.stringify(line) + '\n')
  writeFileSync(headFile(root), line.mac, { mode: 0o600 })
  return line
}
// the owner's repair: the damaged ledger is set aside and a new one starts EMPTY, so every earlier approval is gone (nothing is
// kept that could be a use or a revoke we can no longer tell apart). It can only remove authority.
export function resetLedger(root, { now = Date.now() } = {}) {
  return withLedger(root, () => {
    const f = ledgerFile(root)
    let aside = null
    if (existsSync(f)) { aside = join(root, '.office', `approvals.damaged-${new Date(now).toISOString().replace(/[^0-9]/g, '').slice(0, 14)}.jsonl`); copyFileSync(f, aside) }
    writeFileSync(f, '')
    try { unlinkSync(headFile(root)) } catch {}
    return { aside }
  })
}

// ⛔ ONE GRANT PER PROMPT, EVER. A session that runs the hook by hand with an old owner prompt's real ids would otherwise sign a fresh
// grant from it. The (session id, prompt id) pairs already used are kept beside the key (outside the office, MAC'd, kept across
// resets of the ledger); a pair is used once. A forged line in the list can only add a refusal.
const usedFile = (root) => join(keyDir(), `prompts-${officeId(root)}.jsonl`)
const usedKey = (sessionId, promptId) => createHash('sha256').update(`${sessionId}\n${promptId}`).digest('hex')
function promptUsed(root, k) {
  const key = readKey()
  if (!key) return false
  let t = ''
  try { t = readFileSync(usedFile(root), 'utf8') } catch { return false }
  for (const l of t.split('\n')) {
    if (!l.includes(k)) continue
    try { const e = JSON.parse(l); if (e.k === k && e.mac === createHmac('sha256', key).update(`${officeId(root)}\nused:${k}`).digest('hex')) return true } catch {}
  }
  return false
}
// ⛔ A PROMPT IS CLAIMED BEFORE ANYTHING CAN REFUSE IT: check-and-mark under one lock, so a refusal further on (a damaged ledger, a lock that
// would not open, an old turn) still leaves the prompt used and a later replay cannot win. A claim that cannot be made refuses the grant.
function claimPrompt(root, k) {
  mkdirSync(keyDir(), { recursive: true, mode: 0o700 })
  const lock = join(keyDir(), `prompts-${officeId(root)}.lock`)
  const t0 = Date.now()
  for (;;) {
    try { writeFileSync(lock, String(process.pid), { flag: 'wx' }); break } catch {}
    try { if (Date.now() - statSync(lock).mtimeMs > 10_000) { unlinkSync(lock); continue } } catch {}
    if (Date.now() - t0 > 5000) return false
    try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20) } catch {}
  }
  try {
    if (promptUsed(root, k)) return false
    usePrompt(root, k)
    return true
  } catch { return false } finally { try { unlinkSync(lock) } catch {} }
}
function usePrompt(root, k) {
  const key = ensureKey()
  appendFileSync(usedFile(root), JSON.stringify({ k, mac: createHmac('sha256', key).update(`${officeId(root)}\nused:${k}`).digest('hex') }) + '\n', { mode: 0o600 })
}

// the hook: a typed approval line becomes a grant. -> the grant | null (not an approval line, or not an owner-facing session)
export function grantFromPrompt(root, cfg, { session, sessionId, text, promptId, transcript, cwd = null }, { now = Date.now() } = {}) {
  const a = parseApproval(text)
  if (!a || !session) return null
  if (!promptId || !sessionId || typeof transcript !== 'string' || !transcript) return null   // nothing to verify it against later
  if (wasOfficeTyped(root, text, { now })) return null
  const pk = usedKey(sessionId, promptId)
  if (!claimPrompt(root, pk)) return null                // used already (its grant, its repair request, or a refusal), or the claim could not be made
  // ⛔ ONLY THE NEWEST HUMAN-TYPED TURN CAN MAKE A GRANT. When the cited prompt is already in the transcript it must be the last turn Claude
  // Code marked typed by a person: an older turn's real ids (replayed by a program run by hand) are refused. (A turn not yet written is
  // waited for: the check after it refuses a grant whose turn never appears.)
  if (turnIn(transcript, String(promptId)) && newestHumanPrompt(transcript) !== String(promptId)) return null
  // ⛔ THE OWNER'S REPAIR OF A DAMAGED LEDGER IS VERIFIED LIKE A GRANT (human-typed, that session's own transcript, this exact line).
  // The transcript entry may not be written yet when the hook runs, so the request waits in a pending file and is verified, here and
  // on every later check, before anything is reset. A peer turn or a `claude -p` run that carries the phrase resets nothing.
  if (a.action === 'repair-ledger' && a.target === 'ledger') {
    dir(root)
    writeFileSync(repairFile(root), JSON.stringify({ ev: 'grant', id: 'repair', at: now, session, sessionId: String(sessionId), promptId: String(promptId).slice(0, 100), transcript: transcript.slice(0, 500), cwd: typeof cwd === 'string' ? cwd.slice(0, 500) : null, hash: sha(a.line), quote: a.line, action: a.action, target: a.target, expires: now + a.hours * HOUR, max: isOnce(a) ? 1 : null }))
    return maybeRepair(root, { now }) ?? { pending: true }
  }
  return withLedger(root, () => {
    const led = readLedger(root)
    if (led.corrupt) return null
    const { events } = led
    const day = new Date(now).toISOString().slice(2, 10).replace(/-/g, '')
    const n = events.filter((e) => e.ev === 'grant' && String(e.id).startsWith(`A-${day}-`)).length + 1
    const g = { ev: 'grant', id: `A-${day}-${n}`, at: now, session, sessionId: String(sessionId), promptId: String(promptId).slice(0, 100), transcript: transcript.slice(0, 500), cwd: typeof cwd === 'string' ? cwd.slice(0, 500) : null, hash: sha(a.line), quote: a.line, action: a.action, target: a.target, expires: now + a.hours * HOUR, max: isOnce(a) ? 1 : null }
    return appendEvent(root, g)
  })
}

// ---- verification against the transcript, every time ----------------------------------
// the project folder Claude Code names for a working directory
export const projectDirName = (cwd) => resolve(cwd).replace(/[^A-Za-z0-9]/g, '-')
const real = (p) => { try { return realpathSync(p) } catch { return null } }
// -> why this grant's transcript is not in a place Claude Code keeps one | null
function transcriptPlace(root, g) {
  const file = real(g.transcript)
  if (!file) return 'its transcript file is not there'
  // ONLY CLAUDE CODE'S OWN FOLDERS: office.json is editable by an agent, so it can widen nothing here
  const dirs = [process.env.CLAUDE_CONFIG_DIR, join(homedir(), '.claude')].filter((d) => typeof d === 'string' && d).map(real).filter(Boolean)
  const proj = dirname(file)
  if (!dirs.some((d) => dirname(proj) === join(d, 'projects'))) return `its transcript (${file}) is not under a Claude Code projects folder (${dirs.map((d) => join(d, 'projects')).join(', ') || 'none found'})`
  // exact: the office's own project folder, or the folder of a working directory that really sits inside the office (a desk's)
  const top = real(root) ?? resolve(root)
  const mine = [projectDirName(top)]
  const c = typeof g.cwd === 'string' && g.cwd ? real(g.cwd) : null
  if (c && (c === top || c.startsWith(top + sep))) mine.push(projectDirName(c))
  const name = basename(proj)
  if (!mine.includes(name)) return `its transcript belongs to another project (${name}), not this office's`
  return null
}
// the promptId of the last prompt line Claude Code marked typed (or queued) by a person
function newestHumanPrompt(transcript) {
  let buf = ''
  let fd
  try { fd = openSync(transcript, 'r'); const size = fstatSync(fd).size, from = Math.max(0, size - TAIL_BYTES); const b = Buffer.alloc(size - from); readSync(fd, b, 0, b.length, from); buf = b.toString('utf8') } catch { return null } finally { if (fd !== undefined) closeSync(fd) }
  const lines = buf.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('turnOrigin')) continue
    let j; try { j = JSON.parse(lines[i]) } catch { continue }
    if (j?.type === 'user' && j.turnOrigin === 'human' && (j.promptSource === 'typed' || j.promptSource === 'queued') && typeof j.promptId === 'string') return j.promptId
  }
  return null
}
function turnIn(transcript, promptId) {
  let buf = ''
  let fd
  try { fd = openSync(transcript, 'r'); const size = fstatSync(fd).size, from = Math.max(0, size - TAIL_BYTES); const b = Buffer.alloc(size - from); readSync(fd, b, 0, b.length, from); buf = b.toString('utf8') } catch { return null } finally { if (fd !== undefined) closeSync(fd) }
  // ⛔ EVERY LINE OF A TURN CARRIES ITS promptId: the tool results that follow the prompt are user lines too, with the same id and NO
  // turnOrigin (13 lines to one prompt in a real transcript). The prompt is the line that carries turnOrigin; take that one, never the last.
  for (const line of buf.split('\n')) {
    if (!line.includes(promptId) || !line.includes('turnOrigin')) continue
    let j; try { j = JSON.parse(line) } catch { continue }
    if (j?.type === 'user' && j.promptId === promptId && typeof j.turnOrigin === 'string') return j
  }
  return null
}
// a pending repair request, verified exactly like a grant; reset only when it holds. -> { reset, aside } | null
export function maybeRepair(root, { now = Date.now() } = {}) {
  let r
  try { r = JSON.parse(readFileSync(repairFile(root), 'utf8')) } catch { return null }
  const drop = () => { try { unlinkSync(repairFile(root)) } catch {} }
  const v = verifyGrant(root, r)
  if (v.ok) { drop(); return { reset: true, ...resetLedger(root, { now }) } }
  if (now - (r.at ?? 0) > 15 * 60_000) drop()   // never verified: forgotten, nothing reset
  return null
}
export function verifyGrant(root, g) {
  const no = (why) => ({ ok: false, why })
  // a PEER grant (one session approving for another, by the grant command) has no transcript: its proof is the signed, chained ledger line
  // the plugin wrote for it, which readLedger has already checked. What is left is its own shape.
  if (g?.kind === 'peer') {
    if (!validAction(g.action) || typeof g.target !== 'string' || !g.target) return no('the peer grant is malformed')
    if (typeof g.grantedBy !== 'string' || !g.grantedBy || typeof g.to !== 'string' || !g.to || g.to === g.grantedBy) return no(`${g.id}: a session cannot approve for itself`)
    if (typeof g.why !== 'string' || g.why.trim().length < 5) return no(`${g.id}: a peer grant says why`)
    if (ONCE_ONLY.has(g.action)) return no(`${g.id}: ${g.action} is the owner's alone`)
    return { ok: true }
  }
  if (!g || g.ev !== 'grant' || !validAction(g.action) || typeof g.target !== 'string' || !g.target) return no('the grant is malformed')
  if (typeof g.transcript !== 'string' || basename(g.transcript) !== `${g.sessionId}.jsonl`) return no(`${g.id} cites a transcript that is not session ${g.sessionId}'s own`)
  // ⛔ THE TRANSCRIPT LIVES WHERE CLAUDE CODE KEEPS IT: <config dir>/projects/<this session's project>/<session id>.jsonl, by real path. A file
  // of the right name anywhere else (a temp folder, a link) is not the session's transcript. The folder is closed to writes from tool calls.
  const where = transcriptPlace(root, g)
  if (where) return no(`${g.id}: ${where}`)
  const j = turnIn(g.transcript, g.promptId)
  if (!j) return no(`${g.id}: the prompt it cites is not in that session's transcript`)
  // ⛔ A GRANT IS WRITTEN WHEN THE PROMPT IS TYPED: its time must sit within minutes of the cited turn's own timestamp, so an old turn's
  // real ids cannot be turned into a fresh grant
  const at = Date.parse(j.timestamp ?? '')
  if (!(at > 0)) return no(`${g.id}: the cited turn has no timestamp to hold the grant's time against`)
  if (Math.abs(g.at - at) > 5 * 60_000) return no(`${g.id}: the grant is dated ${Math.round(Math.abs(g.at - at) / 60_000)} minutes from the turn it cites, so it was not made when the owner typed it`)
  if (j.turnOrigin !== 'human' || (j.promptSource !== 'typed' && j.promptSource !== 'queued')) return no(`${g.id}: Claude Code did not mark that turn as typed by a person (${j.turnOrigin ?? '?'}/${j.promptSource ?? '?'})`)
  const body = typeof j.message?.content === 'string' ? j.message.content : Array.isArray(j.message?.content) ? j.message.content.filter((x) => x?.type === 'text').map((x) => x.text).join('\n') : ''
  const a = parseApproval(body)
  if (!a || sha(a.line) !== g.hash || a.action !== g.action || a.target !== g.target || isOnce(a) !== (g.max === 1)) return no(`${g.id}: the cited prompt does not say what the grant says`)
  if (g.expires !== g.at + a.hours * HOUR) return no(`${g.id}: the cited prompt does not give the grant's duration`)
  if (wasOfficeTyped(root, body, { now: g.at + 1 })) return no(`${g.id}: the cited text was typed by the office itself, not by the owner`)
  return { ok: true }
}

// the ledger folded: each grant with its uses and whether it was revoked
export function grants(root, { now = Date.now() } = {}) {
  const m = new Map()
  for (const e of readLedger(root).events) {
    if (e.ev === 'grant' && e.id && !m.has(e.id)) m.set(e.id, { ...e, uses: 0, revoked: null })
    else if (e.ev === 'use' && m.has(e.id)) m.get(e.id).uses++
    else if (e.ev === 'revoke' && m.has(e.id)) m.get(e.id).revoked = { at: e.at, reason: e.reason }
  }
  return [...m.values()].map((g) => ({ ...g, live: !g.revoked && now < g.expires && (g.max == null || g.uses < g.max) }))
}

// -> { ok, grant?, why? }. Takes NO quote and no session: the ledger and the transcript are the only witnesses.
// ownerOnly: only a grant the owner TYPED counts (a peer's does not). asker: the session making the call (a name, or a function that gives it):
// a peer grant is for one session or for any session but its granter, and never for the one that made it.
export function checkApproval(root, { action, target = null, use = false, ownerOnly = false, asker = null }, { now = Date.now() } = {}) {
  let led = readLedger(root)
  if (led.corrupt && maybeRepair(root, { now })) led = readLedger(root)
  if (led.corrupt) return { ok: false, corrupt: led.corrupt, why: `the approval ledger has ${led.corrupt} unreadable line(s), so no approval can be trusted until it is repaired (the owner repairs it by typing "approve repair-ledger target:ledger" in his session (it is checked against his transcript like any approval): the damaged file is set aside as .office/approvals.damaged-<time>.jsonl and a new, empty ledger starts, so every earlier approval is gone)` }
  const only = ownerOnly || OWNER_ONLY.has(action)
  const t = target == null || target === '' ? null : String(target).trim()
  const all = grants(root, { now }).filter((g) => g.action === action)
  if (!all.length) return { ok: false, why: `${only ? 'the owner' : 'the owner or a session'} has not approved ${action}` }
  const live = all.filter((g) => g.live)
  if (!live.length) { const g = all[all.length - 1]; return { ok: false, why: `the approval of ${action} (${g.id}) is ${g.revoked ? 'revoked' : now >= g.expires ? 'expired' : 'used up'}` } }
  const same = live.filter((g) => g.target === t)
  if (!same.length) { const g = live[live.length - 1]; return { ok: false, why: `${action} is approved only for ${g.target} (${g.id}); ${t ? `${t} is outside that` : 'this call names no target'}` } }
  const me = (() => { try { const n = typeof asker === 'function' ? asker() : asker; return n ? canonName(root, n) : '' } catch { return '' } })()
  const forMe = (g) => g.kind !== 'peer' || (me && g.grantedBy !== me && (g.to === '*' || canonName(root, g.to) === me))
  const counts = same.filter((g) => (!only || g.kind !== 'peer') && forMe(g))
  if (!counts.length) {
    const peer = same.filter((g) => g.kind === 'peer')
    if (only && peer.length && peer.length === same.length) return { ok: false, why: `${peer[peer.length - 1].grantedBy} approved ${action} for ${t ?? 'this'} (${peer[peer.length - 1].id}), but this one is the owner's alone: only the approve line he types himself counts` }
    const g = peer[peer.length - 1]
    return { ok: false, why: g ? `${action} for ${g.target} was approved by ${g.grantedBy} for ${g.to === '*' ? 'any other session' : g.to} (${g.id}), not for ${me || 'a session this call cannot name'}` : `${action} is approved, but not for this call` }
  }
  const hit = counts.find((g) => verifyGrant(root, g).ok)
  if (!hit) return { ok: false, why: `${verifyGrant(root, counts[counts.length - 1]).why}; the ledger alone is not proof, so it does not count` }
  if (use) {
    const ok = withLedger(root, () => { const g = grants(root, { now }).find((x) => x.id === hit.id); if (!g?.live) return false; appendEvent(root, { ev: 'use', id: hit.id, at: now }); return true })
    if (!ok) return { ok: false, why: `${hit.id} was just used up` }
  }
  return { ok: true, grant: hit, by: hit.kind === 'peer' ? hit.grantedBy : 'owner' }
}

// ---- a session approves for another (the owner's design change, 2026-11-06: "session should be able to approve each other") ----------
// `node lib/approvals.mjs grant --to <session|*> --action <a> --target <t> [--hours N] [--once] --why "…"`. The PLUGIN signs the line with the
// office key (the session never holds the key); the line records who granted it and is checked like any grant, except that it can never
// satisfy an owner-only gate (a gate marked "owner": true, gates-change, repair-ledger). A session cannot grant to itself, and a "*" grant
// never covers its granter. A desk may grant only when office.json approvals.desksMayGrant is true.
export const OWNER_ONLY = ONCE_ONLY
// -> { name } | { why }
// ⛔ THE GRANTER IS WHO CLAUDE CODE'S SESSION REGISTRY SAYS, FOR THE LIVE `claude` PROCESS ABOVE THIS ONE, AND NOTHING ELSE.
// - the entry is trusted only when it belongs to the nearest ancestor process that is `claude` (the shells a tool call runs under are skipped:
//   a file a session wrote for its own shell counts for nothing), its pid is that process, and its startedAt matches that process's start time;
// - the registry's folder is NOT taken from the caller's env (a session could point it at a folder it wrote): it is the CLAUDE_CONFIG_DIR in
//   the claude process's own environment, else ~/.claude;
// - granting has no env fallback: a caller the registry cannot name does not grant. The role variable must also be there and agree.
const sh = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }) } catch { return '' } }
export const psProc = {
  info(pid) {
    const t = sh('ps', ['-o', 'ppid=,comm=,lstart=', '-p', String(pid)]).trim().split(/\s+/)
    if (t.length < 7 || !/^\d+$/.test(t[0])) return null
    return { ppid: Number(t[0]), comm: t.slice(1, -5).join(' '), lstart: t.slice(-5).join(' ') }
  },
  env(pid) { return sh('ps', ['eww', '-p', String(pid)]) },
}
export function registeredSession({ pid = process.ppid, proc = psProc, home = homedir() } = {}) {
  let cp = null
  for (let p = pid, i = 0; i < 12 && p > 1; i++) {
    const inf = proc.info(p); if (!inf) return null
    if (basename(inf.comm) === 'claude') { cp = { pid: p, ...inf }; break }
    p = inf.ppid
  }
  if (!cp) return null
  const m = String(proc.env(cp.pid) ?? '').match(/(?:^|\s)CLAUDE_CONFIG_DIR=(\S+)/)
  const dir = m ? m[1] : join(home, '.claude')
  let rec; try { rec = JSON.parse(readFileSync(join(dir, 'sessions', `${cp.pid}.json`), 'utf8')) } catch { return null }
  const t = Date.parse(cp.lstart)
  if (rec?.pid !== cp.pid || typeof rec.startedAt !== 'number' || !(Math.abs(rec.startedAt - t) < 30_000) || typeof rec.name !== 'string' || !rec.name) return null
  return rec.name
}
// opts.lenient (a check, not a grant): the role variable may name the caller when the registry cannot
export function peerGranter(root, cfg, { cwd, env = process.env, pid, proc, home, lenient = false } = {}) {
  const reg = registeredSession({ ...(pid ? { pid } : {}), ...(proc ? { proc } : {}), ...(home ? { home } : {}) }) || ''
  const fromEnv = (typeof cfg.roleEnv === 'string' && env[cfg.roleEnv]) || ''
  if (reg && fromEnv && canonName(root, reg) !== canonName(root, fromEnv)) return { why: `this session is registered as ${reg}, but its environment says ${fromEnv}; a grant is made by the registered session` }
  if (!reg && !lenient) return { why: 'the session registry cannot name the live claude process this command runs under, so it cannot grant an approval' }
  if (reg && !fromEnv && typeof cfg.roleEnv === 'string' && !lenient) return { why: `this session is registered as ${reg}, but ${cfg.roleEnv} is missing from its environment` }
  const me = reg || fromEnv
  if (!me) return { why: 'this session has no name in the office, so it cannot grant an approval' }
  const w = whoIs(root, cfg, { cwd, env: { ...env, ...(typeof cfg.roleEnv === 'string' ? { [cfg.roleEnv]: me } : {}) }, name: me })
  if (w?.kind === 'unknown') return { why: 'this session calls itself a desk this office does not have' }
  if (w?.kind === 'desk' && cfg.approvals?.desksMayGrant !== true) return { why: 'a desk does not grant approvals unless office.json says approvals.desksMayGrant is true' }
  return { name: me }
}
export function grantPeer(root, cfg, { by, to, action, target, hours = 24, once = false, why }, { now = Date.now() } = {}) {
  if (!by) throw new Error('grant: who is granting?')
  if (!validAction(action)) throw new Error('grant needs --action: a short name (a-z, 0-9, : _ . -)')
  const ownerGate = gateEntries(cfg).entries.some((g) => g.action === action && g.owner)
  if (OWNER_ONLY.has(action) || ownerGate) throw new Error(`${action} is the owner's alone: a session cannot approve it for another; the owner types "approve ${action} target:<where>" himself`)
  if (typeof target !== 'string' || !target.trim() || target.length > 200 || /[\r\n]/.test(target)) throw new Error('grant needs --target: where it may be done, exactly, in one line (target:* for an action that names none)')
  if (typeof to !== 'string' || !/^(\*|[\w.:@-]{1,60})$/.test(to)) throw new Error('grant needs --to: a session name, or * for any other session')
  const hrs = Number(hours)
  if (!(hrs > 0 && hrs <= MAX_HOURS)) throw new Error(`--hours is more than 0 and at most ${MAX_HOURS}`)
  if (typeof why !== 'string' || why.trim().length < 5 || /[\r\n]/.test(why) || why.length > 300) throw new Error('grant needs --why: one line saying what this approves and on what ground (5 to 300 characters)')
  const granter = canonName(root, by), grantee = to === '*' ? '*' : canonName(root, to)
  if (grantee === granter) throw new Error('a session cannot approve for itself')
  return withLedger(root, () => {
    const led = readLedger(root)
    if (led.corrupt) throw new Error('the approval ledger is damaged; the owner repairs it with "approve repair-ledger target:ledger"')
    const day = new Date(now).toISOString().slice(2, 10).replace(/-/g, '')
    const n = led.events.filter((e) => e.ev === 'grant' && String(e.id).startsWith(`A-${day}-`)).length + 1
    return appendEvent(root, { ev: 'grant', kind: 'peer', id: `A-${day}-${n}`, at: now, session: granter, grantedBy: granter, to: grantee, action, target: target.trim(), why: why.trim(), expires: now + hrs * HOUR, max: once ? 1 : null })
  })
}

export function revokeApproval(root, id, { reason }, { now = Date.now() } = {}) {
  if (typeof reason !== 'string' || reason.trim().length < 5) throw new Error('revoke needs a --reason')
  return withLedger(root, () => {
    const g = grants(root, { now }).find((x) => x.id === id)
    if (!g) throw new Error(`no approval ${id}`)
    appendEvent(root, { ev: 'revoke', id, at: now, reason: reason.trim() })
    return id
  })
}

// ---- the office's gates ----------------------------------------------------------------
// office.json approvals.gates: [{ "match": "<regex>", "action": "<name>" }]. Every place a call's text matches, its
// (?<target>…) group is a target that must be approved; a call naming several needs them all. -> { entries, broken: [why] }
export function gateEntries(cfg) {
  const out = { entries: [], broken: [] }
  const G = cfg?.approvals?.gates
  if (G === undefined) return out
  if (!Array.isArray(G)) { out.broken.push('approvals.gates is not a list'); return out }
  G.forEach((g, i) => {
    if (!g || typeof g.match !== 'string' || !g.match || g.match.length > 500 || !validAction(g.action)) { out.broken.push(`gate ${i} needs a match (a regex up to 500 characters) and an action`); return }
    try { out.entries.push({ re: new RegExp(g.match, 'gi'), action: g.action, owner: g.owner === true, i }) } catch (e) { out.broken.push(`gate ${i} (${g.action}): its regex does not compile (${e.message})`) }
  })
  return out
}
const callText = (p) => { const i = p?.tool_input; return `${p?.tool_name ?? ''} ${typeof i?.command === 'string' ? i.command : JSON.stringify(i ?? {})}`.slice(0, 20_000) }
const alertOnce = (root, cfg, key, text, now) => { try { writeAlert(root, cfg, { type: 'APPROVAL-GATE', kase: '-', subject: 'approvals', text, quietKey: `approval-gate:${key}`, quietMs: HOUR, now }) } catch {} }

export function gateVerdict(root, cfg, p, { now = Date.now(), asker = null } = {}) {
  const { entries, broken } = gateEntries(cfg)
  if (broken.length) {
    // a gate that cannot compile cannot say what it guards: everything but the repair is denied, and the lead is told
    alertOnce(root, cfg, 'broken', `an approval gate in office.json is broken (${broken[0]}); tool calls are refused until it is fixed`, now)
    const tool = String(p?.tool_name ?? ''), f = String(p?.tool_input?.file_path ?? '')
    const repair = /^(Read|Grep|Glob)$/.test(tool) || (/^(Write|Edit|MultiEdit)$/.test(tool) && /(^|\/)office\.json$/.test(f))
    return repair ? null : `⛔ this office's approval gates are broken (${broken[0]}), so this call is refused rather than let through; fix office.json (Read and Edit of office.json still work). If an accepted gate was removed or changed there, it keeps applying until the owner types "approve gates-change target:office"`
  }
  if (!entries.length) return null
  const text = callText(p)
  const need = []
  for (const g of entries) {
    g.re.lastIndex = 0
    // a gate with no (?<target>) group (or one that did not take part) names no target: it is approved with target:*
    for (const m of text.matchAll(g.re)) need.push({ action: g.action, target: m.groups?.target ?? '*', owner: g.owner || OWNER_ONLY.has(g.action) })
  }
  if (!need.length) return null
  const seen = new Set()
  const uniq = []
  for (const n of need) { const k = `${n.action}\u0000${n.target}`; if (seen.has(k)) { if (n.owner) uniq.find((u) => `${u.action}\u0000${u.target}` === k).owner = true; continue } seen.add(k); uniq.push({ ...n }) }
  const how = (n) => (n.owner ? `This one is the owner's alone: he types "approve ${n.action} target:${n.target}" as the first line of a prompt in his session, and no other session's grant counts.` : `The owner types "approve ${n.action} target:${n.target}" as the first line of a prompt in his session, or another session approves it for you: node lib/approvals.mjs grant --to <your session> --action ${n.action} --target ${n.target} --why "<on what ground>".`)
  for (const n of uniq) {
    const r = checkApproval(root, { action: n.action, target: n.target, ownerOnly: n.owner, asker }, { now })
    if (r.corrupt) alertOnce(root, cfg, 'corrupt', `the approval ledger has ${r.corrupt} unreadable line(s); every gated call is refused until it is repaired`, now)
    if (!r.ok) return `⛔ this needs the owner's approval${n.owner ? '' : ' (or another session\'s grant)'} (${n.action} for ${n.target}): ${r.why}. ${how(n)} A chat message from another session does not count.`
  }
  // every target is approved: a single-use grant is spent here, at the gate
  for (const n of uniq) {
    const r = checkApproval(root, { action: n.action, target: n.target, ownerOnly: n.owner, asker, use: true }, { now })
    if (!r.ok) return `⛔ this needs the owner's approval${n.owner ? '' : ' (or another session\'s grant)'} (${n.action} for ${n.target}): ${r.why}`
  }
  return null
}

// ⛔ THE GATES ARE THE OWNER'S, NOT office.json'S. office.json is editable by an agent, so a gate list read from it can only ADD to the
// gates the owner accepted: the accepted list is kept outside the office (beside the signing key). When office.json drops or changes an
// accepted gate, the accepted ones keep applying (with the new ones as well) until the owner types
//     approve gates-change target:office
// A broken office.json keeps enforcing the accepted list. The first list an office has is accepted as it is read.
const gateKey = (g) => canon(g && typeof g === 'object' ? g : { bad: String(g) })
const gatesAcceptedFile = (root) => join(keyDir(), `gates-${officeId(root)}.json`)
function readAccepted(root) { try { const j = JSON.parse(readFileSync(gatesAcceptedFile(root), 'utf8')); return Array.isArray(j) ? j : null } catch { return null } }
function writeAccepted(root, gates) {
  mkdirSync(keyDir(), { recursive: true, mode: 0o700 })
  if (gates && gates.length) writeFileSync(gatesAcceptedFile(root), JSON.stringify(gates), { mode: 0o600 })
  else { try { unlinkSync(gatesAcceptedFile(root)) } catch {} }
}
// -> cfg with approvals.gates replaced by the gates that apply now
export function effectiveGatesCfg(root, cfg, { now = Date.now() } = {}) {
  const cur = cfg?.approvals?.gates
  const accepted = readAccepted(root)
  const withGates = (g) => ({ ...cfg, approvals: { ...(cfg?.approvals ?? {}), gates: g } })
  if (!accepted) { if (Array.isArray(cur) && cur.length) writeAccepted(root, cur); return cfg }
  if (cur !== undefined && !Array.isArray(cur)) return withGates(accepted)           // a gates value that is not a list never replaces the accepted ones
  const have = new Set((cur ?? []).map(gateKey))
  if (accepted.every((g) => have.has(gateKey(g)))) { if ((cur ?? []).length > accepted.length) writeAccepted(root, cur); return cfg }   // only additions
  const ok = checkApproval(root, { action: 'gates-change', target: 'office', ownerOnly: true, use: true }, { now })
  if (ok.ok) { writeAccepted(root, cur ?? []); return cfg }
  alertOnce(root, cfg, 'gates-changed', `office.json drops or changes an approval gate the owner accepted; the accepted gates keep applying until the owner types "approve gates-change target:office"`, now)
  const seen = new Set(accepted.map(gateKey))
  return withGates([...accepted, ...(cur ?? []).filter((g) => !seen.has(gateKey(g)))])
}
// the accepted gates, for a broken office.json
export function cachedGatesCfg(root) { const g = readAccepted(root); return g ? { approvals: { gates: g } } : null }
// kept for callers that only record what is read: accepting is effectiveGatesCfg's job
export function rememberGates(root, cfg) { try { effectiveGatesCfg(root, cfg) } catch {} }

// ---- no session writes the ledger ------------------------------------------------------------------
// the files this module trusts: the ledger, the office-typed record, the gates cache, and Claude Code's transcripts
const MENTIONS = /approvals\.(jsonl|lock|damaged)|office-typed\.jsonl|repair-pending|prompts-[0-9a-f]{16}|gates-|\.office\/approv|\b(app|appr|appro|approv|approva|approval|approvals)[*?[]|\.office\/[*?]/i
const TRANSCRIPTS = /\.claude\/projects\/|[/\\]projects\/[^\s"']*\.jsonl|projects\/\*/
const READ_ONLY = /^\s*(cat|head|tail|grep|rg|wc|ls|stat|jq)\s[^;&|><`$()]*$|^\s*node\s+\S*approvals\.mjs\s+(\S+\s+)?(check|list|revoke)\b[^;&|><`$()]*$/
const WRITES = /(>|\btee\b|\bsed\s+[^|;&]*-i|\b(cp|mv|dd|ln|rsync|truncate|install|touch|rm|chmod|perl|python3?|ruby|awk)\b|appendFile|writeFile|createWriteStream|open\([^)]*['"][wa]|\bnode\s+-e\b)/
// text typed into a pane reads to Claude Code as a person typing; these are the roads a tool call has to do it
const CLAUDE_RUN = /(^|[\s;&|(`'"])(\S*\/)?claude\s+([^;&|\n]*\s)?(-p|--print)\b|(^|[\s;&|(`'"])(\S*\/)?claude\b[^\n]*\bapprove\b[^\n]*target:/i
const HOOK_RUN = /\bnode(js)?\s+(-\S+\s+)*["']?\S*\bhooks\/[\w.-]+\.mjs|import\(["'][^"']*\bhooks\/[\w.-]+\.mjs|(^|[;&|]\s*)(env\s+\S+=\S+\s+)*\S*\bhooks\/[\w.-]+\.mjs\b/i
const HOOK_NAMES = '(typed-prompt|desk-wall|desk-boot|tasks-boot|ask-track|no-secrets|send-wall-gate)'
// a hook's bare file name run, copied or sourced by an interpreter, a shell -c or a copy command, wherever it sits (cd hooks && node typed-prompt.mjs)
const HOOK_BARE = new RegExp(String.raw`(\bnode(js)?|\bdeno|\bbun|\bsh|\bbash|\bzsh|\bsource|\bcp|\bmv|\bln|\brsync|\bcat\s*>|\btee|\bpython3?|\bperl|\bruby)\b[^;&|\n]*\b${HOOK_NAMES}\.mjs\b|import\([^)]*\b${HOOK_NAMES}\.mjs`, 'i')
const TYPING = /\borca\b[\s\S]*\bsend\b|\btmux\b[\s\S]*\bsend-keys\b|\bosascript\b|\bcliclick\b|\bxdotool\b|\bscreen\s+-X\s+stuff\b|\bexpect\b|\bsend-text\b|\/api\/send\b/i
const KEY_PATH = /\.config[\/\\]office-anything|approvals\.key|\bhead-[0-9a-f]{16}\b|OFFICE_ANYTHING_KEY_DIR/i
// ⛔ NO TOOL CALL SETS OR EXPORTS AN IDENTITY VARIABLE: a session that posed as the lead would grant as the lead. Any assignment of the role
// variables (prefix, export, env, declare, a shell -c, process.env =, an env:{} object), in any letter case.
const SESSIONS_FILE = /\/sessions\/[^/]*\.json$/
const IDENTITY_VARS = ['OFFICE_ROLE', 'CLAUDE_CODE_SESSION_NAME', 'CLAUDE_CONFIG_DIR']
export function identityVerdict(p, extra = []) {
  if (String(p?.tool_name ?? '') !== 'Bash') return null
  const names = [...new Set([...IDENTITY_VARS, ...extra.filter((v) => typeof v === 'string' && /^[A-Za-z_]\w*$/.test(v))])]
  const c = String(p?.tool_input?.command ?? '')
  const re = new RegExp(String.raw`\b(${names.join('|')})\b["']?\s*(\+?=(?![=~])|:\s*["'\w])`, 'i')
  const un = new RegExp(String.raw`(\bunset\b|\s-u\b|--unset\b)[^;&|\n]*\b(${names.join('|')})\b`, 'i')
  const m1 = c.match(re), m2 = m1 ? null : c.match(un)
  const m = m1 ? [m1[0], m1[1]] : m2 ? [m2[0], m2[2]] : null
  return m ? `⛔ a tool call may not set the session's role (${m[1]}): who a session is comes from Claude Code's own registry, and a grant is made by the registered session.` : null
}
export function ledgerWriteVerdict(p) {
  const tool = String(p?.tool_name ?? ''), i = p?.tool_input ?? {}
  // the signing key is for no tool call: not to read, not to name
  try { if (KEY_PATH.test(JSON.stringify(i))) return `⛔ the approval key (~/.config/office-anything) is not for tool calls: it signs the ledger, and a session that could read it could sign an approval` } catch {}
  const no = `⛔ the approval ledger (.office/approvals*) is written only by the owner's own typed approval line (hooks/typed-prompt.mjs) and by the approvals command; no session writes it`
  const noReg = `⛔ Claude Code's session registry (<config dir>/sessions) says who each session is, and a grant is made by the registered session; a tool call does not write it`
  const noTr = `⛔ Claude Code's transcripts (projects/*.jsonl) are what an approval is checked against; a tool call does not write them`
  const noType = `⛔ a tool call does not type into a terminal or post to the board's send (orca send, a terminal's send-keys, osascript, /api/send): what lands in a pane reads as the owner typing, whatever the text. The office's own typing (heal, the scheduler, the board page) is recorded and does not go through a tool call`
  if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool)) {
    const f0 = String(i.file_path ?? i.notebook_path ?? '')
    const f = f0.replace(/\\/g, '/')
    let abs = f
    try { abs = resolve(typeof p?.cwd === 'string' && p.cwd ? p.cwd : process.cwd(), f0) } catch {}
    const named = ['approvals.jsonl', 'approvals.lock', 'office-typed.jsonl', 'repair-pending.json'].includes(basename(abs)) || /^approvals\.damaged/.test(basename(abs))
    if (named && basename(dirname(abs)) === '.office') return no
    if (/\.office\/(approvals|office-typed|gates-)/.test(f)) return no
    if (SESSIONS_FILE.test(abs.split(sep).join('/'))) return noReg
    if (/\.jsonl$/.test(f) && /\/projects\//.test(abs.split(sep).join('/'))) return noTr
    return null
  }
  if (tool === 'Bash') {
    const c = String(i.command ?? '')
    // any command that names a trusted file and is more than a plain read is refused, wherever it has cd'd to
    if (MENTIONS.test(c) && !READ_ONLY.test(c)) return no
    if (TRANSCRIPTS.test(c) && /\.jsonl|projects\/\*/.test(c) && WRITES.test(c) && !READ_ONLY.test(c)) return noTr
    if (/\bsessions\b/i.test(c) && WRITES.test(c) && !READ_ONLY.test(c)) return noReg
    if (TYPING.test(c) || CLAUDE_RUN.test(c)) return noType
    // ⛔ NO HOOK IS RUN BY HAND: a hook trusts the payload it is fed, so feeding one an old prompt's ids is how a grant would be forged
    if ((HOOK_RUN.test(c) || HOOK_BARE.test(c)) && !READ_ONLY.test(c)) return `⛔ a hook (hooks/*.mjs) is run by Claude Code, never by hand from a tool call: it trusts the payload it is given`
  }
  return null
}

// ---- command line ------------------------------------------------------------------------------------
function parse(argv) {
  const words = [], flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) flags[k] = true; else { flags[k] = v; i++ } } else words.push(a)
  }
  return { words, flags }
}
const COMMANDS = new Set(['check', 'list', 'revoke', 'grant'])
export function run(argv, { cwd = process.cwd(), env = process.env, pid, proc, home, out = (s) => console.log(s), now = Date.now() } = {}) {
  const { words, flags } = parse(argv)
  let root = null
  if (words.length && !COMMANDS.has(words[0])) root = findOffice(resolve(words.shift()))
  root = root ?? findOffice(cwd)
  const cmd = words.shift()
  if (!root || !COMMANDS.has(cmd)) throw new Error('usage: node lib/approvals.mjs [root] check|list|revoke|grant …  (run inside an office). There is no record command: the owner types the approval line himself.')
  const str = (v) => (typeof v === 'string' ? v : undefined)
  const cfg = readOfficeConfig(root) ?? {}
  if (cmd === 'check') {
    const who = peerGranter(root, cfg, { cwd, env, pid, proc, home, lenient: true }).name ?? null
    const r = checkApproval(root, { action: str(flags.action), target: str(flags.target) ?? null, use: !!flags.use, ownerOnly: !!flags['owner-only'], asker: who }, { now })
    out(r.ok ? (r.by === 'owner' ? `approved by the owner, in ${r.grant.session}, ${new Date(r.grant.at).toISOString()}: "${r.grant.quote}" (${r.grant.id}, ${r.grant.action} for ${r.grant.target})` : `approved by ${r.by} (a peer grant to ${r.grant.to}, ${new Date(r.grant.at).toISOString()}): "${r.grant.why}" (${r.grant.id}, ${r.grant.action} for ${r.grant.target})`) : `NOT approved: ${r.why}`)
    return r.ok ? 0 : 4
  } else if (cmd === 'grant') {
    const g = peerGranter(root, cfg, { cwd, env, pid, proc, home })
    if (!g.name) throw new Error(g.why)
    const l = grantPeer(root, cfg, { by: g.name, to: str(flags.to), action: str(flags.action), target: str(flags.target), hours: str(flags.hours) ?? 24, once: !!flags.once, why: str(flags.why) }, { now })
    out(`${l.id} recorded: ${l.grantedBy} approves ${l.action} for ${l.target} to ${l.to === '*' ? 'any other session' : l.to} until ${new Date(l.expires).toISOString()}${l.max ? ' (once)' : ''}`)
  } else if (cmd === 'list') {
    const all = grants(root, { now }).filter((g) => flags.all || g.live)
    const bad = readLedger(root).corrupt
    out((all.map((g) => `${g.id}  ${g.live ? 'live' : g.revoked ? 'revoked' : 'over'}  ${g.action} for ${g.target}  ${g.kind === 'peer' ? `peer ${g.grantedBy} -> ${g.to}  "${g.why}"` : `owner  ${g.session}  "${g.quote}"`}`).join('\n') || 'no approvals') + (bad ? `\nLEDGER DAMAGED: ${bad} unreadable line(s)` : ''))
  } else {
    out(`${revokeApproval(root, words[0], { reason: str(flags.reason) }, { now })} revoked`)
  }
  return 0
}

if (isMain(import.meta.url)) {
  try { process.exit(run(process.argv.slice(2))) } catch (e) { console.error(`approvals: ${e.message}`); process.exit(1) }
}
