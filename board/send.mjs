// SEND. Typing into a live desk terminal is a real act with a real blast
// radius, so the adapter is explicit about what it can and cannot do.
//
// The only adapter today is the orca CLI, because it is the thing that
// actually owns these terminals and its send verb is already trusted by the
// system this contract came from. No orca on PATH means the board is
// READ-ONLY and says so; it never falls back to something cleverer.
import { execFileSync } from 'node:child_process'

// ⛔ THE SPINNER GLYPH CYCLES while a desk works (✳ ✶ ✽ ...), so stripping
// one literal star called the BUSIEST desks offline and made send miss them.
// Strip any leading symbol run; a desk name starts with a letter.
export const normalizeTitle = (t) => String(t ?? '').replace(/^[^A-Za-z0-9]+/, '').replace(/^DESK-/, '').trim()

export function orcaAvailable(run = execFileSync) {
  try { run('orca', ['--version'], { encoding: 'utf8', stdio: 'pipe' }); return true } catch { return false }
}

// one `orca terminal list` is a few hundred ms of every send; the roster
// barely moves, so the REAL runner gets a 3s cache. Injected runners (tests)
// bypass it: a cached mock would poison the next test's world.
let listCache = { at: 0, terminals: null }
export function terminalFor(desk, run = execFileSync, dir = null) {
  let terminals
  if (run === execFileSync && listCache.terminals && Date.now() - listCache.at < 3000) {
    terminals = listCache.terminals
  } else {
    const out = run('orca', ['terminal', 'list', '--json'], { encoding: 'utf8', stdio: 'pipe' })
    terminals = JSON.parse(out)?.result?.terminals ?? []
    if (run === execFileSync) listCache = { at: Date.now(), terminals }
  }
  const hit = terminals.find((t) => normalizeTitle(t.title) === desk)
  if (hit) return hit.handle
  // The LEAD's tab is titled with its task summary, never "team-lead", so a
  // title match cannot find it. The terminal's own working directory can:
  // exact worktreePath equality, which also makes v1's terminal (a different
  // path) unreachable by construction. Newest output wins a tie.
  if (dir) {
    const byDir = terminals.filter((t) => t.worktreePath === dir && t.writable !== false)
      .sort((a, b) => (b.lastOutputAt ?? 0) - (a.lastOutputAt ?? 0))
    if (byDir[0]) return byDir[0].handle
  }
  return null
}

export function send(desk, text, run = execFileSync, dir = null) {
  if (!orcaAvailable(run)) return { ok: false, why: 'no orca CLI on this host; the board is read-only here' }
  const handle = terminalFor(desk, run, dir)
  if (!handle) return { ok: false, why: `no live terminal is titled "${desk}" or working in its folder` }
  run('orca', ['terminal', 'send', '--terminal', handle, '--text', text, '--enter', '--json'], { encoding: 'utf8', stdio: 'pipe' })
  return { ok: true, handle }
}
