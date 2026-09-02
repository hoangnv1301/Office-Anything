// THE BOARD'S READERS. Everything Claude Code already knows about a desk,
// read from disk, never from asking an agent. Self-report is not a source:
// the system this contract came from watched an agent name the wrong model
// about itself on 2026-08-04.
//
// Native sources, and only native sources:
//   desks/*/desk.json                          the contract: kind, port, live
//   ~/.claude/projects/<cwd-slug>/*.jsonl      transcripts: model, turns, tokens, last activity
//   /private/tmp/claude-<uid>/<cwd-slug>/...   the session's scratchpad: the worktop
//
// ⛔ NO DOLLARS. A price table maintained by hand goes stale the day a model
// ships, and a wrong cost is worse than a token count. Tokens and turns are
// facts; money is a rate somebody must own elsewhere.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { rosterSafe } from '../lib/desk.mjs'

// Claude Code's own slug: the absolute cwd with / and spaces flattened to -.
export const slugFor = (absPath) => absPath.replace(/[/ ]/g, '-')

export function transcriptStats(projectDir) {
  // Newest transcript = the live session. Older ones are history; their count
  // is reported, their contents are not re-read on every page load.
  try {
    const files = readdirSync(projectDir).filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({ f, at: statSync(join(projectDir, f)).mtimeMs }))
      .sort((a, b) => b.at - a.at)
    if (!files.length) return null
    const newest = files[0]
    let turns = 0, input = 0, output = 0, cacheRead = 0, model = null
    for (const line of readFileSync(join(projectDir, newest.f), 'utf8').split('\n')) {
      if (!line.includes('"usage"')) continue
      try {
        const j = JSON.parse(line)
        const u = j?.message?.usage
        if (!u) continue
        turns += 1
        input += u.input_tokens ?? 0
        output += u.output_tokens ?? 0
        cacheRead += u.cache_read_input_tokens ?? 0
        if (j.message?.model) model = j.message.model
      } catch { /* a torn line mid-write is normal in a live transcript */ }
    }
    return { sessions: files.length, lastActiveMs: newest.at, model, turns, input, output, cacheRead }
  } catch { return null }
}

// Files under ONE session's scratchpad: the folder of exactly that session.
export function filesUnder(dir) {
  const files = []
  const walk = (d, prefix = '') => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name), prefix + e.name + '/')
      else { const st = statSync(join(d, e.name)); files.push({ name: prefix + e.name, size: st.size, at: st.mtimeMs }) }
    }
  }
  try { walk(dir) } catch { return [] }
  return files.sort((a, b) => b.at - a.at)
}

export function worktop(scratchBase) {
  try {
    const sessions = readdirSync(scratchBase, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => ({ name: e.name, at: statSync(join(scratchBase, e.name)).mtimeMs }))
      .sort((a, b) => b.at - a.at)
    if (!sessions.length) return []
    const files = []
    const walk = (d, prefix = '') => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(d, e.name), prefix + e.name + '/')
        else { const st = statSync(join(d, e.name)); files.push({ name: prefix + e.name, size: st.size, at: st.mtimeMs }) }
      }
    }
    walk(join(scratchBase, sessions[0].name, 'scratchpad'))
    return files.sort((a, b) => b.at - a.at)
  } catch { return [] } // no session, or tmp swept at boot: an empty worktop is the truth
}

export function gatherOffice(root, {
  home = homedir(),
  tmp = '/private/tmp',
  uid = process.getuid(),
  now = Date.now(),
} = {}) {
  const { desks, broken } = rosterSafe(join(root, 'desks'))
  const rows = desks.map((d) => {
    const slug = slugFor(join(root, 'desks', d.name))
    const stats = transcriptStats(join(home, '.claude', 'projects', slug))
    return {
      name: d.name, kind: d.kind, port: d.port, live: d.live,
      stats,
      idleMin: stats ? Math.round((now - stats.lastActiveMs) / 60000) : null,
      worktop: worktop(join(tmp, `claude-${uid}`, slug)).map((f) => ({ ...f, ageMin: Math.round((now - f.at) / 60000) })),
    }
  })
  return { root, generatedAt: now, desks: rows, broken }
}
