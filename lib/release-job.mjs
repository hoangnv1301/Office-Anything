// A RELEASE IS A JOB WITH STEPS, EACH A CASE WITH AN OWNER AND AN ALARM (Office-Anything #97).
// 0.22.0 was released and then nothing moved until the owner asked twice: nobody owned the release
// note, telling the team, or updating the Mac (it stayed on 0.20.5 until a session ran
// `claude plugin update` by hand).
//
//   node lib/release-job.mjs [root] start <version>        put the steps down as cases (once; run again changes nothing)
//   node lib/release-job.mjs [root] status [<version>]     each step: owner, state, due, whether the owner's yes exists
//   node lib/release-job.mjs [root] done <version> <note|notify:NAME|install:MACHINE> --evidence "…" --proof "…"
//   node lib/release-job.mjs [root] install [<version>] [--apply]   this machine: update the plugin at its next idle
//
// Steps (tasks of kind "step", key release:<version>:<step>, due from `start`):
//   note             post the release note (scripts/release-post.mjs closes this one itself, on a post it saw succeed)
//   notify:<name>    tell each person office.json release.notify names. Needs the owner's yes in the ledger
//                    (lib/approvals.mjs, action notify-release, target <name>) when this plugin has the ledger; `status` says whether it is there, or that the step is closed by hand
//   install:<machine> update the plugin on each machine office.json release.machines names, at its next idle
// A step past its due time is rung again, then raised to the lead, then said once to the owner
// (lib/follow.mjs, the same sweep as an ask). A step is closed with evidence, never by saying so.
//
// office.json "release": {
//   "owner": "lead",                                   who owns note and notify (default lead)
//   "notify": ["David"],                               people told after the note
//   "machines": [{ "name": "mac", "host": "airm1", "session": "full" }],   host: what `hostname` says (default name); session: who owns its install
//   "minutes": { "note": 60, "notify": 120, "install": 720 } }
//
// ⛔ INSTALL IS DRY BY DEFAULT and never touches a busy machine: `--apply` updates the plugin only when
// the version is one plugin.approved names and no session on this machine is working. It then reads the
// installed version back before it closes the step. It restarts nothing: it names the idle sessions that
// still run the old code (a session keeps the plugin it started with).
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readOfficeConfig, findOffice } from './office.mjs'
import { addTask, readTasks, closeByKey, FINAL } from './tasks.mjs'
import { writeAlert } from './alerts.mjs'
import { loadedVersion } from './version.mjs'
import { liveSessions } from './procs.mjs'
import { isMain } from './is-main.mjs'

// ⛔ THE OWNER'S-YES CHECK IS OPTIONAL. A plugin without the approval ledger (lib/approvals.mjs) still runs releases: `status` then
// says the notify step is closed by hand. With it, `status` also says whether the owner's typed approval exists.
const ledger = await import('./approvals.mjs').catch(() => null)
const MIN = 60_000
const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VER = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/
const semver = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0 }

