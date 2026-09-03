// THE CONTRACT. Everything else in this repo reads it and nothing derives around it.
//
// A desk is a folder with a desk.json. That file is the ONLY place a desk's name,
// kind, port and live status are stated.
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

export const KINDS = ['channel', 'knowledge', 'lead']

// ⛔ WHAT EACH KIND MAY HOLD. This is the send wall, applied at HIRE time rather than
// only at test time. A knowledge desk holds price lists and rate cards; if it is never
// ISSUED a sender it cannot grow a path to a buyer by accident.
export const ISSUE = {
  channel:   { browser: true,  reader: true,  voiceGate: true,  sender: 'only when live', graph: false },
  knowledge: { browser: false, reader: false, voiceGate: false, sender: false,            graph: false },
  lead:      { browser: true,  reader: false, voiceGate: false, sender: false,            graph: true  },
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
  // ⛔ THE FOLDER AND THE FILE MUST AGREE ON THE NAME. They are two statements of one fact,
  // and when they differ every downstream reader picks a different one: the port map keyed
  // by the file, the paths keyed by the folder.
  const folder = dir.split(/[\\/]/).filter(Boolean).pop()
  if (folder && d.name !== folder) {
    throw new Error(`${f}: says "${d.name}" but sits in a folder called "${folder}"`)
  }
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
  return { desks, broken }
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
