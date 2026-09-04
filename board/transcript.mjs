// TRANSCRIPT → CHAT. The session's jsonl is the native record of the
// conversation; this renders its tail as messages and never invents one.
import { readdirSync, readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { join } from 'node:path'

// ⛔ NEWEST-BY-MTIME PICKED A ROBOT. Subagents and SDK runs write transcripts
// into the same project directory, and a review bot that finished a minute
// ago out-mtimes the human session that has been open all day. The board
// showed "3 messages" of a code-review transcript under the lead's name.
// Sessions carry their entrypoint: "cli" is a person's terminal; sdk-* and
// friends are programs. Prefer the newest cli session; fall back to newest
// anything only when no human session exists.
const isCli = (path) => {
  try {
    const fd = openSync(path, 'r')
    const buf = Buffer.alloc(8192)
    const n = readSync(fd, buf, 0, 8192, 0)
    closeSync(fd)
    return buf.slice(0, n).toString('utf8').includes('"entrypoint":"cli"')
  } catch { return false }
}

export function newestSession(projectDir) {
  try {
    const files = readdirSync(projectDir).filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({ p: join(projectDir, f), at: statSync(join(projectDir, f)).mtimeMs }))
      .sort((a, b) => b.at - a.at)
    if (!files.length) return null
    return files.find((x) => isCli(x.p))?.p ?? files[0].p
  } catch { return null }
}

const IMG_PATH = /\[Image(?: #\d+)?: source: (\/[^\]]+?\.(?:png|jpe?g|gif|webp))\]/gi
const IMG_MARKER = /\[Image: original (\d+x\d+)[^\]]*\]/g

// ⛔ SYSTEM TRAFFIC IS NOT A PERSON TALKING. Task notifications, hook
// feedback, cross-session envelopes and local-command output arrive typed as
// "user" in the transcript, and rendering them as user bubbles made the chat
// read like the owner types in XML. Classified here, once.
const SYSTEM_SHAPES = [
  /^\s*\[SYSTEM NOTIFICATION/i, /^\s*<task-notification>/i, /^\s*<system-reminder>/i,
  /^\s*<local-command/i, /^\s*<command-name>/i, /^\s*Stop hook feedback/i,
  /^\s*<cross-session-message/i, /^\s*\[Request interrupted/i, /^\s*Caveat: /i,
  // a Skill invocation injects its whole instruction body as a user turn;
  // rendered as chat it reads like the owner pasted a manual
  /^\s*Base directory for this skill:/i, /^\s*<command-message>/i,
  // /compact's summary re-enters as a user turn; it is machinery, not a message
  /^\s*This session is being continued from a previous conversation/i,
]
export const isSystemText = (t) => SYSTEM_SHAPES.some((r) => r.test(t))
const systemLabel = (t) => {
  if (/task-notification|SYSTEM NOTIFICATION/i.test(t)) return 'background task'
  if (/cross-session-message/i.test(t)) {
    const m = /from-name="([^"]+)"/.exec(t)
    return 'message from ' + (m?.[1] ?? 'another session')
  }
  if (/^\s*Base directory for this skill:/i.test(t)) {
    const m = /skills\/([A-Za-z0-9_-]+)/.exec(t)
    return 'skill loaded · ' + (m?.[1] ?? 'unknown')
  }
  if (/^\s*This session is being continued/i.test(t)) return 'context compacted'
  if (/Stop hook/i.test(t)) return 'stop hook'
  if (/local-command|command-name/i.test(t)) {
    const name = t.match(/<command-name>\s*([^<\s]+)/i)?.[1]
    return name ? 'local command · ' + name : 'local command'
  }
  if (/system-reminder/i.test(t)) return 'system reminder'
  return 'system'
}

const imagesOf = (content) => {
  const out = []
  if (Array.isArray(content)) {
    for (const b of content) {
      if (b.type === 'image' && b.source?.type === 'base64' && typeof b.source.data === 'string' && b.source.data.length < 8_000_000) {
        out.push({ kind: 'b64', mediaType: b.source.media_type ?? 'image/png', data: b.source.data })
      }
      // a screenshot handed back by a tool lives INSIDE the tool_result
      // block, one level down — the level the first version never walked
      if (b.type === 'tool_result' && Array.isArray(b.content)) {
        for (const c of b.content) {
          if (c.type === 'image' && c.source?.type === 'base64' && typeof c.source.data === 'string' && c.source.data.length < 8_000_000) {
            out.push({ kind: 'b64', mediaType: c.source.media_type ?? 'image/png', data: c.source.data })
          }
        }
      }
    }
  }
  const text = typeof content === 'string' ? content
    : Array.isArray(content) ? content.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : ''
  for (const m of text.matchAll(IMG_PATH)) out.push({ kind: 'path', path: m[1] })
  // a pasted image whose bytes never reached the transcript: show a chip, not bracket prose
  for (const m of text.matchAll(IMG_MARKER)) out.push({ kind: 'marker', label: 'image · ' + m[1] })
  return out
}

const textOf = (content) => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
}

