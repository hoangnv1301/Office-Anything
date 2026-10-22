// ROLES: OPEN A SESSION AS WHO YOU MEAN TO BE (0.17.0).
//
// The owner, 2026-10-22: "open a session at root, then choose who to become".
// A session's CLAUDE.md, settings deny list, claudeMdExcludes and name are all
// fixed when it starts, so a role is never switched in place: that session
// would carry the wrong context and walls, and messages would go to its old
// name. A role is a NEW session, started with that role's cwd, --name and
// --settings.
//
//   office.json "profiles": {
//     "construction": { "cwd": ".", "deny": ["Read(./departments/**/*)"], "note": "Do not search departments/." },
//     "full":         { "cwd": "." },
//     "aics":         { "department": "customer-service", "claudeMdExcludes": ["**/local-cabinets-ops/CLAUDE.md"] },
//     "erp":          { "department": "local-ops" }
//   }
//   .office/local.json "role": "aics"     this machine's default
//
// A profile's session name: its department's lead (aics -> AICS), its builder
// (office.json "construction": the profile named like it, or "builder": <name>),
// else "session", else the profile's own name. Its cwd: the department's
// folder, else "cwd", else the builder's root.
//
//   node lib/role.mjs [root] list [--json]     the roles this machine may open
//   node lib/role.mjs [root] here [<role>]     start it in THIS terminal (the shell's `office`)
//   node lib/role.mjs [root] open <role>       in a NEW tab (/role): Orca, else tmux, else Terminal
//   node lib/role.mjs install                  put `office` on this machine's PATH
//
// ⛔ THE SETTINGS FILE IS GENERATED, NEVER IN THE REPO. One statement (office.json),
// written to ~/.office/profiles/<office>/<role>.json on every launch, so a change
// to office.json reaches the next session started, and nothing hand-written drifts.
// ⛔ GLOBS, NOT MACHINE PATHS. A rule's "/x" is relative to the SETTINGS FILE (which
// lives in ~/.office, not the repo), "//x" and "~/x" are this machine's: each is
// refused. "./x" and "x" are relative to the session's folder.
// ⛔ NEVER TWO SESSIONS UNDER ONE NAME. A role already running is found by the
// CLI's registry (name and folder), and its tab is brought forward instead.
// ⛔ NOT FROM A DESK. A desk that could open a "full" session would walk out of
// its own wall; only the lead or a developer opens a role.
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, readSync, accessSync, constants } from 'node:fs'
import { join, resolve, sep, basename, dirname } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isMain } from './is-main.mjs'
import { findOffice, readOfficeConfig, whoIs } from './office.mjs'
import { departmentsOf, machineOf, constructionOf } from './departments.mjs'
import { launchCommand, orcaTerminal } from './start.mjs'
import { liveSessions, processTable } from './procs.mjs'
import { planStart, carryOver, claudeDir } from './conversation.mjs'
import { tabFor } from './limits.mjs'

const NAME = /^[a-z][a-z0-9-]{0,39}$/
const RULE = /^[A-Za-z][A-Za-z0-9_]*(\(.*\))?$/s
const strs = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : [])

// a rule's path, when it names one: Read(./x) -> ./x
const pathOf = (rule) => /^[A-Za-z]+\((.*)\)$/s.exec(rule)?.[1] ?? null
const machinePath = (p) => /^(\/|~|[A-Za-z]:[\\/])/.test(String(p ?? '').trim())

