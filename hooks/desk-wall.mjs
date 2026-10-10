#!/usr/bin/env node
// ⛔ THE DESK WALL: what a desk session may touch, as a gate, not a sentence in
// its CLAUDE.md. A PreToolUse hook on Bash, Read and the writing tools.
//
// It is the send wall's sibling. The send wall keeps a knowledge desk from
// growing a route to a customer; this keeps every desk inside its own folder:
//
//   every desk   writes only inside its own folder (never its .claude/ or
//                runtime/, which are its door and its keys), and Bash writes
//                only there or to a temp dir; reads no secret file and no
//                other desk's runtime/; does not cd into another desk; does
//                not reassign the role or token variables; no git writes.
//   the lead     (office.json "lead"): writes no file; when "wall.lead.bash"
//                lists commands, its Bash is exactly one of them, unchained.
//   the office   adds its own refusals in office.json "wall.deny" (the
//                business's deploy tools, its database CLI), each with the
//                reason the desk is shown.
//
// ⛔ INERT UNLESS AN OFFICE ASKS FOR IT. No office.json with "wall" above the
// session's folder, or a session that is no desk (a developer on the repo):
// exit 0, untouched. A plugin hook runs in every project it is installed in.
//
// ⛔ FAIL OPEN BY DEFAULT, CLOSED WHEN THE OFFICE SAYS SO. This plugin's rule
// is that a crashing gate must not block every write in a repo. An office
// whose wall is its only door may decide otherwise ("wall.failClosed": true):
// then a desk session whose payload cannot be read, or whose rules cannot be
// compiled, is refused rather than waved through. That is the office's call,
// made in its own file, and it applies to desk sessions only.
import { readOfficeConfigStrict, findOffice, whoIs, sessionName } from '../lib/office.mjs'
import { compileWall, judge } from '../lib/wall.mjs'
import { openModule } from '../lib/wall-module.mjs'
import { isMain } from '../lib/is-main.mjs'
import { resolve, join, sep } from 'node:path'
import { existsSync, realpathSync } from 'node:fs'

// The office's own rules, in its own file: office.json "wall.module" names an
// ES module inside the office exporting judge(payload, who, { root, cfg, session }) ->
// reason | null, and/or alias(name, { root }) -> a canonical session name
// (desk-<x> or desk-<x>--<key>) for a name only the office understands.
// It runs AFTER the plugin's rules: it can refuse more, never allow more. It
// runs in a worker under a deadline (lib/wall-module.mjs).
export function officeModule(root, cfg) {
  const rel = cfg?.wall?.module
  if (typeof rel !== 'string' || !rel) return null
  const f = resolve(root, rel)
  let real = null
  try { real = existsSync(f) ? realpathSync(f) : null } catch {}
  if (!real || !(real + sep).startsWith(realpathSync(root) + sep)) throw new Error(`wall.module ${rel} is not a file inside the office`)
  return openModule(real)
}

// ⛔ THE OFFICE IS FOUND FROM THE SESSION, NOT FROM WHERE IT STANDS. A desk
// that cd's out of the repo (/tmp, its home) sent a payload cwd with no
// office above it, and the wall waved everything through. CLAUDE_PROJECT_DIR
// is the folder the session was started in, and it does not move with cd;
// it is asked first, then the payload's cwd, then this process's.
export function locate(p, env = process.env, here = process.cwd()) {
  const places = [env.CLAUDE_PROJECT_DIR, p?.cwd, here].filter(Boolean)
  for (const at of places) { const root = findOffice(at); if (root) return { root, places } }
  return { root: null, places }
}

