// WHICH CONVERSATION IS A DESK'S OWN, AND IS EXACTLY ONE SESSION RUNNING IT.
//
// ⛔ NEVER `claude --continue` IN A DESK'S FOLDER. --continue resumes the
// NEWEST conversation in the cwd's project folder, and a desk's case sessions
// (desk-<name>--<key>) run in that same folder. On 2026-10-10 a disk
// disconnect killed every session; the restart --continue'd the newest
// conversation there, which was a case session's, and the parent desk woke up
// believing it was that case. So a desk resumes only by explicit id:
//   - Claude Code writes the session name into the transcript (`custom-title`
//     and `agent-name` records: first in the file, again on every resume).
//   - A conversation is the desk's own when its FIRST name and every later
//     name are the desk's. One another session resumed under the desk's name
//     carries both, and is nobody's to resume.
//   - Never one a live session has open right now.
//   - None found = a fresh conversation, and the caller says why.
// The registry (~/.claude/sessions) is for liveness only: after that crash its
// name was the parent's while its sessionId was the case's.
// ponytail: names are read from the first 256 KB and the last 2 MB of a
// transcript. A rename buried mid-file and renamed back before its end is not
// seen; launchers always pass --name, so nothing renames sessions that way.
import { readFileSync, readdirSync, statSync, openSync, readSync, closeSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'

export const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
// Claude Code's project folder for a cwd: every non-alphanumeric becomes -
export const projectDirOf = (cwd, dir = claudeDir()) => join(dir, 'projects', String(cwd).replace(/[^A-Za-z0-9]/g, '-'))
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const HEAD_BYTES = 256 * 1024
export const TAIL_BYTES = 2 * 1024 * 1024

// session names recorded in transcript text, in order (a line a window cut is skipped)
export function namesIn(text) {
  const out = []
  for (const line of String(text ?? '').split('\n')) {
    if (!line.includes('"type":"custom-title"') && !line.includes('"type":"agent-name"')) continue
    let j; try { j = JSON.parse(line) } catch { continue }
    const n = j?.type === 'custom-title' ? j.customTitle : j?.type === 'agent-name' ? j.agentName : null
    if (typeof n === 'string' && n) out.push(n)
  }
  return out
}

const slice = (file, from, n) => { const fd = openSync(file, 'r'); try { const b = Buffer.alloc(n); const got = readSync(fd, b, 0, n, from); return b.subarray(0, got).toString('utf8') } finally { closeSync(fd) } }

// { birth: the first name, names: every name in the head and the tail } | null when there is no file
export function transcriptNames(file, { head = HEAD_BYTES, tail = TAIL_BYTES, tailToo = true } = {}) {
  let size; try { size = statSync(file).size } catch { return null }
  if (size <= head + tail) { const names = namesIn(readFileSync(file, 'utf8')); return { birth: names[0] ?? null, names } }
  const h = namesIn(slice(file, 0, head))
  if (!tailToo) return { birth: h[0] ?? null, names: h }
  const names = [...h, ...namesIn(slice(file, size - tail, tail))]
  return { birth: h[0] ?? names[0] ?? null, names }
}

// null when every recorded name is one of `own` (or none is recorded), else why not
export function foreignName(info, own) {
  const ok = new Set(own)
  if (!info?.names?.length) return null
  if (!ok.has(info.birth)) return `started as ${info.birth}`
  const other = info.names.find((n) => !ok.has(n))
  return other ? `also ran as ${other}` : null
}

// The newest conversation in `cwd` that is `tag`'s own and not open in a live
// session. -> { id, why, skipped: [{ id, why }] }; id null = start fresh.
export function ownConversation({ tag, cwd, dir = claudeDir(), childIds = new Set(), liveIds = new Set(), names = transcriptNames, list = (d) => readdirSync(d), mtime = (f) => statSync(f).mtimeMs } = {}) {
  const pdir = projectDirOf(cwd, dir)
  let files = []
  try { files = list(pdir).filter((f) => f.endsWith('.jsonl') && UUID.test(basename(f, '.jsonl'))) } catch { return { id: null, why: 'no conversations yet', skipped: [] } }
  const by = files.map((f) => { const p = join(pdir, f); let m = 0; try { m = mtime(p) } catch {} return { id: basename(f, '.jsonl'), p, m } }).sort((a, b) => b.m - a.m)
  const skipped = []
  for (const { id, p } of by) {
    if (childIds.has(id)) { skipped.push({ id, why: 'a case session\'s conversation' }); continue }
    const head = names(p, { tailToo: false })
    if (!head?.birth) { skipped.push({ id, why: 'no session name recorded' }); continue }
    if (head.birth !== tag) { skipped.push({ id, why: `started as ${head.birth}` }); continue }
    const f = foreignName(names(p), [tag])
    if (f) { skipped.push({ id, why: f }); continue }
    if (liveIds.has(id)) { skipped.push({ id, why: 'open in a live session right now' }); continue }
    return { id, why: `its own last conversation (every name in it is ${tag})`, skipped }
  }
  return { id: null, why: by.length ? `none of the ${by.length} conversation(s) here is ${tag}'s own` : 'no conversations yet', skipped }
}

// what a start runs: resume <own id>, or fresh. -> { resume, why, skipped }
export function planStart({ tag, cwd, fresh = false, live = [], childIds = new Set(), dir = claudeDir(), own = ownConversation }) {
  if (fresh) return { resume: null, why: '--fresh: a new conversation, history not resumed', skipped: [] }
  const liveIds = new Set(live.map((s) => s.sessionId).filter(Boolean))
  const o = own({ tag, cwd, childIds, liveIds, dir })
  return { resume: o.id, why: o.why, skipped: o.skipped }
}

// After a start: exactly one live session named `tag`, running what was asked for?
//   clash  two or more carry the name (the duplicate guard: report, open nothing more)
//   wrong  the one live session runs another conversation than the one resumed
//   wait   none registered yet
export function checkStarted({ tag, live = [], resume = null }) {
  const mine = live.filter((s) => s.name === tag)
  if (!mine.length) return { ok: false, why: `no live session named ${tag} yet`, state: 'wait' }
  if (mine.length > 1) return { ok: false, why: `${mine.length} live sessions are named ${tag} (pids ${mine.map((s) => s.pid).join(', ')}): close the extra one; nothing else is opened`, state: 'clash' }
  if (resume && mine[0].sessionId !== resume) return { ok: false, why: `${tag} (pid ${mine[0].pid}) runs conversation ${mine[0].sessionId}, not ${resume}`, state: 'wrong', session: mine[0] }
  return { ok: true, why: `one live ${tag}, pid ${mine[0].pid}, conversation ${mine[0].sessionId}`, state: 'ok', session: mine[0] }
}

// a live session carrying the desk's name but running somebody else's conversation -> why, or null
export function liveForeign(sess, tag, { dir = claudeDir(), names = transcriptNames, exists = existsSync } = {}) {
  if (!sess?.sessionId || !sess?.cwd) return null
  const p = join(projectDirOf(sess.cwd, dir), `${sess.sessionId}.jsonl`)
  if (!exists(p)) return null
  return foreignName(names(p), [tag])
}