// office.json "profiles" -> { list: [profile], problems: [why] }, every profile
// the office declares (which this machine may open: rolesHere)
export function profilesOf(root, cfg) {
  const raw = cfg?.profiles
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { list: [], problems: raw == null ? [] : ['office.json "profiles" is not an object of profiles'] }
  const D = departmentsOf(cfg)
  const B = constructionOf(cfg)
  const list = [], problems = []
  for (const [name, p] of Object.entries(raw)) {
    if (name.startsWith('_')) continue
    const no = (why) => problems.push(`profile ${name}: ${why}`)
    if (!NAME.test(name)) { no('is not a profile name (lowercase letters, digits and hyphens)'); continue }
    if (!p || typeof p !== 'object' || Array.isArray(p)) { no('is not an object'); continue }
    let dept = null
    if (p.department != null) {
      dept = D.list.find((d) => d.id === p.department) ?? null
      if (!dept) { no(`names department "${p.department}", which office.json does not declare`); continue }
    }
    // a builder's profile: named like it, or "builder": its name. Its folder is the
    // builder's root, which may be another codebase (the plugin's own repo)
    const builder = B.find((b) => b.name === name || b.name === p.builder) ?? null
    if (p.builder != null && !builder) { no(`names builder "${p.builder}", which office.json "construction" does not list`); continue }
    const cwdRel = dept ? dept.dir : typeof p.cwd === 'string' && p.cwd.trim() ? p.cwd.trim() : builder ? builder.root : '.'
    const cwd = resolve(root, cwdRel)
    if (!(cwd + sep).startsWith(resolve(root) + sep) && !(builder && cwd === resolve(root, builder.root))) { no(`its folder ${cwdRel} is outside the office (only a builder's own root may be)`); continue }
    const deny = strs(p.deny), allow = strs(p.allow), excludes = strs(p.claudeMdExcludes)
    const badRule = [...deny, ...allow].find((r) => !RULE.test(r))
    if (badRule) { no(`"${badRule}" is not a permission rule (Tool or Tool(specifier))`); continue }
    const local = [...deny, ...allow].map(pathOf).find((x) => x != null && machinePath(x)) ?? excludes.find(machinePath)
    if (local) { no(`"${local}" is a path on one machine (or, starting with one /, relative to the generated settings file in ~/.office): write ./… or a glob such as **/…`); continue }
    const session = dept ? dept.lead : typeof p.session === 'string' && p.session.trim() ? p.session.trim() : builder?.name ?? name
    list.push({
      name, session, cwd, department: dept?.id ?? null, isLead: !!dept, builder: builder?.name ?? null,
      model: typeof p.model === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p.model) ? p.model : builder?.model ?? null,
      deny, allow, claudeMdExcludes: excludes, rootSettings: p.rootSettings !== false, note: typeof p.note === 'string' && p.note.trim() ? p.note.replace(/\s+/g, ' ').trim().slice(0, 500) : null,
    })
  }
  return { list, problems }
}

// the roles THIS machine may open: a department's only where .office/local.json
// names that department (AICS never opens on a machine that did not say so)
export function rolesHere(root, cfg) {
  const P = profilesOf(root, cfg)
  const m = departmentsOf(cfg).on ? machineOf(root, cfg) : { set: null }
  const here = P.list.filter((p) => !p.department || (m.set ?? []).includes(p.department))
  let role = null
  try { const r = JSON.parse(readFileSync(join(root, '.office', 'local.json'), 'utf8')).role; if (typeof r === 'string') role = r } catch {}
  return { list: here, hidden: P.list.filter((p) => !here.includes(p)).map((p) => p.name), problems: P.problems, default: here.some((p) => p.name === role) ? role : null }
}

// ⛔ A SESSION BELOW THE ROOT DOES NOT LOAD THE ROOT'S .claude/settings.json (0.18.2).
// A lead in departments/aics would run with none of the root's hooks (its write
// wall, its main-tree guard, its stop gate, its boot): no wall. So a profile whose
// folder is not the root carries them in its generated --settings:
//   hooks          every root hook, run with CLAUDE_PROJECT_DIR set to the office
//                  root (the commands were written for it: "$CLAUDE_PROJECT_DIR/desks/…")
//   permissions    the root's allow / deny, a rule's /x (relative to the root's
//                  settings file) written as //<root>/x, then the profile's own
//   enabledPlugins the root's
// office.json profile "rootSettings": false leaves them out.
const q = (x) => `'${String(x).replace(/'/g, `'\\''`)}'`
export function rootSettingsOf(root) {
  const out = { hooks: {}, allow: [], deny: [], enabledPlugins: null }
  for (const f of ['settings.json', 'settings.local.json']) {
    let j
    try { j = JSON.parse(readFileSync(join(root, '.claude', f), 'utf8')) } catch { continue }
    for (const [ev, list] of Object.entries(j?.hooks ?? {})) if (Array.isArray(list)) out.hooks[ev] = [...(out.hooks[ev] ?? []), ...list]
    const abs = (r) => String(r).replace(/^([A-Za-z]+)\(\/(?!\/)/, (m0, tool) => `${tool}(//${resolve(root).replace(/^\//, '')}/`)
    out.allow.push(...strs(j?.permissions?.allow).map(abs))
    out.deny.push(...strs(j?.permissions?.deny).map(abs))
    if (j?.enabledPlugins && typeof j.enabledPlugins === 'object') out.enabledPlugins = { ...(out.enabledPlugins ?? {}), ...j.enabledPlugins }
  }
  return out
}
// the --settings a profile starts with
export function settingsOf(p, { root = null } = {}) {
  const s = {}
  const R = root && p.rootSettings !== false && resolve(p.cwd) !== resolve(root) ? rootSettingsOf(root) : null
  const allow = [...(R?.allow ?? []), ...p.allow], deny = [...(R?.deny ?? []), ...p.deny]
  if (allow.length || deny.length) s.permissions = { ...(allow.length ? { allow } : {}), ...(deny.length ? { deny } : {}) }
  if (p.claudeMdExcludes.length) s.claudeMdExcludes = p.claudeMdExcludes
  if (R && Object.keys(R.hooks).length) {
    const pin = `export CLAUDE_PROJECT_DIR=${q(resolve(root))}; `
    s.hooks = Object.fromEntries(Object.entries(R.hooks).map(([ev, list]) => [ev, list.map((m) => ({ ...m, hooks: (m.hooks ?? []).map((h) => (h?.type === 'command' || typeof h?.command === 'string' ? { ...h, command: pin + h.command } : h)) }))]))
  }
  if (R?.enabledPlugins) s.enabledPlugins = R.enabledPlugins
  return s
}

