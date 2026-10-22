// THE CONTRACT. Everything else in this repo reads it and nothing derives around it.
//
// A desk is a folder with a desk.json. That file is the ONLY place a desk's name,
// kind, port and live status are stated.
//
// ⛔ ID AND NAME ARE TWO THINGS (0.11.0). The id is the folder, desks/<id>/, and
// it never changes: every key the plugin stores (office.json closeWhenIdle,
// .office/local.json, case claims, idle and heal state) and the desk's own
// conversation (keyed by its folder) hang off it. The name is desk.json "name",
// the session name desk-<name>, and the ONE field a rename edits. Before this, a
// rename meant ten minutes and "a ton of testing" and still did not work,
// because the name had been copied into every one of those places.
//
//   d.name     the id (the folder). Kept under this field so every key site reads it
//   d.title    desk.json "name"
//   d.session  "desk-" + d.title, what the desk's session is called
//
// ⛔ PORTS ARE DECLARED, NEVER DERIVED. The system this came from allocated them by
// position in a sorted list:
//
//     const i = [...names].sort().indexOf(desk)
//     const port = BASE_PORT + i
//
// So hiring a desk called "billing" silently renumbered every desk sorting after it,
// and firing one did the same in reverse. Four separate incidents. A declared port
// cannot do that, and two desks claiming one port is a test failure naming both.
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

// liaison (2026-10-10): talks to the TEAM on a channel (coworkers, partners),
// never to customers. It sends under the same rule as a channel desk.
export const KINDS = ['channel', 'knowledge', 'lead', 'liaison']

// ⛔ 40 IS NOT ARBITRARY. A desk name goes into a directory path, a port map, a docs table
// and a test name. Stated once: hire and rename both ask it.
export const DESK_NAME = /^[a-z][a-z0-9-]{0,39}$/

// ⛔ WHAT EACH KIND MAY HOLD. This is the send wall, applied at HIRE time rather than
// only at test time. A knowledge desk holds price lists and rate cards; if it is never
// ISSUED a sender it cannot grow a path to a buyer by accident.
export const ISSUE = {
  channel:   { browser: true,  reader: true,  voiceGate: true,  sender: 'only when live', graph: false },
  knowledge: { browser: false, reader: false, voiceGate: false, sender: false,            graph: false },
  lead:      { browser: true,  reader: false, voiceGate: false, sender: false,            graph: true  },
  liaison:   { browser: false, reader: true,  voiceGate: true,  sender: 'only when live', graph: false },
}

export function readDesk(dir) {
  const f = join(dir, 'desk.json')
  if (!existsSync(f)) return null
  let d
  try { d = JSON.parse(readFileSync(f, 'utf8')) }
  catch (e) { throw new Error(`${f} is not valid JSON: ${e.message}`) }

  // A malformed desk.json is a HARD error, never a skipped desk. A desk that silently
  // fails to load is a desk every check reports clean on.
  for (const k of ['name', 'kind', 'port']) {
    if (d[k] === undefined) throw new Error(`${f} has no "${k}"`)
  }
  if (!KINDS.includes(d.kind)) throw new Error(`${f}: kind "${d.kind}" is not one of ${KINDS.join(', ')}`)
  if (!Number.isInteger(d.port)) throw new Error(`${f}: port must be an integer`)
  // ⛔ ONE STATEMENT OF THE ID. The folder and a file once disagreed about the
  // name and every reader picked a different one; now the folder IS the id, and
  // a desk.json "id" (optional) must say the same thing or the desk is broken.
  const folder = dir.split(/[\\/]/).filter(Boolean).pop()
  if (d.id !== undefined && d.id !== folder) {
    throw new Error(`${f}: "id" says "${d.id}" but sits in a folder called "${folder}"; the id is the folder and never changes`)
  }
  if (typeof d.name !== 'string' || !DESK_NAME.test(d.name)) throw new Error(`${f}: name "${String(d.name).slice(0, 44)}" is not a desk name (lowercase letters, digits and hyphens, starting with a letter, 40 at most)`)
  d.title = d.name
  d.session = 'desk-' + d.title
  d.name = folder ?? d.name
  d.id = d.name
  d.live = d.live === true
  d.dir = dir
  return d
}

export function roster(desksDir) {
  const { desks, broken } = rosterSafe(desksDir)
  if (broken.length) throw new Error(broken[0].why)
  return desks
}

