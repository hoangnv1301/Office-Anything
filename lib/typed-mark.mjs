// WHAT THE OFFICE ITSELF TYPES INTO A TERMINAL IS MARKED (review of #99).
// Claude Code records text typed into a pane as turnOrigin "human", promptSource "typed", whoever typed
// it. The office types a lot: a scheduled job line ("do it now"), the usage-limit resume text, the
// doorbell kickoff. None of it is the owner, and none of it may ever be taken as his approval.
//
// The mark is a record beside the text, not a prefix on it: other offices match these texts exactly
// (a "Scheduled office job … is due" rule, an equality test on the resume text), and a prefix would
// break them. `.office/office-typed.jsonl` holds { at, hash } for every text the office sent;
// lib/approvals.mjs refuses a prompt whose text is in it, however well it parses.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const KEEP = 7 * 24 * 3600_000
export const typedMarkFile = (root) => join(root, '.office', 'office-typed.jsonl')
export const textHash = (s) => createHash('sha256').update(String(s).replace(/\s+/g, ' ').trim()).digest('hex')

// -> the same text, after recording it. A record that cannot be written is thrown: nothing unmarked is typed.
export function markOfficeTyped(root, text, { now = Date.now() } = {}) {
  if (!root) throw new Error('office-typed: no office root to record the text in')
  mkdirSync(join(root, '.office'), { recursive: true })
  if (!existsSync(join(root, '.office', '.gitignore'))) writeFileSync(join(root, '.office', '.gitignore'), '# office-anything state and logs; never committed\n*\n')
  appendFileSync(typedMarkFile(root), JSON.stringify({ at: now, hash: textHash(text) }) + '\n')
  return text
}
export function wasOfficeTyped(root, text, { now = Date.now() } = {}) {
  const h = textHash(text)
  let t = ''
  try { t = readFileSync(typedMarkFile(root), 'utf8') } catch { return false }
  for (const l of t.split('\n')) {
    if (!l.includes(h)) continue
    try { const e = JSON.parse(l); if (e.hash === h && now - e.at < KEEP) return true } catch {}
  }
  return false
}
