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

const imagesOf = (content) => {
  const out = []
  if (Array.isArray(content)) {
    for (const b of content) {
      if (b.type === 'image' && b.source?.type === 'base64' && typeof b.source.data === 'string' && b.source.data.length < 8_000_000) {
        out.push({ kind: 'b64', mediaType: b.source.media_type ?? 'image/png', data: b.source.data })
      }
    }
  }
  const text = typeof content === 'string' ? content
    : Array.isArray(content) ? content.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : ''
  for (const m of text.matchAll(IMG_PATH)) out.push({ kind: 'path', path: m[1] })
  return out
}

const textOf = (content) => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
}

export function chatFrom(jsonlText, { limit = 80 } = {}) {
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
      const images = imagesOf(m.content)
      if ((text.trim() || images.length) && !isToolResult) out.push({ role: 'user', text: text.slice(0, 4000), images, at: j.timestamp ?? null })
    } else if (j.type === 'assistant' && m) {
      const text = textOf(m.content)
      // every part of the native record the UI has an element for: text,
      // thinking (-> Reasoning), tool_use with input (-> Tool)
      const arr = Array.isArray(m.content) ? m.content : []
      const tools = arr.filter((b) => b.type === 'tool_use')
        .map((b) => ({ name: b.name, input: b.input ?? {} }))
      const reasoning = arr.filter((b) => b.type === 'thinking').map((b) => b.thinking ?? '').join('\n').slice(0, 4000)
      if (text.trim() || tools.length || reasoning.trim()) {
        out.push({ role: 'assistant', text: text.slice(0, 4000), tools, images: imagesOf(m.content), reasoning: reasoning.trim() || null, at: j.timestamp ?? null, model: m.model ?? null })
      }
    }
  }
  return out.slice(-limit)
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
  let from = 0, carry = '', messages = [], stats = { turns: 0, input: 0, output: 0, cacheRead: 0, model: null }
  if (c && st.size > c.size) { from = c.size; carry = c.carry; messages = c.messages.slice(); stats = { ...c.stats } }
  const fd = openSync(path, 'r')
  try {
    const len = st.size - from
    const buf = Buffer.alloc(Math.min(len, 64 * 1024 * 1024))
    readSync(fd, buf, 0, buf.length, from)
    const text = carry + buf.toString('utf8')
    const nl = text.lastIndexOf('\n')
    carry = nl >= 0 ? text.slice(nl + 1) : text
    const body = nl >= 0 ? text.slice(0, nl) : ''
    for (const m of chatFrom(body, { limit: Infinity })) messages.push(m)
    for (const line of body.split('\n')) {
      if (!line.includes('"usage"')) continue
      try {
        const j = JSON.parse(line); const u = j?.message?.usage
        if (!u) continue
        stats.turns += 1; stats.input += u.input_tokens ?? 0; stats.output += u.output_tokens ?? 0
        stats.cacheRead += u.cache_read_input_tokens ?? 0
        if (j.message?.model) stats.model = j.message.model
      } catch {}
    }
  } finally { closeSync(fd) }
  if (messages.length > limit) messages = messages.slice(-limit)
  const entry = { size: st.size, mtimeMs: st.mtimeMs, carry, messages, stats: { ...stats, lastActiveMs: st.mtimeMs } }
  tailCache.set(path, entry)
  return entry
}
