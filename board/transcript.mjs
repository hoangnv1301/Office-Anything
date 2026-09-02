// TRANSCRIPT → CHAT. The session's jsonl is the native record of the
// conversation; this renders its tail as messages and never invents one.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export function newestSession(projectDir) {
  try {
    const files = readdirSync(projectDir).filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({ f, at: statSync(join(projectDir, f)).mtimeMs }))
      .sort((a, b) => b.at - a.at)
    return files.length ? join(projectDir, files[0].f) : null
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
      const tools = Array.isArray(m.content) ? m.content.filter((b) => b.type === 'tool_use').map((b) => b.name) : []
      if (text.trim() || tools.length) out.push({ role: 'assistant', text: text.slice(0, 4000), tools, at: j.timestamp ?? null, model: m.model ?? null })
    }
  }
  return out.slice(-limit)
}
