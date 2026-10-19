// WHEN IS A SESSION IDLE, AND SINCE WHEN. One owner for the question, read by
// the case sweep (lib/cases.mjs) and by heal's close-when-idle (lib/heal.mjs).
// Its own module because heal must not import cases.mjs: cases imports desks,
// and a cycle under heal once hung the CLI (lib/procs.mjs).
import { openSync, readSync, fstatSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { doorbell, wakeSpec } from './procs.mjs'
import { projectDirOf } from './conversation.mjs'

// ⛔ A DOORBELL IS IDLE (2026-10-19). A session parked in a foreground
// doorbell reads "shell", never "idle", and its statusUpdatedAt restarts on
// every re-arm, so ~14 buyer sessions sat open past an hour. Parked is "idle",
// or "shell" with the process tree proving the shell is the desk's own
// doorbell (any other command in the shell is work). A shell's clock is the
// transcript's last work: a prompt, or a tool call that is not the doorbell.
// What cannot be proven stays open.
// The book (clock A: the adapter's heartbeat answer, idle[{key, since}]) is
// the only one that knows "no draft in progress, no reply owed": since null
// keeps the session open; otherwise idle is the LATER of the book's and the
// session's own clock, and the book alone when the session's cannot be read.
// -> ms since idle | null
export function idleSince(desk, s, procs, o, book = null) {
  let own = null
  if (s.status === 'idle') own = s.statusUpdatedAt ? Number(s.statusUpdatedAt) : null
  else if (s.status === 'shell' && doorbell(desk, s, procs, o.now(), undefined, o.root ?? null).state === 'armed') own = s.sessionId && s.cwd ? lastWorkAt(join(projectDirOf(s.cwd, o.dir), `${s.sessionId}.jsonl`), desk) : null
  else return null
  if (!book) return own
  if (book.since == null) return null
  return own == null ? book.since : Math.max(own, book.since)
}

// the transcript's last work, read from its last 2 MB: a prompt, or a tool
// call that is not the doorbell (re-arming it, and what it answered, is not work)
export function lastWorkAt(file, desk, bytes = 2 << 20) {
  const w = wakeSpec(desk)
  const re = typeof desk.wakeMatch === 'string' && desk.wakeMatch ? new RegExp(desk.wakeMatch) : null
  const isBell = (c) => c?.name === 'Bash' && typeof c.input?.command === 'string' && (re ? re.test(c.input.command) : !!w?.tail && c.input.command.includes(w.tail))
  let text = ''
  let fd
  try { fd = openSync(file, 'r'); const size = fstatSync(fd).size, from = Math.max(0, size - bytes); const b = Buffer.alloc(size - from); readSync(fd, b, 0, b.length, from); text = b.toString('utf8') } catch { return null } finally { if (fd !== undefined) closeSync(fd) }
  const bells = new Set()
  let last = null
  for (const line of text.split('\n')) {
    let j; try { j = JSON.parse(line) } catch { continue }
    const ts = Date.parse(j?.timestamp ?? '')
    const c = j?.message?.content
    if (!(ts > 0)) continue
    let work = false
    if (j.type === 'assistant' && Array.isArray(c)) {
      for (const x of c) if (x?.type === 'tool_use') { if (isBell(x)) bells.add(x.id); else work = true }
    } else if (j.type === 'user') {
      work = typeof c === 'string' || (Array.isArray(c) && c.some((x) => x?.type === 'text' || (x?.type === 'tool_result' && !bells.has(x.tool_use_id))))
    }
    if (work) last = ts
  }
  return last
}
