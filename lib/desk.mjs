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
import { join } from 'node:path'

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
export function rosterSafe(desksDir) {
  if (!existsSync(desksDir)) return { desks: [], broken: [] }
  const desks = [], broken = []
  for (const e of readdirSync(desksDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
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
export function sessionOf(desksDir, id) {
  try { const t = JSON.parse(readFileSync(join(desksDir, id, 'desk.json'), 'utf8')).name; if (typeof t === 'string' && DESK_NAME.test(t)) return 'desk-' + t } catch {}
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