// ⛔ ONE BROKEN desk.json MUST NOT BLIND EVERY CHECK. Before this existed, a single file
// with a port written as a string made all three checks report UNKNOWN, and six healthy
// desks went unexamined because of one typo in a seventh.
//
// A malformed desk is still a HARD finding, named and loud. It is just not a reason to stop
// looking at everything else.
export function rosterSafe(desksDir, { holdsOthers = false } = {}) {
  if (!existsSync(desksDir)) return { desks: [], broken: [] }
  const desks = [], broken = []
  for (const e of readdirSync(desksDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    // a department's folder holds its own files beside its desks: only a
    // folder with a desk.json is a desk there, and a dot-folder never is
    if (holdsOthers && e.name.startsWith('.')) continue
    try {
      const d = readDesk(join(desksDir, e.name))
      if (d) desks.push(d)
    } catch (err) {
      broken.push({ desk: e.name, why: err.message })
    }
  }
  desks.sort((a, b) => a.name.localeCompare(b.name))
  // ⛔ desk-<x> MUST NAME ONE FOLDER. A name equal to another desk's id or name
  // makes a session (and a message to it) belong to two desks. Both are broken,
  // so neither is quietly the one a message reaches.
  const clash = new Set()
  for (const a of desks) for (const b of desks) if (a !== b && (a.title === b.title || a.title === b.name)) { clash.add(a); clash.add(b) }
  for (const d of clash) {
    const why = desks.filter((o) => o !== d).flatMap((o) => [
      ...(o.title === d.title ? [`its name "${d.title}" is also desks/${o.name}'s name`] : []),
      ...(o.name === d.title ? [`its name "${d.title}" is desks/${o.name}'s id`] : []),
      ...(o.title === d.name ? [`desks/${o.name} took its id "${d.name}" as a name`] : []),
    ])
    broken.push({ desk: d.name, why: `desks/${d.name}/desk.json: ${why.join('; ')}: one session name would belong to two desks` })
  }
  return { desks: desks.filter((d) => !clash.has(d)), broken }
}

// ── WHERE DESKS LIVE (0.16.0) ───────────────────────────────────────────────
// desks/<id>/ as always, and departments/<dept>/<id>/ once an office moves a
// department's desks into its own folder (office.json departments.<id>.dir,
// default departments/<id>). ⛔ ONE OWNER: every path to a desk is d.dir from
// officeRoster, or deskDir(root, id); a hand-built join(root, 'desks', id) is
// wrong for every moved desk and passes every test that has none
// (tests/department-folders.test.mjs walks the code for them).
const DEPT_ID = /^[a-z][a-z0-9-]{0,39}$/
// office.json read here, not through office.mjs (which reads desks): only "departments"
function departmentDirs(root) {
  let raw
  try { raw = JSON.parse(readFileSync(join(root, 'office.json'), 'utf8'))?.departments } catch { return [] }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  const out = []
  for (const [id, d] of Object.entries(raw)) {
    if (id.startsWith('_') || !d || typeof d !== 'object' || Array.isArray(d) || typeof d.lead !== 'string' || !d.lead.trim()) continue
    const want = typeof d.dir === 'string' && d.dir.trim() ? d.dir.trim() : DEPT_ID.test(id) ? `departments/${id}` : null
    if (!want) continue
    const abs = resolve(root, want)
    // inside the office, below it, and not desks/ itself: anything else holds no desks
    if (!(abs + sep).startsWith(resolve(root) + sep) || abs === resolve(root) || abs === resolve(root, 'desks')) continue
    out.push({ department: id, dir: abs })
  }
  return out
}

// every folder that holds desks: desks/ first, then each department's, declared
// or not yet created (the wall guards a folder before anything moves into it)
export const deskRoots = (root) => [{ department: null, dir: join(root, 'desks') }, ...departmentDirs(root)]

// does this office have any desk folder at all
// ⛔ a departments/ folder counts even when office.json cannot be read to name
// its departments: an office whose config broke is still an office (the wall
// fails closed there; finding no office would wave everything through)
export const hasDesks = (root) => deskRoots(root).some((r) => existsSync(r.dir)) || existsSync(join(root, 'departments'))

// ⛔ ONE ID, ONE FOLDER. Mid-move a desk can sit in desks/x AND departments/aics/x;
// neither is quietly the real one: both are broken until one is gone.
export function officeRoster(root) {
  const desks = [], broken = []
  for (const r of deskRoots(root)) {
    const got = rosterSafe(r.dir, { holdsOthers: r.department != null })
    for (const d of got.desks) desks.push(Object.assign(d, { department: r.department }))
    broken.push(...got.broken.map((b) => ({ ...b, dir: join(r.dir, b.desk) })))
  }
  const seen = new Map()
  for (const d of desks) seen.set(d.name, [...(seen.get(d.name) ?? []), d])
  const twice = new Set([...seen].filter(([, l]) => l.length > 1).map(([k]) => k))
  for (const k of twice) broken.push({ desk: k, why: `desk ${k} is in two folders (${seen.get(k).map((d) => d.dir.slice(resolve(root).length + 1)).join(' and ')}): one id, one folder; remove the copy that is not the desk` })
  const ok = desks.filter((d) => !twice.has(d.name)).sort((a, b) => a.name.localeCompare(b.name))
  // a name clash across folders is the same fault as within one
  const clash = new Set()
  for (const a of ok) for (const b of ok) if (a !== b && a.department !== b.department && (a.title === b.title || a.title === b.name)) { clash.add(a); clash.add(b) }
  for (const d of clash) broken.push({ desk: d.name, why: `${d.dir.slice(resolve(root).length + 1)}/desk.json: its name "${d.title}" is also another desk's name or id: one session name would belong to two desks` })
  return { desks: ok.filter((d) => !clash.has(d)), broken }
}

// a desk's folder by id: where it is, else desks/<id> (where a new one goes)
export function deskDir(root, id) {
  for (const r of deskRoots(root)) { const d = join(r.dir, String(id)); if (existsSync(join(d, 'desk.json'))) return d }
  return join(root, 'desks', String(id))
}

// where a desk sat before its department's folder: its conversation is keyed by it
export const desksFolderOf = (root, id) => join(root, 'desks', String(id))

// the desk folder a path is in -> { id, dir, department } | null. Under desks/,
// any folder is a desk's (as before). Under a department's folder only one
// holding a desk.json is: the rest of it is the department's own.
export function deskAt(root, path) {
  const at = resolve(path) + sep
  for (const r of deskRoots(root)) {
    const base = resolve(r.dir) + sep
    if (!at.startsWith(base)) continue
    const id = at.slice(base.length).split(sep)[0]
    if (!id) return null
    const dir = join(r.dir, id)
    if (r.department != null && !existsSync(join(dir, 'desk.json'))) return null
    return { id, dir, department: r.department }
  }
  return null
}

// desk-<x> or desk-<x>--<key> -> { desk, key, stale } | null. By name first;
// then by id, which is the session of a desk renamed while it ran ("stale":
// it started under its old name and keeps it until it restarts).
export function deskOfSession(desks, session) {
  const m = /^desk-([a-z][a-z0-9-]*?)(?:--(.+))?$/.exec(String(session ?? ''))
  if (!m) return null
  const byTitle = desks.find((d) => d.title === m[1])
  const d = byTitle ?? desks.find((x) => x.name === m[1])
  return d ? { desk: d, key: m[2] ?? null, stale: !byTitle } : null
}

// the names a desk's own conversation may have been started under: its name
// now, or its id (its name before it was first renamed). Nothing wider: a
// conversation started under any other name is not resumed as this desk's.
export const ownNames = (desk) => (n) => n === desk.session || n === 'desk-' + desk.name

// the session name of a desk by id, read from its desk.json now (never a copy)
// (sessionOf(root, id); an older caller's root/desks still works)
export function sessionOf(rootOrDesks, id) {
  const root = /[\\/]desks[\\/]?$/.test(String(rootOrDesks)) ? resolve(rootOrDesks, '..') : rootOrDesks
  try { const t = JSON.parse(readFileSync(join(deskDir(root, id), 'desk.json'), 'utf8')).name; if (typeof t === 'string' && DESK_NAME.test(t)) return 'desk-' + t } catch {}
  return 'desk-' + id
}

// ⛔ NAMED, so a caller cannot mistake "no collisions" for "no desks". An empty roster
// has no collisions and is not a clean bill of health.
export function portCollisions(desks) {
  const seen = new Map()
  const clashes = []
  for (const d of desks) {
    if (seen.has(d.port)) clashes.push({ port: d.port, desks: [seen.get(d.port), d.name] })
    else seen.set(d.port, d.name)
  }
  return clashes
}

// The lowest port not already claimed. Used by `hire` to suggest one; the value is
// then WRITTEN DOWN, so it never moves again.
export function nextFreePort(desks, base = 9223, reserved = []) {
  const taken = new Set([...desks.map(d => d.port), ...reserved])
  let p = base
  while (taken.has(p)) p++
  return p
}

export const mayHold = (kind, thing) => ISSUE[kind]?.[thing] ?? false

// ⛔ THE LEAD LIVES AT THE ROOT, and for months that meant it lived outside
// every check: readDesk requires folder-name agreement and roster() walks
// desks/, so a lead whose desk IS the repo root had no place to declare its
// port. The board could not even mirror the lead's own browser. A root
// desk.json with kind "lead" is that place. The folder-name rule is waived
// here alone, because a repo's directory name is not a desk name; every
// other rule (port an integer, kind valid) still binds.
export function leadDesk(root) {
  const f = join(root, 'desk.json')
  if (!existsSync(f)) return null
  let d
  try { d = JSON.parse(readFileSync(f, 'utf8')) } catch (e) { throw new Error(`${f} is not valid JSON: ${e.message}`) }
  if (d.kind !== 'lead') throw new Error(`${f}: a root desk.json must be kind "lead", got "${d.kind}"`)
  for (const k of ['name', 'port']) if (d[k] === undefined) throw new Error(`${f} has no "${k}"`)
  if (!Number.isInteger(d.port)) throw new Error(`${f}: port must be an integer`)
  d.live = d.live === true
  d.dir = root
  return d
}
