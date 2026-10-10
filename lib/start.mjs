// START A DESK, AND RECOVER AN OFFICE AFTER A CRASH.
//
//   node lib/start.mjs [root] <name|all|lead|everything> [--fresh]
//   node lib/start.mjs [root] --recover
//
// Each desk is one interactive Claude Code session in its own terminal tab,
// started in its own folder, named desk-<name>, with the office's role
// variable set. The lead is the session office.json "lead.session" names,
// started at the repo root.
//
// Native primitives: liveness and "is it up" come from the CLI's own session
// registry (~/.claude/sessions/<pid>.json: name, sessionId, cwd, status), never
// from the screen; resuming is `claude --resume <id>`; the terminal is the
// adapter office.json "launch.terminal" names (orca, the only one today).
//
// ⛔ "UP" IS THE REGISTRY SAYING SO, NOT A PROMPT ON SCREEN. The first launcher
// waited for "? for shortcuts" or a trailing ❯; in bypass mode the footer says
// something else and the terminal tail is wrapped, so every desk was reported
// failed while all of them came up within a minute.
// ⛔ NEVER --continue (see lib/conversation.mjs): a desk resumes its OWN last
// conversation by id, or starts fresh and says why.
// ⛔ A START NEVER OPENS A SECOND SESSION UNDER ONE NAME. Two live sessions
// named desk-<x> is reported and nothing is opened; one running elsewhere
// (restored at the repo root) or running another session's conversation is
// reported, not killed: closing a live desk is the owner's call.
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { readOfficeConfig, findOffice } from './office.mjs'
import { rosterSafe } from './desk.mjs'
import { liveSessions, processTable } from './procs.mjs'
import { planStart, checkStarted, liveForeign, UUID, claudeDir } from './conversation.mjs'
import { isMain } from './is-main.mjs'