export function chatFrom(jsonlText, { limit = 80, toolIndex = new Map() } = {}) {
  const out = []
  for (const line of jsonlText.split('\n')) {
    if (!line.trim()) continue
    let j
    try { j = JSON.parse(line) } catch { continue }   // a torn tail line is a live session, not an error
    const m = j.message
    if (j.type === 'user' && m) {
      const text = textOf(m.content)
      // tool results come back as user-typed entries; they are plumbing, not chat
      const isToolResult = Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result')
      // ...but each result carries the OUTCOME of a call already on screen:
      // attach output text and the error flag to the tool it answers. The
      // index survives incremental reads via the readTail cache, so a result
      // landing in a later chunk still finds its call.
      if (isToolResult) {
        for (const b of m.content) {
          if (b.type !== 'tool_result' || !b.tool_use_id) continue
          const t = toolIndex.get(b.tool_use_id)
          if (!t) continue
          const otext = typeof b.content === 'string' ? b.content
            : Array.isArray(b.content) ? b.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n') : ''
          t.output = otext.slice(0, 1500)
          t.isError = !!b.is_error
          toolIndex.delete(b.tool_use_id)
        }
      }
      const images = imagesOf(m.content)
      const clean = text.replace(IMG_MARKER, '').trim()
      if (!isToolResult && (clean || images.length)) {
        // a desk-to-desk message is CONVERSATION, not plumbing: strip the
        // envelope and the harness's boilerplate, keep who said what
        const xs = /<cross-session-message[^>]*from-name="([^"]+)"[^>]*>([\s\S]*?)<\/cross-session-message>/.exec(text)
        // /compact's own wrapper entries (the command-name for /compact and
        // its "Compacted" stdout) are pure machinery; the "context compacted"
        // event stands in for the whole thing, so these two folds are dropped
        const isCompactMachinery = /<command-name>\s*\/compact/i.test(text) || /<local-command-stdout>[^<]*Compacted/i.test(text)
        // eslint-disable-next-line no-control-regex -- ANSI color codes ride local-command stdout
        // a BARE slash command typed at the prompt is recorded as plain text in
        // some paths; it is a command, never the human chatting
        const bareCmd = /^\/[a-z][\w:-]*(\s+\S.*)?$/i.test(clean) && clean.length < 120
        if (xs) out.push({ role: 'peer', from: xs[1], text: xs[2].trim().slice(0, 4000), at: j.timestamp ?? null })
        else if (isCompactMachinery || /^\/compact\b/i.test(clean)) { /* the one compaction event says it all */ }
        // the CLI never renders these: context injected for the model, not
        // for the human. A board that shows them shows MORE than the terminal,
        // and the owner's rule is 1:1 with what the terminal shows.
        else if (/^\s*<system-reminder>/i.test(text) || /^\s*Caveat: /i.test(text) || /^\s*<local-command-caveat>/i.test(text)) { /* invisible in the CLI, invisible here */ }
        else if (bareCmd) out.push({ role: 'system', label: 'local command · ' + clean.split(/\s+/)[0], text: clean, at: j.timestamp ?? null })
        else if (isSystemText(text)) out.push({ role: 'system', label: systemLabel(text), text: text.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 2500), at: j.timestamp ?? null })
        else out.push({ role: 'user', text: clean.slice(0, 4000), images, at: j.timestamp ?? null })
      } else if (isToolResult && images.length) {
        // tool results stay plumbing EXCEPT their pictures: a screenshot a
        // tool returned is something the human should see, not skip
        out.push({ role: 'user', text: '', images, at: j.timestamp ?? null })
      }
    } else if (j.type === 'assistant' && m) {
      const text = textOf(m.content)
      // every part of the native record the UI has an element for: text,
      // thinking (-> Reasoning), tool_use with input (-> Tool)
      const arr = Array.isArray(m.content) ? m.content : []
      const tools = arr.filter((b) => b.type === 'tool_use')
        .map((b) => {
          const t = { name: b.name, input: b.input ?? {}, output: null, isError: false }
          if (b.id) toolIndex.set(b.id, t)
          return t
        })
      if (toolIndex.size > 800) for (const k of [...toolIndex.keys()].slice(0, 400)) toolIndex.delete(k)
      const reasoning = arr.filter((b) => b.type === 'thinking').map((b) => b.thinking ?? '').join('\n').slice(0, 4000)
      if (text.trim() || tools.length || reasoning.trim()) {
        // an API error is the HARNESS speaking, not the desk: synthetic model
        // or "API Error" text renders as a red event, never as the desk's words
        if (m.model === '<synthetic>' || /^\s*API Error/i.test(text)) {
          out.push({ role: 'system', label: 'api error', text: text.slice(0, 2500), at: j.timestamp ?? null })
        } else {
          out.push({ role: 'assistant', text: text.slice(0, 4000), tools, images: imagesOf(m.content), reasoning: reasoning.trim() || null, at: j.timestamp ?? null, model: m.model ?? null })
        }
      }
    }
  }
  return out.slice(-limit)
}

