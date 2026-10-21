// DEPARTMENTS: ONE OFFICE, A LEAD PER DEPARTMENT (0.12.0).
//
// The owner, 2026-10-21: two people work Local Ops (design, orders, production)
// and never customer service; their work queued behind the buyers. So an office
// may declare departments, each with its own lead session and its own desks:
//
//   office.json
//   "departments": {
//     "local-ops":        { "lead": "ERP",  "desks": ["design-quotation", "inventory"] },
//     "customer-service": { "lead": "AICS", "aliases": ["lead"], "desks": ["customer"],
//                           "open": true, "services": ["onetalk-reader\\.mjs"] }
//   }
//   .office/local.json (this machine only, never committed)
//   { "departments": ["local-ops"], "sweeps": true }
//
// Per department (all but lead and desks optional):
//   lead          the lead's session name
//   aliases       other names it answers to
//   desks         desk ids (folders). A desk in no department is everyone's
//   instructions  a file the lead reads at boot (e.g. desks/leads/ERP.md)
//   wake          its doorbell (default office.json lead.wake)
//   start         how heal restarts it (default the plugin's own start)
//   open          true: office.json wall.lead.open applies to this lead
//   bash          its own wall.lead.bash list (default the office's)
//   sweepsLease   a read-only command: exit 0 this machine holds the sweeps
//                 lease, 3 another does (its first line names it), else UNKNOWN
//   services      regexes on a process command line: this department's
//                 background machinery (buyer readers, senders)
//
// ⛔ NO BLOCK, NOTHING CHANGES. An office without "departments" runs exactly as
// before: one lead (office.json lead.session), every desk everywhere.
// ⛔ TWO QUESTIONS, TWO RESOLVERS. "Is this session a lead" asks every lead the
// office declares (identity: the wall, whoIs, duplicates). "Which leads does
// this machine start, heal and watch" asks only the departments this machine
// runs (lifecycle). Asking the office-wide list there would start AICS on a
// Local Ops machine, and AICS runs on the owner's Mac only.
// ⛔ THE LOCAL FILE NEVER GRANTS. It names departments office.json declares;
// an unknown id is an error, never "all".
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DESK_NAME } from './desk.mjs'

const strs = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x) : [])
const ID = /^[a-z][a-z0-9-]{0,39}$/

// office.json "departments" -> { on, list: [dept], byDesk: Map(desk -> dept id), problems: [why] }
// on false: no block, today's office.
export function departmentsOf(cfg) {
  const raw = cfg?.departments
  if (raw == null) return { on: false, list: [], byDesk: new Map(), problems: [] }
  const problems = []
  if (typeof raw !== 'object' || Array.isArray(raw)) return { on: true, list: [], byDesk: new Map(), problems: ['office.json "departments" is not an object of departments'] }
  const list = [], byDesk = new Map(), leadOwner = new Map()
  for (const [id, d] of Object.entries(raw)) {
    if (!ID.test(id)) { problems.push(`department "${id}" is not a department id (lowercase letters, digits and hyphens)`); continue }
    if (!d || typeof d !== 'object' || Array.isArray(d)) { problems.push(`department ${id} is not an object`); continue }
    if (typeof d.lead !== 'string' || !d.lead.trim()) { problems.push(`department ${id} names no lead session ("lead")`); continue }
    const names = [d.lead.trim(), ...strs(d.aliases)]
    for (const n of names) {
      if (/^desk-/.test(n)) problems.push(`department ${id}: lead name "${n}" looks like a desk session (desk-…)`)
      if (leadOwner.has(n) && leadOwner.get(n) !== id) problems.push(`lead name "${n}" belongs to two departments (${leadOwner.get(n)} and ${id})`)
      else leadOwner.set(n, id)
    }
    const desks = strs(d.desks)
    for (const k of desks) {
      if (!DESK_NAME.test(k)) { problems.push(`department ${id}: "${k}" is not a desk id`); continue }
      if (byDesk.has(k) && byDesk.get(k) !== id) problems.push(`desk ${k} is in two departments (${byDesk.get(k)} and ${id}); a desk belongs to one`)
      else byDesk.set(k, id)
    }
    list.push({
      id, lead: d.lead.trim(), names, desks,
      instructions: typeof d.instructions === 'string' && d.instructions.trim() ? d.instructions.trim() : null,
      wake: typeof d.wake === 'string' && d.wake.trim() ? d.wake : null,
      start: typeof d.start === 'string' && d.start.trim() ? d.start : null,
      open: d.open === true,
      bash: Array.isArray(d.bash) ? d.bash : null,
      sweepsLease: typeof d.sweepsLease === 'string' && d.sweepsLease.trim() ? d.sweepsLease : null,
      services: strs(d.services),
    })
  }
  return { on: true, list, byDesk, problems }
}