// ~/.office/profiles/<office>/: the office's folder name and a hash of where it is
// (two checkouts called the same are two offices)
export const profilesDir = (root, home = homedir()) => join(home, '.office', 'profiles', `${basename(resolve(root))}-${createHash('sha1').update(resolve(root)).digest('hex').slice(0, 8)}`)

// written when it differs from what office.json says now -> the file's path
export function writeProfile(root, p, home = homedir()) {
  const f = join(profilesDir(root, home), `${p.name}.json`)
  const text = JSON.stringify(settingsOf(p, { root }), null, 2) + '\n'
  let had = null
  try { had = readFileSync(f, 'utf8') } catch {}
  if (had !== text) { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text) }
  return f
}

// the shell command that starts a profile's session. resume: its own last conversation
export function roleCommand(root, cfg, p, { home = homedir(), resume = null } = {}) {
  const file = writeProfile(root, p, home)
  const cmd = launchCommand({ cfg, target: { name: p.session, tag: p.session, dir: p.cwd, isLead: p.isLead, model: p.model, sandboxFile: file }, resume })
  // OFFICE_PROFILE tells the boot hook which role this is (its note, and no "/role to switch")
  return cmd.replace(/^(cd '[^']*(?:'\\''[^']*)*' && )/, `$1OFFICE_PROFILE=${p.name} `)
}

// is this role running already? -> { session } (here) | { elsewhere } | null
export function running(p, sessions) {
  const named = sessions.filter((s) => s.name === p.session)
  const here = named.find((s) => s.cwd && resolve(s.cwd) === p.cwd)
  if (here) return { session: here }
  return named.length ? { elsewhere: named[0] } : null
}

const find = (root, cfg, word) => {
  const R = rolesHere(root, cfg)
  const want = word ?? R.default
  if (!want) return { why: `name a role: ${R.list.map((p) => p.name).join(', ') || '(this office declares none it lets this machine open)'}` }
  const p = R.list.find((x) => x.name === want || x.session === want)
  if (!p) return { why: R.hidden.includes(want) ? `${want} belongs to a department this machine does not run (.office/local.json): not opened here` : `no role called ${want}; this machine may open: ${R.list.map((x) => x.name).join(', ') || 'none'}` }
  return { p }
}

// the session's own conversation, as start resumes a desk's
function resumeOf(p, cfg, sessions) {
  if (p.isLead && cfg?.launch?.lead?.resume !== true) return null
  const plan = planStart({ tag: p.session, cwd: p.cwd, live: sessions, dir: claudeDir() })
  return carryOver(plan, p.cwd) ? null : plan.resume
}

// the tab a running role is in, brought forward when the terminal can
function focus(term, s) {
  if (!term?.all) return null
  try {
    const f = tabFor(term.all(), s)
    if (!f.handle) return null
    try { term.switch?.(f.handle) } catch {}
    return f.handle
  } catch { return null }
}

// ⛔ NO REAL WINDOW UNDER A TEST (2026-10-23: a test run opened stacked Terminal
// windows on the owner's desktop, each a claude at its "trust this folder?"
// prompt). Under node --test (NODE_TEST_CONTEXT) or OFFICE_NO_LAUNCH=1 the REAL
// openers (Orca, tmux, Terminal, a shell running claude) refuse; a test injects
// its own. -> null (may launch) | why not
export function launchRefused(env = process.env) {
  if (env.OFFICE_NO_LAUNCH === '1') return 'OFFICE_NO_LAUNCH=1: no real window or session is opened'
  if (env.NODE_TEST_CONTEXT && env.OFFICE_NO_LAUNCH !== '0') return 'under node --test no real window or session is opened (inject term and run)'
  return null
}

