// THE OFFICE A SESSION IS IN, AND WHO THE SESSION IS IN IT.
//
// One owner for three questions every desk-side hook asks first: where is the
// office root, what does its office.json say, and is this session the lead, a
// desk, or neither (a developer working on the repo).
//
// ⛔ IDENTITY FOLLOWS THE SESSION, NOT THE DIRECTORY. A desk restored with
// `claude --resume` from the repo root (a terminal app reopening tabs) lost
// both its `cd desks/<name>` and its role variable; going by the folder, every
// rule let it through. The session's NAME survives a resume, so after the
// declared role variable it is the next witness, and the folder is the last.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { rosterSafe, deskOfSession, officeRoster, deskDir, deskAt, hasDesks, deskShaped, sessionOf } from './desk.mjs'
import { allLeads } from './departments.mjs'

export function readOfficeConfig(root) {
  try {
    const c = JSON.parse(readFileSync(join(root, 'office.json'), 'utf8'))
    return c && typeof c === 'object' && !Array.isArray(c) ? c : {}
  } catch { return {} }
}

// { cfg, error }: error says what is wrong with an office.json that exists but
// cannot be used. The lenient reader above turns that into {}, and for the
// desk wall {} means "no wall": a broken file must not read as an open door.
export function readOfficeConfigStrict(root) {
  let text
  try { text = readFileSync(join(root, 'office.json'), 'utf8') } catch (e) { return { cfg: {}, error: e.code === 'ENOENT' ? null : `office.json cannot be read (${e.code ?? e.message})` } }
  try {
    const c = JSON.parse(text)
    if (!c || typeof c !== 'object' || Array.isArray(c)) return { cfg: {}, error: 'office.json is not a JSON object' }
    return { cfg: c, error: null }
  } catch (e) { return { cfg: {}, error: `office.json is not valid JSON (${e.message})` } }
}

// the nearest folder at or above `from` holding an office.json beside its desks
// (desks/, or a department's folder: lib/desk.mjs hasDesks)
export function findOffice(from) {
  let d = resolve(from || '.')
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(d, 'office.json')) && hasDesks(d)) return d
    const up = dirname(d)
    if (up === d) break
    d = up
  }
  return null
}

// This session's name, from the CLI's own registry: a hook is a descendant of
// the claude process, so the first ancestor with ~/.claude/sessions/<pid>.json
// is the session. '' when there is none (not under claude, ps unavailable).
export function sessionName({ configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), pid = process.ppid, parentOf } = {}) {
  const dir = join(configDir, 'sessions')
  const up = parentOf ?? ((p) => Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(p)], { encoding: 'utf8' }).trim()))
  for (let i = 0; i < 8 && pid > 1; i++) {
    try { return String(JSON.parse(readFileSync(join(dir, `${pid}.json`), 'utf8')).name ?? '') } catch {}
    try { pid = up(pid) } catch { return '' }
  }
  return ''
}

// { kind: 'lead' } | { kind: 'desk', desk, dir } | { kind: 'unknown', role } | null
//   role: the declared role (office.json roleEnv, e.g. "desk-pricing" or the
//   lead's session name), or the session name when none is declared.
//   'unknown' = it CLAIMS a desk this office does not have: never treated as a
//   developer session, because that is the shape of a wall being walked around.
export function whoIs(root, cfg, { cwd, env = process.env, name = null } = {}) {
  const roleEnv = typeof cfg?.roleEnv === 'string' ? cfg.roleEnv : null
  const role = (roleEnv && env[roleEnv]) || (name ?? sessionName())
  // every lead the office declares (lib/departments.mjs allLeads): one, or
  // one per department; identity does not depend on which machine this is
  const L = allLeads(cfg).find((l) => l.names.includes(role))
  if (L) return { kind: 'lead', role, ...(L.department ? { department: L.department } : {}) }
  // desk-<x>, or a department's <prefix>-<x> (lib/desk.mjs deskShaped): it
  // claims a desk, and is one only when deskOfSession finds it exactly
  if (deskShaped(root, role)) {
    // a CHILD session of a desk (<session>--<key>, one per case) is that
    // desk: same folder, same wall. Only a desk declaring perCase takes the
    // suffix, and only for a key its regex matches in full.
    if (role.includes('--')) {
      const c = childOf(root, role)
      return c ? { kind: 'desk', desk: c.parent, dir: c.dir, role, caseKey: c.key } : { kind: 'unknown', role }
    }
    if (role === 'desk-lead') return { kind: 'lead', role }
    // desk-<name>: the desk whose desk.json "name" it is (or whose id, for a
    // session started before a rename). who.desk is always the id, the folder.
    const hit = deskOfSession(officeRoster(root).desks, role)
    if (!hit) return { kind: 'unknown', role }
    const dir = deskDir(root, hit.desk.name)
    return hit.desk.kind === 'lead' ? { kind: 'lead', role } : { kind: 'desk', desk: hit.desk.name, dir, role, ...(hit.stale ? { stale: true } : {}) }
  }
  // standing in a desk's folder: desks/<id>, or a department's desk (lib/desk.mjs deskAt)
  const here = deskAt(root, cwd || '.')
  if (here) {
    const desk = here.id
    const dir = here.dir
    if (desk === 'lead' || deskKind(dir) === 'lead') return { kind: 'lead', role: role || sessionOf(root, desk) }
    return { kind: 'desk', desk, dir, role: role || sessionOf(root, desk) }
  }
  return null
}

function deskKind(dir) {
  try { return JSON.parse(readFileSync(join(dir, 'desk.json'), 'utf8')).kind ?? null } catch { return null }
}

// <session>--<key> -> { parent, key, dir } when <session> is a desk's (or one
// of its old names: a case opened before a rename) whose desk.json declares
// perCase.key and <key> matches it in full; null otherwise. parent is the id.
// A key may never carry another "--", a path separator or whitespace, so a
// child name can neither nest nor walk out of the desks folder.
export function childOf(root, name) {
  const hit = deskOfSession(officeRoster(root).desks, name)
  if (!hit?.key) return null
  const key = hit.key
  if (/--|[\\/\s]/.test(key)) return null
  const parent = hit.desk.name
  const dir = deskDir(root, parent)
  const pc = hit.desk.perCase
  if (!pc || typeof pc.key !== 'string') return null
  let re
  try { re = new RegExp('^(?:' + pc.key + ')$') } catch { return null }
  return re.test(key) ? { parent, key, dir } : null
}
