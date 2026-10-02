#!/usr/bin/env node
// ⛔ DOES ANYTHING OPEN A BROWSER JUST BECAUSE A SESSION STARTED?
//
// A desk's browser is for the moment it browses. An office whose start-up hooks
// launched a Chrome per desk put a wall of windows on the owner's screen every
// time the desks came up, most of them for desks that never touched a page,
// and the owner read it as "the whole computer goes off when I open the
// board". The fix is the rule: a browser starts when a tool needs it (a
// browser MCP does this by itself on its first call), never from a hook that
// runs because a session began.
//
// This reads the hooks Claude Code fires on its own at start-up or on every
// prompt (SessionStart, Setup, UserPromptSubmit) in the office's and each
// desk's .claude/settings*.json, and the local script each one runs, one
// level deep, for the shapes that start a browser.
//
// ⚠️ IT CANNOT SEE OUTSIDE THE REPO. A launchd job or a keeper loop that opens
// windows on its own schedule is not a hook; it is named in the README as the
// other place to look.
//
// Exit 0 clean, 4 finding, 7 UNKNOWN.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { rosterSafe } from '../lib/desk.mjs'
import { isMain } from '../lib/is-main.mjs'

export const applies = (root) => existsSync(join(root, 'desks'))

// the hook events that fire without any tool asking for anything
export const EAGER_EVENTS = ['SessionStart', 'Setup', 'UserPromptSubmit']

// what starting a browser looks like in a command or a script
export const LAUNCH = [
  /--remote-debugging-port\b/,
  /\bopen\s+(?:-[a-zA-Z]+\s+)*(?:-a\s+)?["']?(?:Google Chrome|Chromium|Safari|Firefox|Microsoft Edge|Arc|Brave Browser)\b/i,
  /\bopen\s+(?:-[a-zA-Z]+\s+)*["']?https?:\/\//i,
  /\bxdg-open\b/,
  /\b(?:chromium|firefox|webkit)\.launch(?:PersistentContext)?\s*\(/,
  /\bpuppeteer\.launch\s*\(/,
]

export function launchIn(text) {
  for (const re of LAUNCH) { const m = re.exec(text); if (m) return m[0].trim() }
  return null
}

// a hook command's local script: the first argument that is a file we can read
function scriptOf(command, projectDir) {
  // `${CLAUDE_PROJECT_DIR%%/desks/*}` (strip the longest matching suffix, as
  // shell does) is how a desk names the office root; resolve it the same way
  const strip = (pat) => { const lit = pat.split('*')[0]; const i = lit ? projectDir.indexOf(lit) : -1; return i >= 0 ? projectDir.slice(0, i) : projectDir }
  const expanded = command
    .replace(/\$\{CLAUDE_PROJECT_DIR%%([^}]*)\}/g, (_, pat) => strip(pat))
    .replace(/\$\{?CLAUDE_PROJECT_DIR\}?/g, projectDir)
  for (const tok of expanded.match(/"[^"]+"|'[^']+'|\S+/g) ?? []) {
    const t = tok.replace(/^["']|["']$/g, '')
    if (!/\.(m?js|cjs|ts|sh|py)$/.test(t)) continue
    const p = resolve(projectDir, t)   // absolute or not, normalised
    try { if (statSync(p).isFile() && statSync(p).size < 2_000_000) return p } catch {}
  }
  return null
}

export function eagerLaunches(settingsFile, projectDir) {
  let hooks
  try { hooks = JSON.parse(readFileSync(settingsFile, 'utf8')).hooks ?? {} } catch { return [] }
  const out = []
  for (const event of EAGER_EVENTS) {
    for (const m of hooks[event] ?? []) for (const h of m.hooks ?? []) {
      const cmd = String(h.command ?? '')
      if (!cmd) continue
      let hit = launchIn(cmd), where = 'its command'
      if (!hit) {
        const s = scriptOf(cmd, projectDir)
        if (s) { try { hit = launchIn(readFileSync(s, 'utf8')); where = s } catch {} }
      }
      if (hit) out.push({ event, command: cmd.slice(0, 120), hit, where })
    }
  }
  return out
}

export function report(root = process.cwd()) {
  if (!applies(root)) return { code: 0, applicable: false, why: 'no desks/ directory' }
  const { desks } = rosterSafe(join(root, 'desks'))
  if (!desks.length) return { code: 0, applicable: false, why: 'no desks yet' }
  const places = [{ who: 'the office', dir: root }, ...desks.map((d) => ({ who: d.name, dir: d.dir }))]
  const findings = []
  let read = 0
  for (const { who, dir } of places) {
    for (const f of ['settings.json', 'settings.local.json']) {
      const file = join(dir, '.claude', f)
      if (!existsSync(file)) continue
      read++
      for (const l of eagerLaunches(file, dir)) {
        findings.push({ desk: who, say: `${l.event} hook starts a browser (${l.hit}, in ${l.where === 'its command' ? l.where : l.where.replace(root + '/', '')}). Start it when a tool needs it, not when the session starts.` })
      }
    }
  }
  if (findings.length) return { code: 4, applicable: true, why: `${findings.length} hook(s) open a browser at start-up`, findings }
  return { code: 0, applicable: true, why: read ? `${read} settings file(s), no start-up hook opens a browser` : 'no desk settings declare hooks, so nothing opens a browser at start-up' }
}

if (isMain(import.meta.url)) {
  const r = report(resolve(process.argv[2] ?? process.cwd()))
  if (!r.applicable) { console.log(`   not applicable  ${r.why}`); process.exit(0) }
  if (r.code === 0) { console.log(`ok  ${r.why}`); process.exit(0) }
  console.log(`⛔ ${r.why}\n`)
  for (const f of r.findings) console.log(`   ${f.desk}: ${f.say}`)
  process.exit(4)
}