// is Orca running? (its CLI answers)
const orcaUp = (run) => { try { const x = run('orca', ['terminal', 'list', '--json'], { encoding: 'utf8', timeout: 5000 }); return !x.error && x.status === 0 } catch { return false } }

// /role: a NEW tab. -> { state: 'opened'|'already'|'refused', why }
// ⛔ ORCA FIRST. Terminal or tmux only when Orca is not running at all; Orca
// running but unable to open it here is said, never quietly a plain window.
export function openRole(root, word, { cfg = readOfficeConfig(root), sessions = liveSessions(homedir(), processTable()), term = null, run = null, env = process.env, home = homedir(), caller = null } = {}) {
  const real = term === null || run === null
  const blocked = real ? launchRefused(process.env) ?? launchRefused(env) : null
  run ??= spawnSync
  const me = caller ?? whoIs(root, cfg, { cwd: env.PWD ?? process.cwd(), env })
  if (me?.kind === 'desk') return { state: 'refused', why: `a desk does not open other sessions (it is desk ${me.desk}): a role is the lead's or a developer's to open` }
  const f = find(root, cfg, word)
  if (!f.p) return { state: 'refused', why: f.why }
  const p = f.p
  const r = running(p, sessions)
  let t = term
  const orca = () => { if (t === null) { try { t = orcaTerminal(root); t.all() } catch { t = false } } return t || null }
  if (r?.session) { const h = focus(orca(), r.session); return { state: 'already', why: `${p.session} is already open${h ? `: Orca tab ${h}, brought forward` : ` (pid ${r.session.pid})`}; not opening a second` } }
  if (r?.elsewhere) return { state: 'refused', why: `a session named ${p.session} already runs at ${r.elsewhere.cwd} (pid ${r.elsewhere.pid}): one name, one session. Close it first` }
  if (blocked) return { state: 'refused', why: blocked }
  const cmd = roleCommand(root, cfg, p, { home, resume: resumeOf(p, cfg, sessions) })
  const T = orca()
  if (T?.create) {
    let h = null, err = null
    try { h = T.create({ title: p.session, command: cmd }) } catch (e) { err = e.message }
    if (h) { try { T.switch?.(h) } catch {} return { state: 'opened', why: `the new ${p.session} session is open in Orca tab ${h}; you can close this one` } }
    return { state: 'refused', why: `Orca is running but could not open a tab for ${p.cwd}${err ? ` (${err})` : ''}: open that folder's repo in Orca, then /role again` }
  }
  if (orcaUp(run)) return { state: 'refused', why: `Orca is running but has no workspace holding ${root}: open the repo in Orca, then /role again (not opening a plain Terminal window instead)` }
  if (env.TMUX) {
    const x = run('tmux', ['new-window', '-n', p.session, cmd], { encoding: 'utf8' })
    if (!x.error && x.status === 0) return { state: 'opened', why: `the new ${p.session} session is open in tmux window ${p.session}; you can close this one` }
  }
  if (process.platform === 'darwin') {
    const x = run('osascript', ['-e', `tell application "Terminal" to do script ${JSON.stringify(cmd)}`, '-e', 'tell application "Terminal" to activate'], { encoding: 'utf8' })
    if (!x.error && x.status === 0) return { state: 'opened', why: `the new ${p.session} session is open in a Terminal window; you can close this one` }
  }
  return { state: 'refused', why: 'no terminal to open it in (Orca is not running, no tmux, no Terminal): run `office ' + p.name + '` in a new terminal' }
}

// `office`: in THIS terminal. -> { state, why, cmd? } (cmd: what to exec)
export function hereRole(root, word, { cfg = readOfficeConfig(root), sessions = liveSessions(homedir(), processTable()), home = homedir(), term = null } = {}) {
  const f = find(root, cfg, word)
  if (!f.p) return { state: 'refused', why: f.why }
  const p = f.p
  const r = running(p, sessions)
  if (r?.session) { let h = null; try { const t = term ?? orcaTerminal(root); h = focus(t, r.session) } catch {} return { state: 'already', why: `${p.session} is already open${h ? `: Orca tab ${h}, brought forward` : ` (pid ${r.session.pid})`}; not opening a second` } }
  if (r?.elsewhere) return { state: 'refused', why: `a session named ${p.session} already runs at ${r.elsewhere.cwd} (pid ${r.elsewhere.pid}): one name, one session` }
  return { state: 'start', why: `${p.session} (${p.name})`, cmd: roleCommand(root, cfg, p, { home, resume: resumeOf(p, cfg, sessions) }) }
}

