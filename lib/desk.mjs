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
//   d.session  <prefix>-<title>, what the desk's session is called: its
//              department's "prefix" (aics-, erp-), else desk-
//   d.names    every name the desk answers to: d.session first, then the names
//              it had before (desk-<title>, <prefix>-<id>, desk-<id>, and each
//              desk.json "formerly" id under both prefixes)
//
// ⛔ ONE OWNER FOR NAME -> DESK (0.20.0). A session name is turned into a desk
// only by deskOfSession, which matches d.session or d.names EXACTLY, never by
// the shape of the name; tests/session-names.test.mjs walks the code for a
// hand-built "desk-" + x. The owner, 2026-10-23: sessions carry their
// department (aics-web-design, erp-inventory), and four AICS desks were
// renamed, folders included.
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
import { readdirSync, readFileSync, existsSync, realpathSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

// liaison (2026-10-10): talks to the TEAM on a channel (coworkers, partners),
// never to customers. It sends under the same rule as a channel desk.
export const KINDS = ['channel', 'knowledge', 'lead', 'liaison']

// ⛔ 40 IS NOT ARBITRARY. A desk name goes into a directory path, a port map, a docs table
// and a test name. Stated once: hire and rename both ask it.
// ⛔ NO "--" IN IT (0.20.0): <session>--<case key> is a case session, so a desk
// called a--b would be desk a's case b
export const DESK_NAME = /^(?!.*--)[a-z][a-z0-9-]{0,39}$/
// a department's session prefix (office.json departments.<id>.prefix)
export const PREFIX = /^[a-z][a-z0-9]{0,15}$/
export const RESERVED_PREFIXES = ['desk', 'cs', 'lead']

// every name a desk answers to, its session first (see the header)
export function namesOf(d, prefix = 'desk') {
  const p = prefix || 'desk'
  const was = Array.isArray(d.formerly) ? d.formerly : []
  return [...new Set([`${p}-${d.title}`, `${p}-${d.name}`, `desk-${d.title}`, `desk-${d.name}`, ...was.flatMap((f) => [`${p}-${f}`, `desk-${f}`])])]
}
const setNames = (d, prefix) => { d.prefix = prefix || 'desk'; d.names = namesOf(d, d.prefix); d.session = d.names[0]; return d }

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
  if (typeof d.name !== 'string' || !DESK_NAME.test(d.name)) throw new Error(`${f}: name "${String(d.name).slice(0, 44)}" is not a desk name (lowercase letters, digits and single hyphens, starting with a letter, 40 at most)`)
  if (folder && /--/.test(folder)) throw new Error(`${f}: its folder "${folder}" holds "--", which is how a case session is named: rename the folder`)
  // ⛔ "formerly": the ids it had before its folder was renamed (0.20.0). Its old
  // sessions and its conversation are still its own; nothing wider than this list
  if (d.formerly !== undefined && (!Array.isArray(d.formerly) || d.formerly.length > 10 || d.formerly.some((x) => typeof x !== 'string' || !DESK_NAME.test(x) || x === folder))) {
    throw new Error(`${f}: "formerly" must list at most 10 old ids (desk names, not this folder's)`)
  }
  d.title = d.name
  d.name = folder ?? d.name
  d.id = d.name
  setNames(d, 'desk')
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
  const clash = nameClashes(desks)
  for (const [d, why] of clash) broken.push({ desk: d.name, why: `desks/${d.name}/desk.json: ${why}: one session name would belong to two desks` })
  return { desks: desks.filter((d) => !clash.has(d)), broken }
}

// ⛔ A SESSION NAME MUST NAME ONE FOLDER. A name one desk answers to (its
// session, an old name, a "formerly" id) that another desk answers to too makes
// a session, and a message to it, belong to two desks. Both are broken, so
// neither is quietly the one a message reaches. -> Map(desk -> why)
function nameClashes(desks) {
  const out = new Map()
  for (const a of desks) for (const b of desks) {
    if (a === b) continue
    const n = a.names.find((x) => b.names.includes(x))
    if (!n) continue
    const why = n === a.session && n === b.session ? `its session name ${n} is also ${b.name}'s`
      : a.title === b.title ? `its name "${a.title}" is also ${b.name}'s name`
      : a.title === b.name ? `its name "${a.title}" is ${b.name}'s id`
      : b.title === a.name ? `${b.name} took its id "${a.name}" as a name`
      : `it and ${b.name} both answer to ${n}`
    out.set(a, out.has(a) ? out.get(a) + '; ' + why : why)
  }
  return out
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
    out.push({ department: id, dir: abs, prefix: prefixOk(d.prefix) ? d.prefix : null })
  }
  // two departments claiming one prefix: neither has it (lib/departments.mjs says so)
  for (const r of out) if (r.prefix && out.filter((o) => o.prefix === r.prefix).length > 1) r.prefix = null
  return out
}
const prefixOk = (p) => typeof p === 'string' && PREFIX.test(p) && !RESERVED_PREFIXES.includes(p)

