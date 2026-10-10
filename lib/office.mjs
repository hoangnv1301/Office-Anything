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

export function readOfficeConfig(root) {
  try {
    const c = JSON.parse(readFileSync(join(root, 'office.json'), 'utf8'))
    return c && typeof c === 'object' && !Array.isArray(c) ? c : {}
  } catch { return {} }
}

// the nearest folder at or above `from` holding an office.json beside a desks/
export function findOffice(from) {
  let d = resolve(from || '.')
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(d, 'office.json')) && existsSync(join(d, 'desks'))) return d
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
  const lead = typeof cfg?.lead?.session === 'string' ? cfg.lead.session : null
  const role = (roleEnv && env[roleEnv]) || (name ?? sessionName())
  const aliases = Array.isArray(cfg?.lead?.aliases) ? cfg.lead.aliases.filter((a) => typeof a === 'string' && a) : []
  if (lead && (role === lead || aliases.includes(role))) return { kind: 'lead', role }
  if (/^desk-/.test(role)) {
    const desk = role.slice(5)
    // a CHILD session of a desk (desk-<parent>--<key>, one per case) is that
    // desk: same folder, same wall. Only a desk declaring perCase takes the
    // suffix, and only for a key its regex matches in full.
    if (desk.includes('--')) {
      const c = childOf(root, role)
      return c ? { kind: 'desk', desk: c.parent, dir: c.dir, role, caseKey: c.key } : { kind: 'unknown', role }
    }
    if (desk === 'lead') return { kind: 'lead', role }
    const dir = join(root, 'desks', desk)
    if (!existsSync(join(dir, 'desk.json'))) return { kind: 'unknown', role }
    return deskKind(dir) === 'lead' ? { kind: 'lead', role } : { kind: 'desk', desk, dir, role }
  }
  const desksDir = join(root, 'desks') + sep
  const at = resolve(cwd || '.') + sep
  if (at.startsWith(desksDir)) {
    const desk = at.slice(desksDir.length).split(sep)[0]
    if (!desk) return null
    const dir = join(root, 'desks', desk)
    if (desk === 'lead' || deskKind(dir) === 'lead') return { kind: 'lead', role: role || 'desk-' + desk }
    return { kind: 'desk', desk, dir, role: role || 'desk-' + desk }
  }
  return null
}

function deskKind(dir) {
  try { return JSON.parse(readFileSync(join(dir, 'desk.json'), 'utf8')).kind ?? null } catch { return null }
}

// desk-<parent>--<key> -> { parent, key, dir } when <parent> is a desk whose
// desk.json declares perCase.key and <key> matches it in full; null otherwise.
// A key may never carry another "--", a path separator or whitespace, so a
// child name can neither nest nor walk out of the desks folder.
export function childOf(root, name) {
  const m = /^desk-([a-z][a-z0-9-]*?)--(.+)$/.exec(String(name ?? ''))
  if (!m) return null
  const [, parent, key] = m
  if (/--|[\\/\s]/.test(key) || parent.includes('--')) return null
  const dir = join(root, 'desks', parent)
  let pc
  try { pc = JSON.parse(readFileSync(join(dir, 'desk.json'), 'utf8')).perCase } catch { return null }
  if (!pc || typeof pc.key !== 'string') return null
  let re
  try { re = new RegExp('^(?:' + pc.key + ')$') } catch { return null }
  return re.test(key) ? { parent, key, dir } : null
}
