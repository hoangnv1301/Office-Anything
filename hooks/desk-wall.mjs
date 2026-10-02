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
import { readOfficeConfig, findOffice, whoIs } from '../lib/office.mjs'
import { compileWall, judge } from '../lib/wall.mjs'
import { isMain } from '../lib/is-main.mjs'

if (isMain(import.meta.url)) {
  const chunks = []
  process.stdin.on('data', (c) => chunks.push(c))
  process.stdin.on('end', () => {
    const raw = Buffer.concat(chunks).toString()
    let p = null
    try { p = JSON.parse(raw || '{}') } catch {}
    const root = findOffice(p?.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd())
    if (!root) process.exit(0)
    const cfg = readOfficeConfig(root)
    if (!cfg.wall || typeof cfg.wall !== 'object') process.exit(0)
    const failClosed = cfg.wall.failClosed === true
    let who
    try {
      who = whoIs(root, cfg, { cwd: p?.cwd || process.env.CLAUDE_PROJECT_DIR })
    } catch { process.exit(failClosed ? 2 : 0) }
    if (!who) process.exit(0)                               // a developer session: not ours to judge
    const say = (why) => {
      const W0 = cfg.wall.footer ?? {}
      const label = who.kind === 'lead' ? 'the lead' : who.kind === 'desk' ? 'desk ' + who.desk : who.role
      console.error(`⛔ desk wall (${label}): ${why}` + ((who.kind === 'lead' ? W0.lead : W0.desk) ? '\n' + (who.kind === 'lead' ? W0.lead : W0.desk) : ''))
      process.exit(2)
    }
    if (who.kind === 'unknown') say(`this session calls itself ${who.role}, and this office has no such desk`)
    if (!p) { if (failClosed) say('the hook could not read its payload, and this office\'s wall fails closed'); process.exit(0) }
    let W
    try { W = compileWall({ ...cfg.wall, roleEnv: cfg.roleEnv }) } catch (e) { if (failClosed) say('a rule in office.json does not compile (' + e.message + '), and this office\'s wall fails closed'); process.exit(0) }
    const why = judge(p, who, root, W)
    if (why) say(why)
    process.exit(0)
  })
}