// every prefix a desk session of this office may start with: desk-, and each
// department's. A name of that shape claims a desk (the wall refuses one that
// resolves to none); it is never parsed by its shape (deskOfSession matches)
export const sessionPrefixes = (root) => ['desk', ...departmentDirs(root).map((r) => r.prefix).filter(Boolean)]
export const deskShaped = (root, name) => sessionPrefixes(root).some((p) => String(name ?? '').startsWith(p + '-'))
// the plugin's own desk-<x> shape, whatever the office's departments say
export const plainDeskShaped = (name) => String(name ?? '').startsWith('desk-')

// every folder that holds desks: desks/ first, then each department's, declared
// or not yet created (the wall guards a folder before anything moves into it)
export const deskRoots = (root) => [{ department: null, dir: join(root, 'desks'), prefix: null }, ...departmentDirs(root)]

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
    for (const d of got.desks) desks.push(setNames(Object.assign(d, { department: r.department }), r.prefix))
    broken.push(...got.broken.map((b) => ({ ...b, dir: join(r.dir, b.desk) })))
  }
  // ⛔ A SYMLINK IS NOT A SECOND DESK. A move leaves desks/x -> departments/aics/x
  // behind for a while (old paths keep working); both folders are one desk, and
  // the one it really lives in is it. Two REAL folders for one id stay broken.
  const real = (p) => { try { return realpathSync(p) } catch { return resolve(p) } }
  const one = []
  for (const d of desks) {
    const twin = one.find((o) => o.name === d.name && real(o.dir) === real(d.dir))
    if (!twin) { one.push(d); continue }
    if (d.department != null && twin.department == null) one.splice(one.indexOf(twin), 1, d)
  }
  desks.length = 0
  desks.push(...one)
  const seen = new Map()
  for (const d of desks) seen.set(d.name, [...(seen.get(d.name) ?? []), d])
  const twice = new Set([...seen].filter(([, l]) => l.length > 1).map(([k]) => k))
  for (const k of twice) broken.push({ desk: k, why: `desk ${k} is in two folders (${seen.get(k).map((d) => d.dir.slice(resolve(root).length + 1)).join(' and ')}): one id, one folder; remove the copy that is not the desk` })
  const ok = desks.filter((d) => !twice.has(d.name)).sort((a, b) => a.name.localeCompare(b.name))
  // a name clash across folders is the same fault as within one (and, with a
  // department's prefix, the names a folder could not see on its own)
  const clash = nameClashes(ok)
  for (const [d, why] of clash) if (!broken.some((b) => b.desk === d.name)) broken.push({ desk: d.name, why: `${d.dir.slice(resolve(root).length + 1)}/desk.json: ${why}: one session name would belong to two desks` })
  return { desks: ok.filter((d) => !clash.has(d)), broken }
}

// a desk's folder by id: where it is, else desks/<id> (where a new one goes)
export function deskDir(root, id) {
  // a department's folder first: after a move, desks/<id> may be a symlink to it
  const roots = deskRoots(root)
  for (const r of [...roots.slice(1), roots[0]]) { const d = join(r.dir, String(id)); if (existsSync(join(d, 'desk.json'))) return d }
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

// <session> or <session>--<key> -> { desk, key, stale } | null. The part
// before the first "--" must be EXACTLY a desk's session (stale: false) or one
// of the names it answered to before (stale: it started under an old name and
// keeps it until it restarts). Never by shape: aics-alibaba-<Buyer> is no desk.
export function deskOfSession(desks, session) {
  const s = String(session ?? '')
  const i = s.indexOf('--')
  const base = i < 0 ? s : s.slice(0, i), key = i < 0 ? null : s.slice(i + 2)
  if (!base || key === '') return null
  const now = desks.find((d) => d.session === base)
  const d = now ?? desks.find((x) => (x.names ?? [x.session]).includes(base))
  return d ? { desk: d, key, stale: !now } : null
}

// the names a desk's own conversation may have been started under: d.names.
// Nothing wider: a conversation started under any other name is not resumed
// as this desk's.
export const ownNames = (desk) => (n) => (desk.names ?? [desk.session]).includes(n)

// does a word (a task's "assigned", a tab title, a session name) mean this
// desk: its id, its desk.json name, or any name it answers to
export const answersTo = (desk, n) => !!n && (n === desk.name || n === desk.title || (desk.names ?? [desk.session]).includes(n))

// the session name of a desk by id, from its desk.json and its department now
// (never a copy). (sessionOf(root, id); an older caller's root/desks still works)
export function sessionOf(rootOrDesks, id) {
  const root = /[\\/]desks[\\/]?$/.test(String(rootOrDesks)) ? resolve(rootOrDesks, '..') : rootOrDesks
  const d = officeRoster(root).desks.find((x) => x.name === id)
  if (d) return d.session
  try { const t = JSON.parse(readFileSync(join(deskDir(root, id), 'desk.json'), 'utf8')).name; if (typeof t === 'string' && DESK_NAME.test(t)) return namesOf({ title: t, name: id }, prefixAt(root, id))[0] } catch {}
  return namesOf({ title: id, name: id }, prefixAt(root, id))[0]
}
// the prefix of the department folder a desk id sits in
const prefixAt = (root, id) => deskRoots(root).find((r) => existsSync(join(r.dir, String(id), 'desk.json')))?.prefix ?? 'desk'

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