const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._\-[\]]*$/
const SAFE_FLAG = /^--?[A-Za-z][\w-]*(=[\w.:/@-]+)?$/
const SAFE_ENV = /^[A-Za-z_]\w*$/
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`

// office.json "launch" (all optional):
//   { "terminal": "orca", "flags": ["--dangerously-skip-permissions"], "model": "sonnet",
//     "lead": { "flags": ["--remote-control"], "resume": false }, "waitSec": 120 }
// desk.json: "autostart": false keeps a desk out of all/everything; "model" overrides.
export function launchConfig(cfg) {
  const L = cfg?.launch && typeof cfg.launch === 'object' ? cfg.launch : {}
  const flags = (a) => (Array.isArray(a) ? a : []).map(String)
  for (const f of [...flags(L.flags), ...flags(L.lead?.flags)]) if (!SAFE_FLAG.test(f)) throw new Error(`office.json launch flag ${JSON.stringify(f)} is not a plain --flag`)
  if (L.model != null && !SAFE_MODEL.test(String(L.model))) throw new Error(`office.json launch.model ${JSON.stringify(L.model)} is not a model name`)
  return {
    terminal: typeof L.terminal === 'string' ? L.terminal : 'orca',
    flags: flags(L.flags),
    model: L.model != null ? String(L.model) : null,
    lead: { flags: flags(L.lead?.flags), resume: L.lead?.resume === true },
    waitSec: Number.isFinite(L.waitSec) ? L.waitSec : 120,
  }
}

// the shell command a terminal tab runs for one target. Pure.
export function launchCommand({ cfg, target, resume = null, prompt = null }) {
  const L = launchConfig(cfg)
  const roleEnv = typeof cfg?.roleEnv === 'string' && SAFE_ENV.test(cfg.roleEnv) ? cfg.roleEnv : null
  if (resume != null && !UUID.test(String(resume))) throw new Error(`bad session id: ${resume}`)
  const model = target.model != null ? String(target.model) : L.model
  if (model != null && !SAFE_MODEL.test(model)) throw new Error(`desk ${target.name} model ${JSON.stringify(model)} is not a model name`)
  const parts = []
  // an absolute cd: the terminal opens wherever its workspace starts, which
  // need not be the office root (the office can sit inside a bigger repo)
  parts.push(`cd ${q(target.dir)} &&`)
  // a case session runs under its PARENT's role: same token, same wall
  if (roleEnv) parts.push(`${roleEnv}=${q(target.roleTag ?? target.tag)}`)
  parts.push('claude', '--name', q(target.tag))
  if (model) parts.push('--model', model)
  parts.push(...(target.isLead ? [...L.flags, ...L.lead.flags] : L.flags))
  if (resume) parts.push('--resume', resume)
  // the first message, one line: the terminal types the command, and a
  // newline would end it early
  if (prompt != null) { if (/[\r\n]/.test(prompt)) throw new Error('a launch prompt is one line'); parts.push(q(prompt)) }
  return parts.join(' ')
}

// the desks and/or lead a target word means. -> [{ name, tag, isLead, dir, model }]
export function targetsOf(root, cfg, word) {
  const { desks } = rosterSafe(join(root, 'desks'))
  const lead = typeof cfg?.lead?.session === 'string' && cfg.lead.session ? { name: 'lead', tag: cfg.lead.session, isLead: true, dir: root, model: null } : null
  const asTarget = (d) => ({ name: d.name, tag: `desk-${d.name}`, isLead: false, dir: join(root, 'desks', d.name), model: d.model ?? null })
  const auto = desks.filter((d) => d.kind !== 'lead' && d.autostart !== false).map(asTarget)
  if (word === 'all') return auto
  if (word === 'lead') { if (!lead) throw new Error('office.json names no lead.session'); return [lead] }
  if (word === 'everything') return [...(lead ? [lead] : []), ...auto]
  const d = desks.find((x) => x.name === word)
  if (!d) throw new Error(`no desk called ${word} (have: ${desks.map((x) => x.name).join(' ')})`)
  return [asTarget(d)]
}

// the terminal adapter. orca is the one the office already runs.
// ⛔ ORCA OPENS TABS ONLY IN A WORKSPACE IT KNOWS. The office root is not
// necessarily one (an office inside a bigger repo), and `--worktree path:<root>`
// failed with selector_not_found. The workspace is the one whose path is the
// root or the deepest one containing it.
export function orcaWorkspace(root, list) {
  const paths = list.map((w) => w.path ?? String(w.id ?? '').split('::').pop()).filter(Boolean)
  const hits = paths.filter((p) => root === p || root.startsWith(p.endsWith('/') ? p : p + '/')).sort((a, b) => b.length - a.length)
  return hits[0] ?? null
}
export function orcaTerminal(root, run = execFileSync) {
  const orca = (...a) => JSON.parse(run('orca', [...a, '--json'], { encoding: 'utf8' }))
  let ws = null
  const workspace = () => {
    if (ws) return ws
    ws = orcaWorkspace(root, orca('worktree', 'list').result?.worktrees ?? [])
    if (!ws) throw new Error(`no Orca workspace contains ${root}: open the repo in Orca first`)
    return ws
  }
  return {
    titles: () => orca('terminal', 'list', '--worktree', `path:${workspace()}`).result.terminals.filter((t) => t.connected && !t.orphaned).map((t) => ({ handle: t.handle, title: String(t.title ?? '').replace(/^\S+\s+/, '') })),
    create: ({ title, command }) => { const r = orca('terminal', 'create', '--worktree', `path:${workspace()}`, '--title', title, '--command', command); return r.result?.handle ?? r.result?.terminal?.handle ?? null },
    screen: (h) => { try { return (orca('terminal', 'read', '--terminal', h, '--limit', '40').result?.terminal?.tail ?? []).join('\n') } catch { return '' } },
    // the CLI's one-time "Allow external CLAUDE.md imports?" question: Down, Enter = Yes
    answerImports: (h) => { run('orca', ['terminal', 'send', '--terminal', h, '--text', '\x1b[B'], { encoding: 'utf8' }); run('orca', ['terminal', 'send', '--terminal', h, '--text', '', '--enter'], { encoding: 'utf8' }) },
  }
}

const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms))

// open one tab for one target and wait for the CLI's registry to say it is
// up and idle. Shared by desks, the lead and case sessions.
export async function launchAndWait({ cfg, L = launchConfig(cfg), term, t, plan, live, sleep = sleepReal, now = Date.now, procs = () => processTable(), prompt = null }) {
  const handle = term.create({ title: t.tag, command: launchCommand({ cfg, target: t, resume: plan.resume, prompt }) })
  if (!handle) return { state: 'failed', why: 'the terminal adapter opened no tab' }
  const t0 = now()
  let result = null
  while (now() - t0 < L.waitSec * 1000) {
    await sleep(1000)
    if (/Allow external CLAUDE\.md/i.test(term.screen(handle))) { term.answerImports(handle); continue }
    const c = checkStarted({ tag: t.tag, live: live(), resume: plan.resume })
    if (c.state === 'clash' || (c.state === 'wrong' && c.session?.status === 'idle')) { result = { state: c.state === 'clash' ? 'clash' : 'foreign', why: c.why }; break }
    if (c.ok && c.session.status === 'idle') { result = { state: 'up', why: `${Math.round((now() - t0) / 1000)}s, pid ${c.session.pid}, ${plan.resume ? 'resumed its own conversation' : 'new conversation'} (${plan.why})` }; break }
  }
  if (!result) {
    const s2 = live().find((s) => s.name === t.tag)
    // ⛔ STARTED IS NOT REGISTERED. A claude that sits at a dialog nobody
    // can see (a folder not trusted yet, a tab the terminal app opened in
    // the background with no screen) runs and never registers; say so
    let stuck = null
    try { for (const p of procs().values()) if (new RegExp(`(^|/)claude\\b.*--name '?${t.tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'?(\\s|$)`).test(p.cmd)) { stuck = p; break } } catch {}
    result = s2 ? { state: 'busy', why: `registered (pid ${s2.pid}) but not idle after ${L.waitSec}s (status ${s2.status})` }
      : stuck ? { state: 'failed', why: `claude started (pid ${stuck.pid}) but never registered within ${L.waitSec}s: it is waiting at a dialog nobody can see. The folder may not be trusted yet (start it once by hand), or the terminal opened it in the background with no screen` }
      : { state: 'failed', why: `no session named ${t.tag} registered within ${L.waitSec}s, and no claude process carries that name` }
  }
  return { ...result, handle }
}

// -> [{ target, tag, state, why, resume?, handle? }]
//   state: up | already | degraded | foreign | clash | busy | failed
export async function start(root, word, { fresh = false, cfg = readOfficeConfig(root), live = () => liveSessions(homedir(), processTable()), terminal = null, sleep = sleepReal, dir = claudeDir(), now = Date.now, procs = () => processTable() } = {}) {
  const L = launchConfig(cfg)
  const term = terminal ?? (L.terminal === 'orca' ? orcaTerminal(root) : null)
  if (!term) throw new Error(`office.json launch.terminal "${L.terminal}" has no adapter (orca is the one there is)`)
  const out = []
  for (const t of targetsOf(root, cfg, word)) {
    const running = live().filter((s) => s.name === t.tag)
    if (running.length > 1) { out.push({ target: t.name, tag: t.tag, state: 'clash', why: `${running.length} live sessions are named ${t.tag} (pids ${running.map((s) => s.pid).join(', ')}): close the extra one; nothing was opened` }); continue }
    const sess = running[0] ?? null
    const tab = sess ? null : term.titles().find((x) => x.title === t.tag) ?? null
    if (sess || tab) {
      const off = sess && sess.cwd && resolve(sess.cwd) !== resolve(t.dir)
      const foreign = sess && !t.isLead ? liveForeign(sess, t.tag, { dir }) : null
      if (foreign) out.push({ target: t.name, tag: t.tag, state: 'foreign', why: `running conversation ${sess.sessionId}, which ${foreign}: close it (pid ${sess.pid}) and start again to resume the desk's own` })
      else if (off) out.push({ target: t.name, tag: t.tag, state: 'degraded', why: `running at ${sess.cwd}, not ${t.dir}: its own instructions are not loaded; close it (pid ${sess.pid}) and start again to resume it in its folder` })
      else out.push({ target: t.name, tag: t.tag, state: 'already', why: sess ? `pid ${sess.pid}` : `tab ${tab.handle}, not registered yet` })
      continue
    }
    const plan = t.isLead && !L.lead.resume && !fresh
      ? { resume: null, why: 'the lead starts a new conversation each time (launch.lead.resume is off)', skipped: [] }
      : planStart({ tag: t.tag, cwd: t.dir, fresh, live: live(), dir })
    const r = await launchAndWait({ cfg, L, term, t, plan, live, sleep, now, procs })
    out.push({ target: t.name, tag: t.tag, ...r, resume: plan.resume })
  }
  return out
}

