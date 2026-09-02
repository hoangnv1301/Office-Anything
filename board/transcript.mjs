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
      if (text.trim() && !isToolResult) out.push({ role: 'user', text: text.slice(0, 4000), at: j.timestamp ?? null })
    } else if (j.type === 'assistant' && m) {
      const text = textOf(m.content)
      // every part of the native record the UI has an element for: text,
      // thinking (-> Reasoning), tool_use with input (-> Tool)
      const arr = Array.isArray(m.content) ? m.content : []
      const tools = arr.filter((b) => b.type === 'tool_use')
        .map((b) => ({ name: b.name, input: b.input ?? {} }))
      const reasoning = arr.filter((b) => b.type === 'thinking').map((b) => b.thinking ?? '').join('\n').slice(0, 4000)
      if (text.trim() || tools.length || reasoning.trim()) {
        out.push({ role: 'assistant', text: text.slice(0, 4000), tools, reasoning: reasoning.trim() || null, at: j.timestamp ?? null, model: m.model ?? null })
      }
    }
  }
  return out.slice(-limit)
}
