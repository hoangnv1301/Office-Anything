#!/usr/bin/env node
// ⛔ DOES EVERY COMMIT SINCE ADOPTION SAY WHAT KIND OF CHANGE IT IS?
//
// Conventional Commits, the basic set: type(scope)?: subject, where type is
// feat, fix, chore, docs, test, refactor, perf, build, ci, style or revert.
// The WHY still belongs in the body, in full sentences; the prefix is so a
// reader, a changelog and a release script can sort a hundred subjects
// without opening them.
//
// ADOPTION IS A VISIBLE EDIT, NEVER AN AMBUSH. The check applies only when
// the repo carries conventions.json with {"commits": "conventional"}, and it
// audits from the commit that ADDED that file, forward. History before
// adoption is somebody else's style and is left alone: a gate that lands red
// on three hundred old commits gets disabled, not obeyed.
//
// Exit 0 clean, 4 finding, 7 UNKNOWN.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { isMain } from '../lib/is-main.mjs'

export const MARKER = 'conventions.json'
export const TYPES = ['feat', 'fix', 'chore', 'docs', 'test', 'refactor', 'perf', 'build', 'ci', 'style', 'revert']
export const CONVENTIONAL = new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9./-]+\\))?!?: \\S.*`)

// Merges are git's own subjects; reverting git's phrasing would fight the tool.
export const exempt = (subject) => /^(Merge |Revert ")/.test(subject)

export const checkSubject = (s) => exempt(s) || CONVENTIONAL.test(s)

const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()

export function adopted(root) {
  if (!existsSync(join(root, MARKER))) return false
  try { return JSON.parse(readFileSync(join(root, MARKER), 'utf8')).commits === 'conventional' }
  catch { return null } // unreadable is not "not adopted"
}

export function baselineSha(root) {
  // The FIRST commit that added the marker. --diff-filter=A with --follow off:
  // if the file was added twice (deleted, re-added), the earliest add governs;
  // un-adopting by deletion shows up as the marker being absent, which is the
  // honest off switch.
  const out = git(root, ['log', '--diff-filter=A', '--format=%H', '--', MARKER])
  const shas = out.split('\n').filter(Boolean)
  return shas.length ? shas[shas.length - 1] : null
}

export const applies = (root) => existsSync(join(root, '.git')) && adopted(root) !== false

export function report(root = process.cwd()) {
  if (!applies(root)) return { code: 0, applicable: false, why: `no ${MARKER} claiming "conventional", or not a git repo` }
  if (adopted(root) === null) return { code: 7, applicable: true, why: `${MARKER} exists and cannot be parsed` }

  let base, rows
  try {
    base = baselineSha(root)
    if (!base) return { code: 7, applicable: true, why: `${MARKER} is on disk but no commit ever added it. Commit the adoption first` }
    rows = git(root, ['log', `${base}..HEAD`, '--format=%h%x09%s']).split('\n').filter(Boolean)
  } catch (e) {
    return { code: 7, applicable: true, why: `git could not answer: ${String(e.message).slice(0, 80)}` }
  }

  const bad = rows.map((r) => r.split('\t')).filter(([, s]) => !checkSubject(s ?? ''))
  if (!bad.length) {
    return { code: 0, applicable: true, why: `${rows.length} commit(s) since adoption, every subject typed` }
  }
  return {
    code: 4, applicable: true,
    why: `${bad.length} of ${rows.length} commit(s) since adoption carry no type prefix`,
    findings: bad.slice(0, 10).map(([sha, s]) => ({ desk: sha, say: `"${s.slice(0, 60)}" — start it with ${TYPES.slice(0, 3).join(':, ')}: ...` })),
  }
}

if (isMain(import.meta.url)) {
  const r = report(process.argv[2] ?? process.cwd())
  if (!r.applicable) { console.log(`   not applicable  ${r.why}`); process.exit(0) }
  if (r.code === 7) { console.log(`UNKNOWN  ${r.why}`); process.exit(7) }
  if (r.code === 0) { console.log(`ok  ${r.why}`); process.exit(0) }
  console.log(`⛔ ${r.why}\n`)
  for (const f of r.findings) console.log(`   ${f.desk}  ${f.say}`)
  process.exit(4)
}
