#!/usr/bin/env node
// POST A RELEASE NOTE (the release step after merge → version bump; dev tooling,
// not shipped behaviour).
//
//   node scripts/release-post.mjs [<version>] [--dry] [--ops <local-cabinets-ops path>]
//   node scripts/release-post.mjs --missing [--from 0.10.0] [--dry]   (never a docs/releases.json "_skipped" one)
//
// The owner, 2026-10-23: no release note had been posted since 0.9.0, because
// the "Discord text" each release carried only ever went to the lead. So the
// note is posted here, by the release step itself:
//   1. the note is docs/releases.json[<version>], checked against the forum
//      verb's own rules first (items ≤ 160 chars, ≤ 12 per section, no
//      internal numbers, ≤ 1800 chars in all);
//   2. the GitHub release v<version> exists (the verb's release_url is it): made
//      at the commit that shipped the version, with its CHANGELOG section;
//   3. ops verb 发版本日志 { product: office-anything, release, date, sections },
//      run through local-cabinets-ops' scripts/desk/ops.mjs as the lead
//      (LCC_ROLE, from the ops root: ops.mjs picks the lead's key itself; this
//      script never reads a key).
// ⛔ FAILS LOUDLY. A refused post exits non-zero with the refusal as it came.
// The forum's cap (10 release posts a day, Local Ops' included) stops --missing
// with exit 5 and what is left: run it again tomorrow. A post already made comes
// back dup from the verb and counts as posted, so a re-run is safe.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isMain } from '../lib/is-main.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const RULES = { itemMax: 160, perSection: 12, maxChars: 1800, sections: ['new', 'fixed', 'improved', 'todo'] }
// the verb's own: line / order / customer ids, #123, PR 123, a pull URL, a commit hash
const INTERNAL_ID = /\b(?:BT|SC)-\d{6}-\d{1,6}\b|\bHD-\d{3,}\b|#\d{2,}\b|\bPRs?\s*#?\d+\b|\/pull\/\d+|\b(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/i

export const notes = (repo = REPO) => JSON.parse(readFileSync(join(repo, 'docs', 'releases.json'), 'utf8'))
export const semverSort = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0 }

// a note -> null | why the forum would refuse it
export function noteProblem(version, n) {
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(version)) return `${version} is not a plugin version (x.y.z)`
  if (!n || typeof n !== 'object') return `docs/releases.json has no note for ${version}`
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(n.date ?? ''))) return `${version}: date must be YYYY-MM-DD`
  let total = 0, chars = 0
  for (const k of Object.keys(n)) if (k !== 'date' && !RULES.sections.includes(k)) return `${version}: "${k}" is not a section (new, fixed, improved, todo)`
  for (const k of RULES.sections) {
    const list = n[k]
    if (list == null) continue
    if (!Array.isArray(list)) return `${version}.${k} is not a list of sentences`
    if (list.length > RULES.perSection) return `${version}.${k} has ${list.length} items, at most ${RULES.perSection}`
    for (const [i, t] of list.entries()) {
      if (typeof t !== 'string' || !t.trim()) return `${version}.${k}[${i}] is empty`
      if (t.length > RULES.itemMax) return `${version}.${k}[${i}] is ${t.length} characters, at most ${RULES.itemMax}`
      if (INTERNAL_ID.test(t)) return `${version}.${k}[${i}] carries an internal number (a PR, id or commit): write what changed for the user`
      if (/<@|@everyone|@here/i.test(t)) return `${version}.${k}[${i}] mentions someone: a release note @s nobody`
      chars += t.length + 3
    }
    total += list.length
  }
  if (!total) return `${version}: the note says nothing`
  if (chars + 120 > RULES.maxChars) return `${version}: about ${chars + 120} characters, at most ${RULES.maxChars}`
  return null
}

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 120_000, ...opts })

