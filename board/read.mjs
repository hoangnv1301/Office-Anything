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
import { newestSession, readTail } from './transcript.mjs'

// Claude Code's own slug: the absolute cwd with / and spaces flattened to -.
export const slugFor = (absPath) => absPath.replace(/[/ ]/g, '-')

export function transcriptStats(projectDir) {
  try {
    const files = readdirSync(projectDir).filter((f) => f.endsWith('.jsonl'))
    if (!files.length) return null
    const t = newestSession(projectDir)
    if (!t) return null
    const tail = readTail(t)
    if (!tail) return null
    return { sessions: files.length, ...tail.stats }
  } catch { return null }
}

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

// A bounded tree of a session's WORKING folder (its cwd), for the rail.
// .git and node_modules are nobody's reading; everything else shows, dotfiles
// included, because desks genuinely live in .claude/ and friends. Bounded in
// depth and entry count so a big repo cannot flood the page.
export function treeOf(dir, { depth = 3, maxEntries = 500, perDir = 50 } = {}) {
  let budget = maxEntries
  const root = { dirs: {}, files: [] }
  const queue = [{ d: dir, node: root, level: 0 }]
  while (queue.length) {
    const { d, node, level } = queue.shift()
    let entries = []
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { continue }
    entries.sort((a, b) => (b.isDirectory() ? 1 : 0) - (a.isDirectory() ? 1 : 0) || a.name.localeCompare(b.name))
    let taken = 0
    for (const e of entries) {
      if (e.name === '.git' || e.name === 'node_modules') continue
      if (taken >= perDir || budget <= 0) { node.truncated = true; break }
      taken++; budget--
      if (e.isDirectory()) {
        const child = { dirs: {}, files: [] }
        node.dirs[e.name] = child
        if (level + 1 < depth) queue.push({ d: join(d, e.name), node: child, level: level + 1 })
        else child.shallow = true
      } else {
        let size = 0; try { size = statSync(join(d, e.name)).size } catch {}
        node.files.push({ name: e.name, size })
      }
    }
  }
  return root
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