// ⛔ A DESK ASKING A QUESTION IS A DESK BLOCKED ON A HUMAN, and nothing on the
// old board said so. The ask is already in the transcript as a tool call with
// its options; pending means it is the LAST word said — anything after it is
// the answer having arrived.
export function pendingAsk(messages) {
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'assistant' || !last.tools?.length) return null
  const q = last.tools.find((t) => t.name === 'AskUserQuestion')
  if (q && Array.isArray(q.input?.questions)) {
    return {
      type: 'question',
      questions: q.input.questions.map((x) => ({
        question: x.question, header: x.header, multiSelect: !!x.multiSelect,
        options: (x.options ?? []).map((o) => ({ label: o.label, description: o.description ?? '' })),
      })),
    }
  }
  const plan = last.tools.find((t) => t.name === 'ExitPlanMode')
  if (plan) return { type: 'plan', plan: String(plan.input?.plan ?? '').slice(0, 4000) }
  return null
}


// ⛔ THE SERVER WAS RE-READING EVERY TRANSCRIPT IN FULL, SYNCHRONOUSLY, ON
// EVERY POLL. The lead's file is 62 MB; nine desks, a 2.5s poll, one thread:
// the event loop saturated and page fetches queued behind it until the UI
// looked frozen. Every number the first walkthrough measured (83s to first
// render) was this. The reader below stats first and reads ONLY the bytes
// appended since last time; an unchanged file costs one stat.
const tailCache = new Map() // path -> { size, mtimeMs, carry, messages, stats }

export function readTail(path, { limit = 80 } = {}) {
  let st
  try { st = statSync(path) } catch { return null }
  const c = tailCache.get(path)
  if (c && c.size === st.size && c.mtimeMs === st.mtimeMs) return c
  let from = 0, carry = '', messages = [], stats = { turns: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, model: null }, toolIndex = new Map()
  if (c && st.size > c.size) { from = c.size; carry = c.carry; messages = c.messages.slice(); stats = { ...c.stats }; toolIndex = c.toolIndex ?? new Map() }
  const fd = openSync(path, 'r')
  try {
    const len = st.size - from
    const buf = Buffer.alloc(Math.min(len, 64 * 1024 * 1024))
    readSync(fd, buf, 0, buf.length, from)
    const text = carry + buf.toString('utf8')
    const nl = text.lastIndexOf('\n')
    carry = nl >= 0 ? text.slice(nl + 1) : text
    const body = nl >= 0 ? text.slice(0, nl) : ''
    for (const m of chatFrom(body, { limit: Infinity, toolIndex })) messages.push(m)
    for (const line of body.split('\n')) {
      // a human message starts a TURN; its output tokens accumulate until
      // the next one, which is exactly the number the CLI status line shows
      if (line.includes('"type":"user"') && !line.includes('"tool_result"')) stats.turnOutput = 0
      // the CLI's permission mode rides every entry it writes; the newest one
      // IS the current mode, so the board can show it exactly, no guessing
      const pm = /"permissionMode":"([A-Za-z]+)"/.exec(line)
      if (pm) stats.permissionMode = pm[1]
      if (!line.includes('"usage"')) continue
      try {
        const j = JSON.parse(line); const u = j?.message?.usage
        if (!u) continue
        stats.turnOutput = (stats.turnOutput ?? 0) + (u.output_tokens ?? 0)
        // the newest turn's whole prompt = how full the context window is now
        stats.ctxUsed = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
        stats.turns += 1; stats.input += u.input_tokens ?? 0; stats.output += u.output_tokens ?? 0
        stats.cacheRead += u.cache_read_input_tokens ?? 0
        stats.cacheWrite += u.cache_creation_input_tokens ?? 0
        if (j.message?.model) stats.model = j.message.model
      } catch {}
    }
  } finally { closeSync(fd) }
  if (messages.length > limit) messages = messages.slice(-limit)
  const entry = { size: st.size, mtimeMs: st.mtimeMs, carry, messages, toolIndex, stats: { ...stats, lastActiveMs: st.mtimeMs } }
  tailCache.set(path, entry)
  return entry
}