// the commit whose plugin.json first says this version
export function shippedAt(version, repo = REPO, r = run) {
  const x = r('git', ['log', '--format=%H', '--reverse', `-S"version": "${version}"`, '--', '.claude-plugin/plugin.json'], { cwd: repo })
  return String(x.stdout ?? '').trim().split('\n')[0] || null
}
export function changelogOf(version, repo = REPO) {
  const t = readFileSync(join(repo, 'CHANGELOG.md'), 'utf8')
  const m = new RegExp(`^## ${version.replace(/\./g, '\\.')}\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(t)
  return m ? m[1].trim() : ''
}

// -> { ok, why }
export function ensureGithubRelease(version, { repo = REPO, r = run, dry = false } = {}) {
  if (!r('gh', ['release', 'view', `v${version}`, '--json', 'tagName'], { cwd: repo }).status) return { ok: true, why: `v${version} exists` }
  const sha = shippedAt(version, repo, r)
  if (!sha) return { ok: false, why: `no commit sets plugin.json to ${version}` }
  if (dry) return { ok: true, why: `would create v${version} at ${sha.slice(0, 7)}` }
  const f = join(mkdtempSync(join(tmpdir(), 'oa-rel-')), 'notes.md')
  writeFileSync(f, changelogOf(version, repo) || `Office-Anything ${version}`)
  const x = r('gh', ['release', 'create', `v${version}`, '--target', sha, '--title', version, '--notes-file', f, '--latest=false'], { cwd: repo })
  return x.status === 0 ? { ok: true, why: `created v${version} at ${sha.slice(0, 7)}` } : { ok: false, why: `gh release create failed: ${String(x.stderr || x.stdout).trim()}` }
}

// -> { state: 'posted'|'dup'|'dry'|'refused'|'cap', why }
export function postNote(version, { repo = REPO, ops = process.env.OPS_REPO || resolve(repo, '..', 'local-cabinets-ops'), r = run, dry = false } = {}) {
  const n = notes(repo)[version]
  const bad = noteProblem(version, n)
  if (bad) return { state: 'refused', why: bad }
  const gh = ensureGithubRelease(version, { repo, r, dry })
  if (!gh.ok) return { state: 'refused', why: gh.why }
  const sections = Object.fromEntries(RULES.sections.filter((k) => n[k]?.length).map((k) => [k, n[k]]))
  const payload = { product: 'office-anything', release: version, date: n.date, sections }
  if (dry) return { state: 'dry', why: `${gh.why}; would post ${JSON.stringify(payload).slice(0, 200)}…` }
  // ⛔ NO IDEMPOTENCY KEY: ops.mjs hands a key's first answer back for ever, so
  // a post rejected before the forum was configured would come back rejected
  // after. The verb itself allows one post per version (a re-post is its dup).
  const x = r(process.execPath, [join(ops, 'scripts', 'desk', 'ops.mjs'), 'propose', '发版本日志', JSON.stringify(payload), `office-anything ${version} release step`], { cwd: ops, env: { ...process.env, LCC_ROLE: 'lead', OPS_TOKEN: '' } })
  const out = String(x.stdout ?? '').trim(), err = String(x.stderr ?? '').trim()
  const capped = (t) => /24 小时最多|今天发够了/.test(t)
  if (x.error || x.status !== 0) return { state: capped(err + out) ? 'cap' : 'refused', why: err || out || x.error?.message || `exit ${x.status}` }
  let j = null
  try { j = JSON.parse(out.split('\n').filter(Boolean).at(-1)) } catch {}
  // ⛔ EXIT 0 IS NOT "POSTED". ops.mjs exits 0 with {"status":"rejected","error":…}
  // when the verb refuses (2026-10-23: "release channel not configured"). Only a
  // proposal that was not rejected, carries no error and names its id counts.
  const why = j?.error ?? j?.result?.error ?? null
  if (!j || why || /^(rejected|failed|cancelled|error)$/i.test(String(j.status ?? ''))) return { state: capped(String(why ?? out)) ? 'cap' : 'refused', why: why ? String(why) : `ops.mjs answered ${out.slice(0, 300) || '(nothing)'}` }
  const dup = !!(j.dup ?? j.result?.dup)
  return { state: dup ? 'dup' : 'posted', why: `${gh.why}; ${dup ? 'already posted' : 'posted'}${j.id ? ` (${j.id}, ${j.status ?? 'queued'})` : ''}` }
}

// the versions --missing still owes: every note from --from on, except those
// docs/releases.json "_skipped" retires (0.19.7, the lead 2026-10-23: the 25
// notes before 0.19 nobody needs; skipped, not owed). One version named on the
// command line is posted whatever "_skipped" says.
export function owed(n = notes(), from = '0.0.0') {
  const sk = n._skipped && typeof n._skipped.through === 'string' && /^\d+\.\d+\.\d+$/.test(n._skipped.through) ? n._skipped.through : null
  return Object.keys(n).filter((v) => !v.startsWith('_') && semverSort(v, from) >= 0 && !(sk && semverSort(v, sk) <= 0)).sort(semverSort)
}

if (isMain(import.meta.url)) {
  const a = process.argv.slice(2)
  const dry = a.includes('--dry')
  const opt = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null }
  const ops = opt('--ops') ?? undefined
  const versions = a.includes('--missing')
    ? owed(notes(), opt('--from') ?? '0.0.0')
    : [a.find((x) => /^\d+\.\d+\.\d+$/.test(x)) ?? JSON.parse(readFileSync(join(REPO, '.claude-plugin', 'plugin.json'), 'utf8')).version]
  let done = 0
  for (const [i, v] of versions.entries()) {
    const r = postNote(v, { dry, ...(ops ? { ops } : {}) })
    console.log(`${v}: ${r.state} · ${r.why}`)
    if (r.state === 'cap') { console.error(`⛔ the release forum's daily cap is reached after ${done} post(s); left: ${versions.slice(i).join(', ')}. Run again tomorrow.`); process.exit(5) }
    if (r.state === 'refused') { console.error(`⛔ ${v} was NOT posted: ${r.why}`); process.exit(4) }
    if (r.state === 'posted') done++
  }
}
