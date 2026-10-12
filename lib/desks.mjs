// WHICH DESKS RUN ON THIS MACHINE.
//
//   node lib/desks.mjs [root] list
//   node lib/desks.mjs [root] on|off <desk>
//   node lib/desks.mjs [root] default on|off
//
// One office, several people: the owner runs every desk, someone else runs
// only design and inventory and never customer service. The switch is per
// machine, in .office/local.json, which the office's own .gitignore (`*`)
// keeps out of every commit:
//
//   { "desks": { "default": true, "enabled": { "customer": false } } }
//
// No file, or no "desks" key: every desk is on, exactly as before.
//
// ⛔ ONE ANSWER, ASKED EVERYWHERE. "Should this desk run here" is read by the
// starter, the boot hook, health (whose "dead" is what the watchdog restarts),
// desk-watch and the case sweep. Each asks deskOn(); none reads the file.
// ⛔ ONLY THE "desks" KEY IS READ. The file is never merged into office.json:
// an unreviewed, uncommitted file must not be able to change the wall, the
// sandbox, the role variable or the launch flags.
// ⛔ OFF STOPS NEW WORK, IT NEVER DROPS OLD WORK. Turning a desk off kills
// nothing and releases nothing: a running desk keeps running until someone
// closes it, case claims it holds keep their heartbeat, and the book keeps
// every queued case. What stops is starting it, restarting it, waking it and
// claiming new cases for it.
// ⛔ A BROKEN FILE IS NOT "ALL ON". The person who wrote it wanted fewer desks;
// reading it as empty starts the ones they meant to keep off. A start refuses
// and names the file.
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs'
import { join, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { rosterSafe } from './desk.mjs'
import { findOffice } from './office.mjs'
import { readCases, perCaseOf, adapterCall } from './cases.mjs'
import { writeAlert } from './alerts.mjs'
import { readOfficeConfig } from './office.mjs'
import { isMain } from './is-main.mjs'

export const localFile = (root) => join(root, '.office', 'local.json')

// -> { default, enabled: {name: bool}, error, exists }
export function readSwitch(root) {
  let text
  try { text = readFileSync(localFile(root), 'utf8') } catch (e) {
    return { default: true, enabled: {}, exists: false, error: e.code === 'ENOENT' ? null : `${localFile(root)} cannot be read (${e.code ?? e.message})` }
  }
  const bad = (why) => ({ default: true, enabled: {}, exists: true, error: `${localFile(root)} ${why}` })
  let c
  try { c = JSON.parse(text) } catch (e) { return bad(`is not valid JSON (${e.message})`) }
  if (!c || typeof c !== 'object' || Array.isArray(c)) return bad('is not a JSON object')
  const D = c.desks ?? {}
  if (!D || typeof D !== 'object' || Array.isArray(D)) return bad('"desks" is not an object')
  if (D.default != null && typeof D.default !== 'boolean') return bad('"desks.default" is not true or false')
  const E = D.enabled ?? {}
  if (!E || typeof E !== 'object' || Array.isArray(E)) return bad('"desks.enabled" is not an object')
  for (const [k, v] of Object.entries(E)) if (typeof v !== 'boolean') return bad(`"desks.enabled.${k}" is not true or false`)
  return { default: D.default ?? true, enabled: { ...E }, exists: true, error: null }
}

// -> { on, source } for one desk name. The lead is always on: it is the one
// that hears about desks that are off.
export function deskOn(sw, name) {
  if (name === 'lead') return { on: true, source: 'the lead is always on' }
  if (name in sw.enabled) return { on: sw.enabled[name], source: '.office/local.json' }
  return { on: sw.default, source: sw.exists && sw.default === false ? '.office/local.json default' : 'default' }
}

// throws when the switch cannot be read: the callers that START things use this
export function switchOrThrow(root) {
  const sw = readSwitch(root)
  if (sw.error) throw new Error(`${sw.error}: fix or remove it (node lib/desks.mjs list); nothing is started while it is unreadable`)
  return sw
}

// office.json "openWork": the office's own list of what desks owe (promises,
// waiting work), as a command run at the office root. Every output line that
// names desk-<name> (or one of its case sessions) is one open item for it.
//   "openWork": "node scripts/desk/promise-watchdog.mjs --dry"   or
//   "openWork": { "command": "…", "timeoutSec": 60 }
// It must only READ: it runs on every sweep. Exit non-zero = UNKNOWN, never "nothing owed".
const runs = new Map()
export function officeOpenWork(root, cfg, { run = spawnSync, now = Date.now() } = {}) {
  const W = typeof cfg?.openWork === 'string' ? { command: cfg.openWork } : cfg?.openWork
  if (!W || typeof W.command !== 'string' || !W.command) return null
  const k = root + '\0' + W.command
  const hit = runs.get(k)
  if (hit && now - hit.at < 30_000) return hit.r
  const t = Number.isFinite(W.timeoutSec) ? W.timeoutSec : 60
  const s = run('/bin/sh', ['-c', W.command], { cwd: root, encoding: 'utf8', timeout: t * 1000 })
  const r = s.error || s.status !== 0
    ? { lines: [], error: `office.json openWork ${s.error?.code === 'ETIMEDOUT' ? `timed out after ${t} s` : s.error ? s.error.message : `exited ${s.status}`}` }
    : { lines: String(s.stdout ?? '').split('\n').map((l) => l.trim()).filter(Boolean), error: null }
  runs.set(k, { at: now, r })
  return r
}
export const namesDesk = (line, name) => new RegExp(`(^|[^\\w-])desk-${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w]|-[\\w])`).test(line)

// The work a desk that is off still owes: case claims this machine holds for
// it, cases its book has waiting, and the office's own openWork lines naming
// it. -> { items: [line], unknown: [why] }
export function openWork(root, desk, { cfg = readOfficeConfig(root), adapter = (d, pc, req) => adapterCall(root, d, pc, req), run } = {}) {
  const items = [], unknown = []
  const ow = officeOpenWork(root, cfg, run ? { run } : {})
  if (ow?.error) unknown.push(ow.error)
  else if (ow) for (const l of ow.lines) if (namesDesk(l, desk.name)) items.push(l.slice(0, 200))
  for (const [k, v] of Object.entries(readCases(root))) {
    if (!k.startsWith(desk.name + '--') || v.closedAt) continue
    items.push(`case ${k.slice(desk.name.length + 2)} is claimed by this machine`)
  }
  let pc = null
  try { pc = perCaseOf(desk) } catch (e) { unknown.push(e.message) }
  if (pc?.adapter) {
    try { for (const c of adapter(desk, pc, { op: 'open' })?.cases ?? []) items.push(`case ${c.key} is waiting in the book`) }
    catch (e) { unknown.push(e.message) }
  }
  return { items, unknown }
}

// the lead hears about an off desk that still owes work (once per quiet window)
export function alertOff(root, cfg, desk, w, now = Date.now()) {
  if (!w.items.length && !w.unknown.length) return false
  const text = w.items.length
    ? `desk-${desk.name} is off on this machine and has ${w.items.length} open item(s): ${w.items.slice(0, 5).join('; ')}${w.items.length > 5 ? '; …' : ''}. Turn it on (node lib/desks.mjs on ${desk.name}) or hand them to someone who runs it.`
    : `desk-${desk.name} is off on this machine and its open work could not be read (${w.unknown[0]})`
  return writeAlert(root, cfg, { type: 'DESK-OFF', subject: `desk-${desk.name}`, text, quietKey: 'desk-off:' + desk.name, now })
}

function save(root, sw) {
  mkdirSync(join(root, '.office'), { recursive: true })
  if (!existsSync(join(root, '.office', '.gitignore'))) writeFileSync(join(root, '.office', '.gitignore'), '# office-anything state and logs; never committed\n*\n')
  let c = {}
  try { c = JSON.parse(readFileSync(localFile(root), 'utf8')) } catch {}
  c.desks = { default: sw.default, enabled: sw.enabled }
  const tmp = localFile(root) + '.tmp'
  writeFileSync(tmp, JSON.stringify(c, null, 2) + '\n')
  renameSync(tmp, localFile(root))
}

// -> { ok, lines }
export function setDesk(root, name, on, { cfg = readOfficeConfig(root), live = [], adapter } = {}) {
  const sw = readSwitch(root)
  if (sw.error) return { ok: false, lines: [`${sw.error}: fix or remove it first`] }
  const { desks } = rosterSafe(join(root, 'desks'))
  const d = desks.find((x) => x.name === name)
  if (!d) return { ok: false, lines: [`no desk called ${name} (have: ${desks.map((x) => x.name).join(' ')})`] }
  if (d.kind === 'lead') return { ok: false, lines: [`${name} is the lead: it is always on`] }
  sw.enabled[name] = on
  save(root, sw)
  const lines = [`desk-${name}: ${on ? 'ON' : 'OFF'} on this machine (.office/local.json)`]
  if (!on) {
    // by name AND by folder: another office on this machine can have a desk of the same name
    const s = live.find((x) => x.name === `desk-${name}` && (!x.cwd || x.cwd === root || x.cwd.startsWith(root + sep)))
    if (s) lines.push(`  still running (pid ${s.pid}): nothing was closed. It stops being restarted or woken; close it yourself when its work is handed over.`)
    const w = openWork(root, d, { cfg, ...(adapter ? { adapter } : {}) })
    for (const i of w.items) lines.push(`  ⚠ open: ${i}`)
    for (const u of w.unknown) lines.push(`  ⚠ open work unknown: ${u}`)
    if (alertOff(root, cfg, d, w)) lines.push('  the lead has been alerted')
  } else lines.push(`  start it with /desk-start ${name}`)
  return { ok: true, lines }
}

export function setDefault(root, on) {
  const sw = readSwitch(root)
  if (sw.error) return { ok: false, lines: [`${sw.error}: fix or remove it first`] }
  sw.default = on
  save(root, sw)
  return { ok: true, lines: [`desks not named in .office/local.json are now ${on ? 'ON' : 'OFF'} on this machine`] }
}

// -> { ok, lines }: every desk, on or off, and why; names in the file that are no desk
export function listDesks(root) {
  const sw = readSwitch(root)
  const { desks } = rosterSafe(join(root, 'desks'))
  const lines = []
  if (sw.error) lines.push(`⚠ ${sw.error}: starts are refused until it is fixed`)
  for (const d of desks) {
    if (d.kind === 'lead') continue
    const r = deskOn(sw, d.name)
    lines.push(`${(r.on ? 'on ' : 'OFF') + '  desk-' + d.name}${d.autostart === false ? '  (autostart off)' : ''}  · ${r.source}`)
  }
  const names = new Set(desks.map((d) => d.name))
  const unknown = Object.keys(sw.enabled).filter((k) => !names.has(k))
  for (const k of unknown) lines.push(`⚠ "${k}" in .office/local.json is not a desk here: it switches nothing`)
  const off = desks.filter((d) => d.kind !== 'lead' && !deskOn(sw, d.name).on).length
  lines.unshift(`this machine runs ${desks.filter((d) => d.kind !== 'lead').length - off} of ${desks.filter((d) => d.kind !== 'lead').length} desks${off ? ` (${off} off)` : ''}`)
  return { ok: !sw.error && !unknown.length, lines }
}

if (isMain(import.meta.url)) {
  const a = process.argv.slice(2)
  const VERBS = ['list', 'on', 'off', 'default']
  const root = a.length && !VERBS.includes(a[0]) ? findOffice(a.shift()) : findOffice(process.cwd())
  const verb = a.shift()
  const usage = 'usage: node lib/desks.mjs [root] list | on <desk> | off <desk> | default on|off'
  if (!root || !VERBS.includes(verb)) { console.error(usage); process.exit(1) }
  let r
  if (verb === 'list') r = listDesks(root)
  else if (verb === 'default' && ['on', 'off'].includes(a[0])) r = setDefault(root, a[0] === 'on')
  else if (verb !== 'default' && a[0]) {
    let live = []
    try { const { liveSessions, processTable } = await import('./procs.mjs'); live = liveSessions((await import('node:os')).homedir(), processTable()) } catch {}
    r = setDesk(root, a[0], verb === 'on', { live })
  } else { console.error(usage); process.exit(1) }
  console.log(r.lines.join('\n'))
  process.exit(r.ok ? 0 : 4)
}
