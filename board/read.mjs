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
import { openSync, readSync, closeSync } from 'node:fs'

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

// ⛔ SUBAGENTS ARE ALREADY ON DISK. Every Task/subagent run writes its own
// jsonl beside the main session (sdk entrypoints, sidechains). "Show the
// running sub-agents" — the Grok Build idea — is therefore a READ, not a
// runtime: recently-active transcripts that are not the human session ARE
// the live agents. Recency is the only honest liveness signal a file gives.
export function subagentsOf(projectDir, mainSessionPath, { now = Date.now(), activeMs = 10 * 60_000, cap = 5 } = {}) {
  try {
    const out = []
    for (const f of readdirSync(projectDir)) {
      if (!f.endsWith('.jsonl')) continue
      const p = join(projectDir, f)
      if (p === mainSessionPath) continue
      const st = statSync(p)
      if (now - st.mtimeMs > activeMs) continue
      const tail = readTail(p, { limit: 4 })
      if (!tail) continue
      // the label is what the human first SAID, never a session slug like
      // "alibaba-claude-runbook-v2-40" or a harness envelope that happened
      // to be the first line
      const first = tail.messages.find((m) => m.role === 'user' && m.text && !/^[\w.-]+-\d+$/.test(m.text.trim()) && !/^</.test(m.text.trim()))
      // ⛔ TWO KINDS OF COMPANY: an sdk-spawned SUBAGENT (a task, disposable)
      // and a full peer SESSION (a teammate, a second window). The transcript
      // head says which; conflating them made every teammate look like a bot.
      let kind = 'agent'
      // the task that spawned an agent is its FIRST user line, at the head of
      // the file, not in the tail: read the head once for both the kind and
      // the label, so a row never has to say just "agent"
      let headLabel = null
      try {
        const fd = openSync(p, 'r'); const b = Buffer.alloc(16384)
        const n = readSync(fd, b, 0, 16384, 0); closeSync(fd)
        const head = b.slice(0, n).toString('utf8')
        if (head.includes('"entrypoint":"cli"')) kind = 'session'
        for (const line of head.split('\n')) {
          if (!line.includes('"type":"user"')) continue
          try {
            const j = JSON.parse(line); const c = j?.message?.content
            const t = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => x.type === 'text').map((x) => x.text).join(' ') : ''
            const clean = t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
            if (clean && !/^[\w.-]+-\d+$/.test(clean)) { headLabel = clean; break }
          } catch { /* a torn head line is not a label */ }
        }
      } catch {}
      out.push({
        kind,
        label: (headLabel ?? first?.text ?? (kind === 'session' ? 'another session at this desk' : 'agent')).replace(/\s+/g, ' ').slice(0, 64),
        activeMin: Math.round((now - st.mtimeMs) / 60000),
        turns: tail.stats.turns,
        model: tail.stats.model,
      })
    }
    return out.sort((a, b) => a.activeMin - b.activeMin).slice(0, cap)
  } catch { return [] }
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

// BACKGROUND JOBS, from the native surface: a task the harness runs in the
// background streams into <session>/tasks/<id>.output. A file still growing
// is a job still running; one gone quiet is recently finished.
export function jobsOf(scratchBase, { now = Date.now() } = {}) {
  try {
    const sessions = readdirSync(scratchBase, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => ({ name: e.name, at: statSync(join(scratchBase, e.name)).mtimeMs }))
      .sort((a, b) => b.at - a.at)
    if (!sessions.length) return []
    const dir = join(scratchBase, sessions[0].name, 'tasks')
    return readdirSync(dir).filter((f) => f.endsWith('.output')).map((f) => {
      const st = statSync(join(dir, f))
      return { id: f.replace(/\.output$/, '').slice(0, 12), ageSec: Math.round((now - st.mtimeMs) / 1000), size: st.size }
    }).filter((j) => j.ageSec < 600).sort((a, b) => a.ageSec - b.ageSec).slice(0, 6)
  } catch { return [] }
}

// A bounded tree of a session's WORKING folder (its cwd), for the rail.
// .git and node_modules are nobody's reading; everything else shows, dotfiles
// included, because desks genuinely live in .claude/ and friends. Bounded in
// depth and entry count so a big repo cannot flood the page.
// depth 5 / 1500 entries: at depth 3 the tree cut .claude/skills/<name>/
// off at the knees and an expanded folder showed NOTHING (owner hit it on
// .claude/skills/browser). bk/ is the attic and is nobody's workspace.
export function treeOf(dir, { depth = 5, maxEntries = 1500, perDir = 50 } = {}) {
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
      if (e.name === '.git' || e.name === 'node_modules' || e.name === 'bk') continue
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