// .office/local.json "departments" and "sweeps" -> { set: [id] | null, sweeps, error }
// set null = this machine names none. Only these two keys are read.
export function machineOf(root, cfg) {
  const D = departmentsOf(cfg)
  let c
  try { c = JSON.parse(readFileSync(join(root, '.office', 'local.json'), 'utf8')) } catch (e) {
    return { set: null, sweeps: false, error: e.code === 'ENOENT' ? null : `.office/local.json cannot be read (${e.message})` }
  }
  if (!c || typeof c !== 'object' || Array.isArray(c)) return { set: null, sweeps: false, error: '.office/local.json is not a JSON object' }
  const sweeps = c.sweeps === true
  if (c.sweeps != null && typeof c.sweeps !== 'boolean') return { set: null, sweeps: false, error: '.office/local.json "sweeps" is not true or false' }
  if (c.departments == null) return { set: null, sweeps, error: null }
  if (!Array.isArray(c.departments) || c.departments.some((x) => typeof x !== 'string')) return { set: null, sweeps, error: '.office/local.json "departments" is not a list of department ids' }
  const unknown = c.departments.filter((x) => !D.list.some((d) => d.id === x))
  if (unknown.length) return { set: null, sweeps, error: `.office/local.json names department(s) office.json does not declare: ${unknown.join(', ')}` }
  return { set: [...new Set(c.departments)], sweeps, error: null }
}

// Which desks this machine runs by department -> Set(desk id) | null (no limit)
// A desk in no department is everyone's. Only with a block AND a machine setting.
export function deskScope(root, cfg, desks) {
  const D = departmentsOf(cfg)
  if (!D.on) return null
  const m = machineOf(root, cfg)
  if (!m.set) return null
  const mine = new Set(m.set)
  return new Set(desks.map((d) => (typeof d === 'string' ? d : d.name)).filter((k) => !D.byDesk.has(k) || mine.has(D.byDesk.get(k))))
}

// ── the two lead resolvers ─────────────────────────────────────────────────
// a lead: { department, session, names, instructions, wake, start, open, bash }

// IDENTITY: every lead the office declares, wherever it runs
export function allLeads(cfg) {
  const D = departmentsOf(cfg)
  if (D.on) return D.list.map((d) => ({ department: d.id, session: d.lead, names: d.names, instructions: d.instructions, wake: d.wake ?? (typeof cfg?.lead?.wake === 'string' ? cfg.lead.wake : null), start: d.start ?? (typeof cfg?.lead?.start === 'string' ? cfg.lead.start : null), open: d.open, bash: d.bash, desks: d.desks }))
  const s = typeof cfg?.lead?.session === 'string' && cfg.lead.session ? cfg.lead.session : null
  if (!s) return []
  return [{ department: null, session: s, names: [s, ...strs(cfg.lead.aliases)], instructions: null, wake: typeof cfg.lead.wake === 'string' ? cfg.lead.wake : null, start: typeof cfg.lead.start === 'string' ? cfg.lead.start : null, open: true, bash: null, desks: null }]
}

// LIFECYCLE: the leads THIS machine starts, heals and watches. With a block,
// only the departments its local.json names; none named = none (health says so)
export function machineLeads(root, cfg) {
  const all = allLeads(cfg)
  if (!departmentsOf(cfg).on) return all
  const m = machineOf(root, cfg)
  if (!m.set) return []
  return all.filter((l) => m.set.includes(l.department))
}

// the lead whose name this is (identity), or null
export const leadByName = (cfg, name) => allLeads(cfg).find((l) => l.names.includes(name)) ?? null

// the leads a desk reports to: its department's, or (in no department) every lead
export function leadsOfDesk(cfg, deskId) {
  const D = departmentsOf(cfg)
  const all = allLeads(cfg)
  if (!D.on || !D.byDesk.has(deskId)) return all
  return all.filter((l) => l.department === D.byDesk.get(deskId))
}

// a shim of office.json for one lead, for the code written for one lead
// (start's launch, leadReach, the lead doorbell): its names under "lead"
export const cfgForLead = (cfg, l) => ({ ...cfg, lead: { ...(cfg?.lead ?? {}), session: l.session, aliases: l.names.slice(1), ...(l.wake ? { wake: l.wake } : {}), ...(l.start ? { start: l.start } : {}) } })

// the desks this machine runs by department (all of them without a limit)
export function desksHere(root, cfg, desks) {
  const s = deskScope(root, cfg, desks)
  return s ? desks.filter((d) => s.has(d.name)) : desks
}