// After a crash (the machine, the terminal app or a disk took every session
// down): the lead first, so it is there to hear the desks, then every
// autostart desk, each resuming its own conversation. The desks re-arm their
// doorbells from the boot text; health then says what is still not right.
export async function recover(root, opts = {}) {
  const cfg = opts.cfg ?? readOfficeConfig(root)
  const word = typeof cfg?.lead?.session === 'string' && cfg.lead.session ? 'everything' : 'all'
  return start(root, word, { ...opts, cfg })
}

export const exitCodeOf = (rows) => (rows.every((r) => r.state === 'up' || r.state === 'already') ? 0 : 4)

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2)
  const fresh = args.includes('--fresh')
  const doRecover = args.includes('--recover')
  const words = args.filter((a) => !a.startsWith('--'))
  const root = (words.length > (doRecover ? 0 : 1) ? findOffice(words.shift()) : findOffice(process.cwd())) ?? null
  if (!root || (!doRecover && words.length !== 1)) {
    console.error('usage: node lib/start.mjs [root] <name|all|lead|everything> [--fresh]  |  node lib/start.mjs [root] --recover')
    process.exit(1)
  }
  let rows
  try { rows = doRecover ? await recover(root) : await start(root, words[0], { fresh }) }
  catch (e) { console.error(`start: ${e.message}`); process.exit(1) }
  for (const r of rows) console.log(`${r.target}\t${r.state}\t${r.why}`)
  process.exit(exitCodeOf(rows))
}
