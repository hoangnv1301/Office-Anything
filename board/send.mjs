// SEND. Typing into a live desk terminal is a real act with a real blast
// radius, so the adapter is explicit about what it can and cannot do.
//
// Two roads, both explicit (see the inbox section below): the session's own
// messaging inbox, the way SendMessage reaches it, and the orca CLI that owns
// the terminals, for keystrokes. Neither open means the board is READ-ONLY
// for that desk and says why; it never falls back to something cleverer.
import { execFileSync, execFile } from 'node:child_process'

// ⛔ THE SPINNER GLYPH CYCLES while a desk works (✳ ✶ ✽ ...), so stripping
// one literal star called the BUSIEST desks offline and made send miss them.
// Strip any leading symbol run; a desk name starts with a letter.
// The prefix is case-blind: a launcher that names tabs `desk-<name>` must match too.
const DESK_PREFIX = /^desk-/i
export const normalizeTitle = (t) => String(t ?? '').replace(/^[^A-Za-z0-9]+/, '').replace(DESK_PREFIX, '').trim()
const namesADesk = (t) => DESK_PREFIX.test(String(t ?? '').replace(/^[^A-Za-z0-9]+/, ''))

export function orcaAvailable(run = execFileSync) {
  try { run('orca', ['--version'], { encoding: 'utf8', stdio: 'pipe' }); return true } catch { return false }
}

// one `orca terminal list` is a few hundred ms of every send; the roster
// barely moves, so the REAL runner gets a 3s cache. Injected runners (tests)
// bypass it: a cached mock would poison the next test's world.
let listCache = { at: 0, terminals: null }
// the warmer keeps the cache fresh from the BACKGROUND, so no user's send
// ever pays the ~3s list call in the foreground. Started by the server.
export function keepTerminalsWarm(intervalMs = 2500) {
  const refresh = () => {
    execFile('orca', ['terminal', 'list', '--json'], { encoding: 'utf8', timeout: 8000 }, (e, out) => {
      if (e) return
      try { listCache = { at: Date.now(), terminals: JSON.parse(out)?.result?.terminals ?? [] } } catch {}
    })
  }
  refresh()
  const t = setInterval(refresh, intervalMs)
  t.unref?.()
  return t
}
export function terminalFor(desk, run = execFileSync, dir = null) {
  let terminals
  if (run === execFileSync && listCache.terminals && Date.now() - listCache.at < 15000) {
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
  // path) unreachable by construction. Newest output wins a tie. A tab that
  // names itself a desk is never the lead's: launchers that open every desk
  // at the repo root would otherwise hand the lead's message to a desk.
  if (dir) {
    const byDir = terminals.filter((t) => t.worktreePath === dir && t.writable !== false && !namesADesk(t.title))
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

// ── THE SESSION'S OWN INBOX ─────────────────────────────────────────────────
// Every interactive Claude Code session registers a messaging socket in
// ~/.claude/sessions/<pid>.json (messagingSocketPath) and a key file beside it,
// <pid>.<sha256(socket path)>.key, holding the peerToken a sender presents.
// That is the inbox SendMessage delivers to: one auth line, one JSON line,
// and the session queues the words for its next tool round, idle or busy,
// with nothing typed into a terminal.
//
// ⛔ IT IS A PEER'S CHANNEL, AND THE BOARD SAYS SO. What arrives this way is
// a cross-session message: the desk reads it as another session speaking,
// never as its own user typing, so it is never an approval. And a session
// running with permissions bypassed HOLDS a message that asserts no mode, for
// its user's approval at its own screen. The board asserts no mode it does
// not have: forging one to get past that hold would launder the owner's
// permission decision. For such a desk the terminal is the honest route.
import { createHash, randomUUID } from 'node:crypto'
import { connect } from 'node:net'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const BOARD_NAME = 'office board'

export function inboxOf(ls, home = homedir()) {
  const sock = ls?.messagingSocketPath
  if (typeof sock !== 'string' || !sock.startsWith('/') || !ls.pid) return null
  const keyFile = join(home, '.claude', 'sessions', `${ls.pid}.${createHash('sha256').update(sock).digest('hex')}.key`)
  try {
    const k = JSON.parse(readFileSync(keyFile, 'utf8'))
    if (typeof k.peerToken !== 'string' || !k.peerToken) return null
    return { sock, token: k.peerToken, pid: ls.pid }
  } catch { return null }
}

// the envelope the CLI itself writes, minus the sender address and mode the
// board does not have: the receiver shows "from office board"
export const envelope = (text, fromName = BOARD_NAME) =>
  `<cross-session-message from-name="${String(fromName).replace(/["<>\r\n]/g, '')}">\n${text}\n</cross-session-message>`

export function frameFor(text, token, { fromName = BOARD_NAME, id = randomUUID() } = {}) {
  const msg = { msgV: 1, msg_id: id, type: 'user', message: { role: 'user', content: envelope(text, fromName) }, priority: 'next' }
  return JSON.stringify({ type: 'auth', token }) + '\n' + JSON.stringify(msg) + '\n'
}

export function sendToInbox(inbox, text, { dial = connect, timeoutMs = 5000, fromName } = {}) {
  return new Promise((resolve) => {
    let done = false
    const finish = (r) => { if (!done) { done = true; resolve(r) } }
    let s
    try { s = dial({ path: inbox.sock }) } catch (e) { return finish({ ok: false, why: 'inbox unreachable: ' + e.message }) }
    s.setTimeout?.(timeoutMs, () => { s.destroy(); finish({ ok: false, why: 'the desk\'s inbox did not answer in ' + timeoutMs / 1000 + 's' }) })
    s.on('error', (e) => finish({ ok: false, why: 'inbox unreachable: ' + (e.code ?? e.message) }))
    s.on('connect', () => {
      s.write(frameFor(text, inbox.token, { fromName }))
      // the CLI's own sender lingers before closing on macOS so the receiver
      // reads the whole line before the FIN; the board does the same
      setTimeout(() => { try { s.end() } catch {} }, 150)
    })
    s.on('close', () => finish({ ok: true, via: 'inbox' }))
  })
}

// Which road a message to this desk takes, decided from what the CLI records,
// never guessed: the inbox when the desk will take a peer message without a
// human approving it there; the terminal otherwise; a plain refusal when
// neither is open.
export function routeFor({ inbox, mode, terminal }) {
  const holds = mode === 'bypassPermissions' || !mode
  if (inbox && !holds) return { via: 'inbox' }
  if (terminal) return { via: 'terminal' }
  if (inbox) return { via: null, why: mode === 'bypassPermissions'
    ? 'this desk runs with permissions bypassed, so Claude Code holds a message from outside the session for approval at its own screen, and the board will not claim a mode it does not have. Type it in the desk\'s terminal, or open the desk in the Claude app.'
    : 'this desk\'s permission mode is not on record yet, so a message to its inbox may be held for approval at its screen. Type it in its terminal, or open it in the Claude app.' }
  return { via: null, why: 'this desk has no live session inbox and no terminal the board can reach' }
}
