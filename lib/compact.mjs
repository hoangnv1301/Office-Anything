// IDLE COMPACT (0.13.0): a session that sits idle with a fat context is
// compacted before its next request, not after.
//
// The owner's 20x plan ran out in days: every turn of a long session re-reads
// its whole context, 250-750 MB of transcript behind the busiest ones. A desk
// or lead idle at its prompt for idleMin with a context above aboveK has
// `/compact <focus>` typed into it by heal, so the next request starts small.
//
//   office.json "compact": { "idleMin": 30, "aboveK": 150, "everyMin": 120,
//                            "focus": "Keep: open buyers and promises, …",
//                            "lead": true }
//   desk.json   "compactIdleMin", "compactAboveK", "compactFocus", "compact": false
//   the lead    "lead": false (off), true (the office's numbers), or its own
//               { "aboveK": 200, "idleMin": 10, "everyMin": 60, "focus": "…" }
//               (0.19.6, the owner: compact "like when switching to another
//               job", at a task boundary, not only at the size limit)
//
// ⛔ OFF UNLESS office.json SAYS "compact". Typing into somebody's session is
// not a default a plugin gets to choose for every office that installs it.
// ⛔ NEVER MID-TURN, NEVER INTO A DIALOG. Keystrokes into an open question or
// permission prompt are ANSWERS (board/serve.mjs learned it): idle in the
// registry, and the transcript's last entry not a tool call still waiting.
// Heal looks again right before it types: same pid, same status stamp.
// ⛔ THE FOCUS IS POINTERS, AND SHORT. orca types at human speed (a sentence
// is ~10 s), and anything durable is already in the book or memory: the
// summary needs to know where things are, not to carry them.
// Not done, on purpose: compacting "before a new request" from a hook. A hook
// cannot run /compact; it could only refuse the message, which loses it.
import { statSync, openSync, readSync, closeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { isMain } from './is-main.mjs'
import { findOffice, readOfficeConfig } from './office.mjs'
import { rosterSafe, officeRoster } from './desk.mjs'

export const FOCUS_MAX = 300
const D = { idleMin: 30, aboveK: 150, everyMin: 120 }

// -> null (off) | { idleMin, aboveK, everyMin, focus }
export function compactConfig(cfg, { desk = null, isLead = false } = {}) {
  const C = cfg?.compact
  if (!C || typeof C !== 'object' || Array.isArray(C)) return null
  if (isLead && C.lead === false) return null
  if (desk && desk.compact === false) return null
  // the lead's own numbers, like a desk's desk.json ones
  const own = isLead && C.lead && typeof C.lead === 'object' && !Array.isArray(C.lead)
    ? { compactIdleMin: C.lead.idleMin, compactAboveK: C.lead.aboveK, compactEveryMin: C.lead.everyMin, compactFocus: C.lead.focus } : desk
  const num = (v, d, lo, hi) => (Number.isFinite(v) && v >= lo && v <= hi ? v : d)
  const idleMin = num(own?.compactIdleMin, num(C.idleMin, D.idleMin, 5, 1440), 5, 1440)
  const aboveK = num(own?.compactAboveK, num(C.aboveK, D.aboveK, 20, 1000), 20, 1000)
  const everyMin = num(own?.compactEveryMin, num(C.everyMin, D.everyMin, 10, 1440), 10, 1440)
  const lines = [typeof C.focus === 'string' ? C.focus : '', typeof own?.compactFocus === 'string' ? own.compactFocus : ''].map((s) => s.trim()).filter(Boolean)
  return { idleMin, aboveK, everyMin, focus: lines.join(' ') }
}

// one line, no control characters, at most FOCUS_MAX: what is typed after /compact
export function focusText(base, pointers = []) {
  const clean = (s) => String(s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  let out = clean(base)
  for (const p of pointers.map(clean).filter(Boolean)) {
    const next = out ? `${out} ${p}` : p
    if (next.length > FOCUS_MAX) break
    out = next
  }
  return out.slice(0, FOCUS_MAX)
}

// the tail of a live session's transcript -> { ctx: tokens | null, pending: bool }
// ctx: the last assistant turn's whole prompt (input + cache read + cache write).
// pending: the last entry is an assistant tool call with no result yet (a
// question, a permission prompt): typing now would answer it.
export function transcriptTail(home, s, bytes = 256 * 1024) {
  if (!s?.sessionId || !s?.cwd) return { ctx: null, pending: false }
  const p = join(home, '.claude', 'projects', resolve(s.cwd).replace(/[^A-Za-z0-9]/g, '-'), s.sessionId + '.jsonl')
  let text = ''
  try {
    const st = statSync(p)
    const n = Math.min(st.size, bytes)
    const fd = openSync(p, 'r'); const buf = Buffer.alloc(n); readSync(fd, buf, 0, n, st.size - n); closeSync(fd)
    text = buf.toString('utf8')
  } catch { return { ctx: null, pending: false } }
  const lines = text.split('\n').filter(Boolean)
  let ctx = null, pending = false, seenLast = false
  for (let i = lines.length - 1; i >= 0; i--) {
    let e
    try { e = JSON.parse(lines[i]) } catch { continue }
    if (e.type !== 'assistant' && e.type !== 'user') continue
    if (!seenLast) {
      seenLast = true
      const c = e.message?.content
      pending = e.type === 'assistant' && Array.isArray(c) && c.some((x) => x?.type === 'tool_use')
    }
    const u = e.type === 'assistant' ? e.message?.usage : null
    if (u) { ctx = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0); break }
  }
  return { ctx, pending }
}

// -> { verdict: 'compact' | 'keep', why } for one live session
export function compactVerdict(conf, s, tail, { now = Date.now(), last = null } = {}) {
  const keep = (why) => ({ verdict: 'keep', why })
  if (!conf) return keep('off')
  if (tail.ctx == null) return keep('context size unknown')
  if (tail.ctx < conf.aboveK * 1000) return keep(`${Math.round(tail.ctx / 1000)}K, under ${conf.aboveK}K`)
  if (!['idle', 'shell'].includes(s.status)) return keep(s.status ? `${s.status}, not idle` : 'status unknown')
  if (tail.pending) return keep('a question or prompt is open')
  const idleMin = s.statusUpdatedAt ? (now - s.statusUpdatedAt) / 60_000 : null
  if (idleMin == null || idleMin < conf.idleMin) return keep(`idle ${idleMin == null ? '?' : Math.round(idleMin)} of ${conf.idleMin} min`)
  if (last != null && now - last < conf.everyMin * 60_000) return keep(`compacted ${Math.round((now - last) / 60_000)} min ago`)
  return { verdict: 'compact', why: `idle ${Math.round(idleMin)} min at ${Math.round(tail.ctx / 1000)}K context` }
}

// ── what compaction keeps (0.14.0) ──────────────────────────────────────────
// Documented (code.claude.com, how-claude-code-works): "add a "Compact
// Instructions" section to CLAUDE.md" to control what compaction preserves. Its
// scope (manual, auto, both) is not stated, so this is the static half: rules.
// The live half (what is open right now) is printed AFTER compaction by the
// boot hook (compact.after), through SessionStart "compact", which is documented
// to add its output to the compacted context.
export const KEEP = [
  'open buyers, promises and what each is waiting on',
  'the owner\'s decisions and corrections, with their dates',
  'the current job: what was asked, what is done, the next step',
  'pointers to the book, memory files and task ids, never copies of them',
]
export const DROP = [
  'tool output, file dumps and command logs already acted on',
  'old diffs and superseded drafts',
  'anything already written to the book or a memory file (keep the pointer)',
]
const listOf = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : null)

