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

export function terminalFor(desk, run = execFileSync) {
  const out = run('orca', ['terminal', 'list', '--json'], { encoding: 'utf8', stdio: 'pipe' })
  const terminals = JSON.parse(out)?.result?.terminals ?? []
  const hit = terminals.find((t) => normalizeTitle(t.title) === desk)
  return hit?.handle ?? null
}

export function send(desk, text, run = execFileSync) {
  if (!orcaAvailable(run)) return { ok: false, why: 'no orca CLI on this host; the board is read-only here' }
  const handle = terminalFor(desk, run)
  if (!handle) return { ok: false, why: `no live terminal is titled "${desk}"` }
  run('orca', ['terminal', 'send', '--terminal', handle, '--text', text, '--enter', '--json'], { encoding: 'utf8', stdio: 'pipe' })
  return { ok: true, handle }
}