// ⛔ CLOSED BY DEFAULT ONCE AN OFFICE HAS A WALL (the lead's review of 0.7.40).
// The plugin's general rule, "a crashing hook exits 0", is for a plugin that
// sits in every repo. An office that wrote a wall wants it to hold: unless it
// says "failClosed": false, a desk session is refused when the wall cannot
// judge (its config broken, its payload unreadable, its module missing,
// throwing or hanging). A session that claims no desk is never stopped by it.
export async function decide(raw, env = process.env, here = process.cwd()) {
  let p = null, unreadable = false
  try { p = JSON.parse(raw || '{}'); if (!p || typeof p !== 'object') { p = null; unreadable = true } } catch { unreadable = true }
  const { root, places } = locate(p, env, here)
  if (!root) return { code: 0 }
  const { cfg, error } = readOfficeConfigStrict(root)
  if (error) {
    // no config to say who is who: a session that claims a desk by its name,
    // or stands in a desk's folder, is refused until somebody fixes the file
    const name = sessionName()
    const desks = join(root, 'desks') + sep
    const claims = /^desk-/.test(name) || places.some((c) => (resolve(c) + sep).startsWith(desks))
    return claims ? { code: 2, why: `⛔ desk wall: ${error}. A desk session is refused until it is fixed; a developer session at the repo root can fix it.` } : { code: 0 }
  }
  if (!cfg.wall || typeof cfg.wall !== 'object') return { code: 0 }
  if (unreadable) return { code: 2, why: '⛔ desk wall: the hook could not read its payload, so nothing it asked for is allowed' }
  const failClosed = cfg.wall.failClosed !== false
  let who = null, mod = null, session = ''
  try {
    try {
      mod = officeModule(root, cfg)
      // role variable, then session name, then each folder the session is known by.
      // A name only the office understands is first mapped by its module.
      let name = sessionName()
      session = name
      const mapped = name && !/^desk-/.test(name) && mod ? await mod.call('alias', name, { root }) : null
      if (typeof mapped === 'string' && mapped) name = mapped
      for (const cwd of places) { who = whoIs(root, cfg, { cwd, env, name }); if (who) break }
    } catch (e) {
      // without the module the wall cannot tell who an aliased name is: a
      // session that claims a desk by name or folder is refused
      const desks = join(root, 'desks') + sep
      const claims = /^desk-/.test(session) || places.some((c) => (resolve(c) + sep).startsWith(desks)) || (session && !who)
      return failClosed && claims ? { code: 2, why: '⛔ desk wall: the wall could not tell who this session is (' + e.message + '), and this office\'s wall fails closed' } : { code: 0 }
    }
    if (!who) return { code: 0 }                             // a developer session: not ours to judge
    const W0 = cfg.wall.footer ?? {}
    const label = who.kind === 'lead' ? 'the lead' : who.kind === 'desk' ? 'desk ' + who.desk : who.role
    const foot = who.kind === 'lead' ? W0.lead : W0.desk
    const say = (why) => ({ code: 2, why: `⛔ desk wall (${label}): ${why}` + (foot ? '\n' + foot : '') })
    if (who.kind === 'unknown') return say(`this session calls itself ${who.role}, and this office has no such desk`)
    try {
      const to = String(p?.tool_input?.to ?? '').replace(/\s*\[[^\]]*\]\s*$/, '').trim()
      const aliasTo = p?.tool_name === 'SendMessage' && mod ? ((await mod.call('alias', to, { root })) || null) : null
      const W = compileWall({ ...cfg.wall, roleEnv: cfg.roleEnv, leadSession: cfg.lead?.session, leadAliases: cfg.lead?.aliases })
      const why = judge(p, who, root, W, { aliasTo }) ?? (mod ? await mod.call('judge', p, who, { root, cfg, session }) : null)
      return why ? say(why) : { code: 0 }
    } catch (e) { return failClosed ? say('the wall broke while judging (' + e.message + '), and this office\'s wall fails closed') : { code: 0 } }
  } finally { mod?.close() }
}

if (isMain(import.meta.url)) {
  // a crash anywhere below: refused in an office whose wall fails closed (the
  // default once it has a wall) or whose config is broken; let through elsewhere
  const crashed = () => {
    let closed = false
    try {
      const { root } = locate(null)
      if (root) { const { cfg, error } = readOfficeConfigStrict(root); closed = !!error || (!!cfg.wall && cfg.wall.failClosed !== false) }
    } catch {}
    process.exit(closed ? 2 : 0)
  }
  process.on('uncaughtException', crashed)
  const chunks = []
  process.stdin.on('data', (c) => chunks.push(c))
  process.stdin.on('end', () => {
    decide(Buffer.concat(chunks).toString()).then((r) => {
      if (r.why) console.error(r.why)
      process.exit(r.code)
    }, crashed)
  })
}