export function releaseConfig(cfg) {
  const R = cfg?.release && typeof cfg.release === 'object' ? cfg.release : {}
  const num = (v, d) => (Number.isFinite(v) && v >= 1 ? Math.min(v, 30 * 24 * 60) : d)
  const owner = typeof R.owner === 'string' && R.owner.trim() ? R.owner.trim() : 'lead'
  return {
    owner,
    notify: (Array.isArray(R.notify) ? R.notify : []).filter((n) => typeof n === 'string' && /^[\w .'-]{1,60}$/.test(n.trim())).map((n) => n.trim()),
    machines: (Array.isArray(R.machines) ? R.machines : []).filter((m) => m && typeof m.name === 'string' && /^[\w.-]{1,40}$/.test(m.name)).map((m) => ({ name: m.name, host: typeof m.host === 'string' && m.host ? m.host : m.name, session: typeof m.session === 'string' && m.session ? m.session : owner })),
    minutes: { note: num(R.minutes?.note, 60), notify: num(R.minutes?.notify, 120), install: num(R.minutes?.install, 720) },
  }
}
const keyOf = (version, step) => `release:${version}:${step}`

// put the steps down; a step that already exists (any state) is left alone. -> { created: [key], existing: [key] }
export function startRelease(root, cfg, version, { now = Date.now(), by = { kind: 'lead' } } = {}) {
  if (!VER.test(String(version))) throw new Error(`${version} is not a plugin version (x.y.z)`)
  const R = releaseConfig(cfg)
  const have = new Set(readTasks(root).map((t) => t.key).filter(Boolean))
  const out = { created: [], existing: [] }
  const put = (step, assigned, title, minutes) => {
    const key = keyOf(version, step)
    if (have.has(key)) { out.existing.push(key); return }
    addTask(root, { said: `release ${version}: ${title}`, title: `release ${version}: ${title}`, source: 'other', assigned, kind: 'step', key, from: 'release', dueAt: now + minutes * MIN }, { by, now })
    out.created.push(key)
  }
  put('note', R.owner, 'post the release note', R.minutes.note)
  for (const n of R.notify) put(`notify:${n}`, R.owner, `tell ${n}`, R.minutes.notify)
  for (const m of R.machines) put(`install:${m.name}`, m.session, `install on ${m.name} at its next idle`, R.minutes.install)
  return out
}

export function releaseStatus(root, cfg, version, { now = Date.now(), approvals = ledger } = {}) {
  const prefix = `release:${version}:`
  return readTasks(root).filter((t) => t.key?.startsWith(prefix)).map((t) => {
    const step = t.key.slice(prefix.length)
    const person = step.startsWith('notify:') ? step.slice(7) : null
    const ok = person && approvals ? approvals.checkApproval(root, { action: 'notify-release', target: person }, { now }) : null
    return { step, id: t.id, assigned: t.assigned, state: t.state, due: t.dueAt, late: !FINAL.has(t.state) && t.state !== 'done' && now > t.dueAt, ...(ok ? { approved: ok.ok, approval: ok.ok ? ok.grant.id : ok.why } : person ? { byHand: true } : {}) }
  })
}

export function closeStep(root, version, step, { evidence, proof }, { now = Date.now() } = {}) {
  if (!evidence || !proof) throw new Error('a step is closed with --evidence (what you saw) and --proof (one line saying what it proves)')
  const id = closeByKey(root, keyOf(version, step), { evidence, proof }, { now })
  if (!id) throw new Error(`no open step ${step} for ${version} (run start, or it is already closed)`)
  return id
}

// ---- the machine's own install -------------------------------------------------------
const hostKey = (h) => String(h).toLowerCase().replace(/\.local$/, '')
export function installedVersion({ home = homedir() } = {}) {
  try {
    const j = JSON.parse(readFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), 'utf8'))
    const entry = Object.entries(j.plugins ?? j).find(([k]) => k.startsWith('office-anything@'))
    const e = Array.isArray(entry?.[1]) ? entry[1][0] : entry?.[1]
    return e?.version ? String(e.version) : null
  } catch { return null }
}
const marketplace = () => { try { return String(JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin', 'marketplace.json'), 'utf8')).name) } catch { return null } }

// -> { state, why, … } : not-listed | not-approved | current | busy | would-update | updated | failed
export function installHere(root, cfg, { version = null, apply = false, host = hostname(), home = homedir(), run = spawnSync, sessions = null, installed = installedVersion, now = Date.now() } = {}) {
  const R = releaseConfig(cfg)
  const me = R.machines.find((m) => hostKey(m.host) === hostKey(host))
  if (!me) return { state: 'not-listed', why: `office.json release.machines does not list this machine (${host}); nothing is installed here by the office` }
  const approved = Array.isArray(cfg?.plugin?.approved) ? cfg.plugin.approved.map(String).filter((v) => VER.test(v)).sort(semver) : []
  const target = version ?? approved.at(-1) ?? null
  if (!target) return { state: 'not-approved', machine: me.name, why: 'office.json plugin.approved names no version, so there is nothing to install', blockedBy: 'the owner approves a version by adding it to plugin.approved' }
  if (!approved.includes(target)) return { state: 'not-approved', machine: me.name, target, why: `the office has not approved ${target}`, blockedBy: `the owner approves ${target} by adding it to plugin.approved in office.json` }
  const have = installed({ home })
  // ⛔ A STEP THAT COULD NOT BE CLOSED IS SAID, NOT SWALLOWED: retried once, then an alert for the lead, and the result says so.
  // (null from closeByKey means there is no open step: no job was started, or it is already closed.)
  let unrecorded = null
  const close = (evidence) => {
    for (let n = 0; n < 2; n++) {
      try { closeByKey(root, keyOf(target, `install:${me.name}`), { evidence, proof: `the installed plugin on ${me.name} reads ${target}` }, { now }); unrecorded = null; return } catch (e) { unrecorded = e.message }
    }
    try { writeAlert(root, cfg, { type: 'ASK-LATE', kase: '-', subject: 'release', text: `${me.name} now runs ${target}, but the release step for it could not be closed (${unrecorded}); it will keep ringing until it is`, now }) } catch {}
  }
  if (have === target) { close(`installed_plugins.json says ${have} on ${host}`); return { state: 'current', machine: me.name, target, why: `${me.name} already has ${target}${unrecorded ? `; the release step could not be closed (${unrecorded}), the lead is told` : ''}`, unrecorded } }
  const live = sessions ?? liveSessions(home)
  const busy = live.filter((s) => s.status === 'busy').map((s) => s.name || String(s.pid))
  if (busy.length) return { state: 'busy', machine: me.name, target, busy, why: `${busy.length} session(s) are working (${busy.slice(0, 4).join(', ')}); it waits for the next idle` }
  const mp = marketplace()
  const cmds = [['claude', 'plugin', 'marketplace', 'update', ...(mp ? [mp] : [])], ['claude', 'plugin', 'update', mp ? `office-anything@${mp}` : 'office-anything']]
  const restart = live.filter((s) => s.status !== 'busy').map((s) => s.name || String(s.pid))
  if (!apply) return { state: 'would-update', machine: me.name, target, from: have, cmds: cmds.map((c) => c.join(' ')), restart, why: `would update ${me.name} from ${have ?? 'unknown'} to ${target}` }
  for (const c of cmds) {
    const r = run(c[0], c.slice(1), { encoding: 'utf8', timeout: 180_000 })
    if (r.error || r.status !== 0) return { state: 'failed', machine: me.name, target, why: `${c.join(' ')} failed (${r.error?.message ?? `exit ${r.status}: ${String(r.stderr ?? '').trim().split('\n').pop()}`})` }
  }
  const after = installed({ home })
  if (after !== target) return { state: 'failed', machine: me.name, target, why: `the update ran but the installed plugin reads ${after ?? 'unknown'}, not ${target}` }
  close(`installed_plugins.json says ${after} on ${host}`)
  return { state: 'updated', machine: me.name, target, from: have, restart, unrecorded, why: `${me.name} is on ${target}; these idle sessions still run the old code and need a restart: ${restart.join(', ') || 'none'}${unrecorded ? `; the release step could not be closed (${unrecorded}), the lead is told` : ''}` }
}

// ---- command line ----------------------------------------------------------------------
function parse(argv) {
  const words = [], flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) flags[k] = true; else { flags[k] = v; i++ } } else words.push(a)
  }
  return { words, flags }
}
const COMMANDS = new Set(['start', 'status', 'done', 'install'])
export function run(argv, { cwd = process.cwd(), out = (s) => console.log(s), now = Date.now() } = {}) {
  const { words, flags } = parse(argv)
  let root = null
  if (words.length && !COMMANDS.has(words[0])) root = findOffice(resolve(words.shift()))
  root = root ?? findOffice(cwd)
  const cmd = words.shift()
  if (!root || !COMMANDS.has(cmd)) throw new Error('usage: node lib/release-job.mjs [root] start|status|done|install …  (run inside an office)')
  const cfg = readOfficeConfig(root)
  const str = (v) => (typeof v === 'string' ? v : undefined)
  const version = words.find((w) => VER.test(w)) ?? (cmd === 'status' || cmd === 'install' ? undefined : loadedVersion())
  if (cmd === 'start') {
    const r = startRelease(root, cfg, version, { now })
    out(`release ${version}: ${r.created.length} step(s) put down${r.existing.length ? `, ${r.existing.length} already there` : ''}${r.created.length ? ': ' + r.created.map((k) => k.split(':').slice(2).join(':')).join(', ') : ''}`)
  } else if (cmd === 'status') {
    const v = version ?? [...new Set(readTasks(root).map((t) => /^release:([^:]+):/.exec(t.key ?? '')?.[1]).filter(Boolean))].sort(semver).at(-1)
    if (!v) { out('no release job'); return 0 }
    const rows = releaseStatus(root, cfg, v, { now })
    out(`release ${v}:\n` + (rows.map((s) => `  ${s.step.padEnd(24)} ${s.state.padEnd(9)} ${s.assigned}${s.late ? '  LATE' : ''}${s.approved === false ? `  (no owner yes yet: ${s.approval})` : s.approved ? `  (owner yes ${s.approval})` : s.byHand ? '  (close by hand: no approval ledger here)' : ''}`).join('\n') || '  (no steps: run start)'))
  } else if (cmd === 'done') {
    const step = words.find((w) => w !== version && !COMMANDS.has(w))
    out(`${closeStep(root, version, step, { evidence: str(flags.evidence), proof: str(flags.proof) }, { now })} closed`)
  } else {
    const r = installHere(root, cfg, { version: version ?? null, apply: !!flags.apply, now })
    out(`${r.state}: ${r.why}${r.blockedBy ? ` (who can unblock: ${r.blockedBy})` : ''}${r.cmds ? `\n  would run: ${r.cmds.join(' ; ')}` : ''}`)
    return ['updated', 'current', 'would-update'].includes(r.state) ? 0 : r.state === 'busy' ? 3 : 4
  }
  return 0
}

if (isMain(import.meta.url)) {
  try { process.exit(run(process.argv.slice(2))) } catch (e) { console.error(`release-job: ${e.message}`); process.exit(1) }
}
