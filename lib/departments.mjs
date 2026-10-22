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
//   start         how heal restarts it (default the plugin's own start, by
//                 its name; never office.json lead.start, which starts "lead")
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
import { join, resolve, sep } from 'node:path'
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
  // keys starting with "_" are notes (office.json has no comments)
  const entries = Object.entries(raw).filter(([k]) => !k.startsWith('_'))
  // ⛔ A BLOCK THAT NAMES NO LEAD IS NOT DEPARTMENTS (0.15.1). Another tool's
  // block under the same key (2026-10-22: the token benchmark's {order,
  // default, groups}) turned departments "on" with none in them: this machine
  // ran no lead, the watchdog would not restart it, and wall.lead.open stopped
  // applying. With no entry naming a lead there is nothing to hand the lead
  // role to, so it reads as no block, and health says so.
  if (!entries.some(([, d]) => d && typeof d === 'object' && !Array.isArray(d) && typeof d.lead === 'string' && d.lead.trim())) {
    return { on: false, list: [], byDesk: new Map(), problems: [], ignored: `office.json "departments" names no department with a "lead" (${entries.map(([k]) => k).join(', ') || 'it is empty'}), so it is read as no departments` }
  }
  const list = [], byDesk = new Map(), leadOwner = new Map()
  for (const [id, d] of entries) {
    // ⛔ A HALF-WRITTEN BLOCK MUST NOT WEAKEN THE WALL. A department with a bad
    // id is still read (and its lead still a lead); only no lead at all is skipped
    if (!ID.test(id)) problems.push(`department "${id}" is not a department id (lowercase letters, digits and hyphens)`)
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
      // 0.16.0: what the token page calls it, its folder (lib/desk.mjs deskRoots
      // reads the same field), and more session names that count as its own
      label: typeof d.label === 'string' && d.label.trim() ? d.label.trim() : id,
      dir: typeof d.dir === 'string' && d.dir.trim() ? d.dir.trim() : `departments/${id}`,
      sessions: strs(d.sessions),
    })
    for (const p of strs(d.sessions)) { try { new RegExp(p) } catch (e) { problems.push(`department ${id}: sessions pattern ${p} does not compile (${e.message})`) } }
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
  // with a block, the old lead.session (and its aliases) is still a lead by
  // name, walled and never started: a block that is half written, or a session
  // still started under the old name, is never a developer outside the wall
  const legacy = () => { const s = typeof cfg?.lead?.session === 'string' && cfg.lead.session ? cfg.lead.session : null; return s ? [{ department: null, legacy: true, session: s, names: [s, ...strs(cfg.lead.aliases)], instructions: null, wake: null, start: null, open: false, bash: null, desks: null }] : [] }
  if (D.on) return [...D.list.map((d) => ({ department: d.id, session: d.lead, names: d.names, instructions: d.instructions, wake: d.wake ?? (typeof cfg?.lead?.wake === 'string' ? cfg.lead.wake : null), start: d.start, open: d.open, bash: d.bash, desks: d.desks })), ...legacy()]
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
  return all.filter((l) => !l.legacy && m.set.includes(l.department))
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

// ── construction: the builders, one per codebase (0.16.0) ──────────────────
//   office.json "construction": [{ "name": "construction", "root": ".", "model": "opus",
//                                  "label": "CODING", "sessions": ["^construction(-\\d+)?$"] }]
// ⛔ NOT A LEAD. Everything allLeads returns gets the lead's wall, and the lead
// writes no file; a builder writes code. Its own resolver, its own rules (0.17).
export function constructionOf(cfg) {
  const raw = cfg?.construction
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : []
  return list.filter((c) => c && typeof c.name === 'string' && c.name.trim()).map((c) => ({
    name: c.name.trim(), root: typeof c.root === 'string' && c.root.trim() ? c.root.trim() : '.',
    model: typeof c.model === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(c.model) ? c.model : null,
    label: typeof c.label === 'string' && c.label.trim() ? c.label.trim() : 'construction',
    sessions: strs(c.sessions),
  }))
}

// ── usage groups: which group a session's tokens count in ─────────────────
//   office.json "usage": { "order": ["customer-service", "local-ops", "construction"], "default": "construction" }
// A session is its department's when its NAME is the lead or an alias, a
// session of one of its desks (desk-<name>, desk-<name>--<key>), or matches its
// "sessions"; a builder's when it is the builder or one of its workers
// (<name>-N) or matches its "sessions". Groups are asked in usage.order, first
// match wins. Then by CWD: under a department's folder. Then usage.default.
// -> { id, label } | null.  desks: the roster ({ name, title }), else ids are names
const re = (p) => { try { return new RegExp(p) } catch { return null } }
export function usageGroupOf(cfg, { name = '', cwd = null } = {}, { root = null, desks = null } = {}) {
  const D = departmentsOf(cfg)
  const B = constructionOf(cfg)
  const titleOf = (id) => desks?.find((d) => d.name === id)?.title ?? id
  const groups = [
    ...D.list.map((d) => ({ id: d.id, label: d.label, dir: d.dir,
      byName: (n) => d.names.includes(n) || d.desks.some((k) => new RegExp(`^desk-(?:${titleOf(k)}|${k})(?:--|$)`).test(n)) || d.sessions.some((p) => re(p)?.test(n)) })),
    ...B.map((b) => ({ id: b.name, label: b.label, dir: null,
      byName: (n) => n === b.name || new RegExp(`^${b.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+$`).test(n) || b.sessions.some((p) => re(p)?.test(n)) })),
  ]
  const order = Array.isArray(cfg?.usage?.order) ? cfg.usage.order.filter((x) => typeof x === 'string') : []
  const ranked = [...order.map((id) => groups.find((g) => g.id === id)).filter(Boolean), ...groups.filter((g) => !order.includes(g.id))]
  const out = (g) => ({ id: g.id, label: g.label })
  if (name) for (const g of ranked) if (g.byName(String(name))) return out(g)
  if (cwd && root) {
    const at = resolve(cwd) + sep
    for (const g of ranked) if (g.dir && at.startsWith(resolve(root, g.dir) + sep)) return out(g)
  }
  const def = typeof cfg?.usage?.default === 'string' ? groups.find((g) => g.id === cfg.usage.default) : null
  return (name || cwd) && def ? out(def) : null
}
