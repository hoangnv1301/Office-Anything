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
import { readOfficeConfig, findOffice, whoIs, sessionName } from '../lib/office.mjs'
import { compileWall, judge } from '../lib/wall.mjs'
import { isMain } from '../lib/is-main.mjs'
import { resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'

// The office's own rules, in its own file: office.json "wall.module" names an
// ES module inside the office exporting judge(payload, who, { root, cfg, session }) ->
// reason | null, and/or alias(name, { root }) -> a canonical session name
// (desk-<x> or desk-<x>--<key>) for a name only the office understands.
// It runs AFTER the plugin's rules: it can refuse more, never allow more.
export async function officeModule(root, cfg) {
  const rel = cfg?.wall?.module
  if (typeof rel !== 'string' || !rel) return null
  const f = resolve(root, rel)
  if (!(f + sep).startsWith(root + sep) || !existsSync(f)) throw new Error(`wall.module ${rel} is not a file inside the office`)
  return import(pathToFileURL(f).href)
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

export async function decide(raw, env = process.env, here = process.cwd()) {
  let p = null
  try { p = JSON.parse(raw || '{}') } catch {}
  const { root, places } = locate(p, env, here)
  if (!root) return { code: 0 }
  const cfg = readOfficeConfig(root)
  if (!cfg.wall || typeof cfg.wall !== 'object') return { code: 0 }
  const failClosed = cfg.wall.failClosed === true
  let who = null, mod = null, session = ''
  try {
    mod = await officeModule(root, cfg)
    // role variable, then session name, then each folder the session is known by.
    // A name only the office understands is first mapped by its module.
    let name = sessionName()
    session = name
    const mapped = name && !/^desk-/.test(name) && typeof mod?.alias === 'function' ? mod.alias(name, { root }) : null
    if (typeof mapped === 'string' && mapped) name = mapped
    for (const cwd of places) { who = whoIs(root, cfg, { cwd, env, name }); if (who) break }
  } catch (e) { return failClosed ? { code: 2, why: 'the wall could not tell who this session is (' + e.message + '), and this office\'s wall fails closed' } : { code: 0 } }
  if (!who) return { code: 0 }                               // a developer session: not ours to judge
  const W0 = cfg.wall.footer ?? {}
  const label = who.kind === 'lead' ? 'the lead' : who.kind === 'desk' ? 'desk ' + who.desk : who.role
  const foot = who.kind === 'lead' ? W0.lead : W0.desk
  const say = (why) => ({ code: 2, why: `⛔ desk wall (${label}): ${why}` + (foot ? '\n' + foot : '') })
  if (who.kind === 'unknown') return say(`this session calls itself ${who.role}, and this office has no such desk`)
  if (!p) return failClosed ? say('the hook could not read its payload, and this office\'s wall fails closed') : { code: 0 }
  try {
    const to = String(p?.tool_input?.to ?? '').replace(/\s*\[[^\]]*\]\s*$/, '').trim()
    const aliasTo = p?.tool_name === 'SendMessage' && typeof mod?.alias === 'function' ? (mod.alias(to, { root }) || null) : null
    const W = compileWall({ ...cfg.wall, roleEnv: cfg.roleEnv, leadSession: cfg.lead?.session, leadAliases: cfg.lead?.aliases })
    const why = judge(p, who, root, W, { aliasTo }) ?? (typeof mod?.judge === 'function' ? mod.judge(p, who, { root, cfg, session }) : null)
    return why ? say(why) : { code: 0 }
  } catch (e) { return failClosed ? say('the wall broke while judging (' + e.message + '), and this office\'s wall fails closed') : { code: 0 } }
}

if (isMain(import.meta.url)) {
  // a crash anywhere below is the wall's `|| exit 2`: refused when the office
  // asked to fail closed, let through otherwise (this plugin's default)
  const crashed = () => {
    let closed = false
    try {
      const { root } = locate(null)
      closed = !!root && readOfficeConfig(root).wall?.failClosed === true
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