// -> the CLAUDE.md section, as text
export function instructionsBlock(cfg, { desk = null, isLead = false } = {}) {
  const C = cfg?.compact && typeof cfg.compact === 'object' ? cfg.compact : {}
  const keep = [...(listOf(C.keep) ?? KEEP), ...(isLead ? listOf(C.leadKeep) ?? [] : listOf(desk?.compactKeep) ?? [])]
  const drop = listOf(C.drop) ?? DROP
  return [
    '## Compact Instructions',
    '',
    '<!-- generated by office-anything: node {plugin}/lib/compact.mjs instructions ' + (isLead ? 'lead' : desk?.name ?? '<desk>') + ' -->',
    'When this conversation is compacted, keep:',
    ...keep.map((k) => `- ${k}`),
    '',
    'Drop:',
    ...drop.map((k) => `- ${k}`),
    '',
  ].join('\n')
}

export const hasInstructions = (text) => /^#{1,6}\s+compact instructions\s*$/im.test(String(text ?? ''))

// office.json compact.after: { lead, desk } -> the lines printed after a compaction
// -> [line] ; never throws. {desk} in the desk command is the desk's id.
export function afterLines(root, cfg, { desk = null, isLead = false, run } = {}) {
  const A = cfg?.compact?.after
  const raw = isLead ? A?.lead : A?.desk
  if (typeof raw !== 'string' || !raw.trim()) return []
  if (!isLead && !/^[a-z][a-z0-9-]{0,39}$/.test(String(desk ?? ''))) return []
  const cmd = isLead ? raw : raw.replaceAll('{desk}', desk)
  const r = run('/bin/sh', ['-c', cmd], { cwd: root, encoding: 'utf8', timeout: 20_000 })
  if (r.error || r.status !== 0) return [`- (compact.after did not answer: ${r.error?.code === 'ETIMEDOUT' ? 'timed out' : r.error ? r.error.message : 'exit ' + r.status}; what is open is UNKNOWN, read the book)`]
  const lines = String(r.stdout ?? '').split('\n').map((l) => l.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trimEnd()).filter((l) => l.trim())
  const out = lines.slice(0, 40)
  if (lines.length > 40) out.push(`- …and ${lines.length - 40} more lines (compact.after prints at most 40)`)
  return out.length ? ['After compaction, what is open right now:', ...out] : []
}

//   node lib/compact.mjs [root] instructions <desk-id|lead>
if (isMain(import.meta.url)) {
  const a = process.argv.slice(2)
  const root = a.length === 3 ? findOffice(a.shift()) : findOffice(process.cwd())
  const [verb, who] = a
  if (!root || verb !== 'instructions' || !who) { console.error('usage: node lib/compact.mjs [root] instructions <desk-id|lead>'); process.exit(1) }
  const cfg = readOfficeConfig(root)
  if (who === 'lead') { process.stdout.write(instructionsBlock(cfg, { isLead: true })); process.exit(0) }
  const d = officeRoster(root).desks.find((x) => x.name === who || x.title === who)
  if (!d) { console.error(`no desk called ${who}`); process.exit(4) }
  process.stdout.write(instructionsBlock(cfg, { desk: d }))
}