// `office` on PATH: a shim that runs the plugin installed NOW (an update moves it)
const SHIM = (home) => `#!/bin/sh
# written by office-anything (node lib/role.mjs install): open a session as a role
# usage: office [role]   (no role: this machine's default from .office/local.json, else a menu)
for d in $(ls -1d "${'$'}{CLAUDE_CONFIG_DIR:-${home}/.claude}"/plugins/cache/*/office-anything/*/ 2>/dev/null | sort -V -r); do
  if [ -f "$d/lib/role.mjs" ]; then exec node "$d/lib/role.mjs" "$(pwd)" here "$@"; fi
done
echo "office: the office-anything plugin is not installed" >&2; exit 1
`
// ⛔ NEVER SUDO. /usr/local/bin when it is on PATH and THIS user may write it,
// else ~/.local/bin (made if missing), with the PATH line to add when it is not
// on PATH. 0.17.0 threw EACCES on a /usr/local/bin it could not write.
export function installShim({ home = homedir(), dir = null, path = process.env.PATH ?? '', writable = (d) => { try { accessSync(d, constants.W_OK); return true } catch { return false } } } = {}) {
  const on = (d) => path.split(':').includes(d)
  const local = join(home, '.local', 'bin')
  const bin = dir ?? (on('/usr/local/bin') && existsSync('/usr/local/bin') && writable('/usr/local/bin') ? '/usr/local/bin' : local)
  mkdirSync(bin, { recursive: true })
  const f = join(bin, 'office')
  writeFileSync(f, SHIM(home))
  chmodSync(f, 0o755)
  return { file: f, onPath: on(bin), pathLine: on(bin) ? null : `export PATH="${bin}:$PATH"` }
}

if (isMain(import.meta.url)) {
  const a = process.argv.slice(2)
  const verbs = ['list', 'here', 'open', 'install']
  const vi = a.findIndex((x) => verbs.includes(x))
  const verb = vi >= 0 ? a[vi] : null
  const rest = vi >= 0 ? a.slice(vi + 1).filter((x) => !x.startsWith('--')) : []
  if (verb === 'install') {
    const r = installShim()
    console.log(`office: ${r.file}`)
    if (r.pathLine) console.log(`${dirname(r.file)} is not on your PATH. Add this line to ~/.zshrc (or your shell's rc file), then open a new terminal:\n  ${r.pathLine}`)
    process.exit(0)
  }
  const root = findOffice(vi > 0 ? a[0] : process.cwd())
  if (!root || !verb) { console.error('usage: node lib/role.mjs [root] list [--json] | here [<role>] | open <role> | install'); process.exit(1) }
  const cfg = readOfficeConfig(root)
  if (verb === 'list') {
    const R = rolesHere(root, cfg)
    if (a.includes('--json')) { console.log(JSON.stringify({ roles: R.list.map((p) => ({ name: p.name, session: p.session, cwd: p.cwd, department: p.department })), default: R.default, hidden: R.hidden, problems: R.problems })); process.exit(0) }
    for (const p of R.list) console.log(`${p.name === R.default ? '*' : ' '} ${p.name.padEnd(14)} ${p.session.padEnd(16)} ${p.cwd.slice(resolve(root).length + 1) || '.'}`)
    for (const x of R.problems) console.log(`  ⚠ ${x}`)
    process.exit(R.list.length ? 0 : 4)
  }
  if (verb === 'open') {
    const r = openRole(root, rest[0] ?? null, { cfg })
    console.log(r.why)
    process.exit(r.state === 'refused' ? 4 : 0)
  }
  // here: no role and no default -> a menu on this terminal
  let word = rest[0] ?? null
  const R = rolesHere(root, cfg)
  if (!word && !R.default) {
    if (!R.list.length) { console.error('office: this office declares no role this machine may open (office.json "profiles")'); process.exit(4) }
    R.list.forEach((p, i) => process.stderr.write(`  ${i + 1}. ${p.name} (${p.session})\n`))
    process.stderr.write('which one? ')
    const buf = Buffer.alloc(64)
    let n = 0
    try { n = readSync(0, buf, 0, 64, null) } catch {}
    const pick = R.list[Number(buf.subarray(0, n).toString().trim()) - 1]
    if (!pick) { console.error('office: nothing chosen'); process.exit(1) }
    word = pick.name
  }
  const r = hereRole(root, word, { cfg })
  if (r.state !== 'start') { console.log(r.why); process.exit(r.state === 'refused' ? 4 : 0) }
  const no = launchRefused()
  if (no) { console.log(no); process.exit(4) }
  const x = spawnSync('/bin/sh', ['-c', r.cmd], { stdio: 'inherit' })
  process.exit(x.status ?? 1)
}
