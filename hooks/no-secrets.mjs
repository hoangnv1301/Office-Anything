#!/usr/bin/env node
// ⛔ REFUSE TO COMMIT A CREDENTIAL. Runs as a git pre-commit hook AND as a Claude Code
// PreToolUse gate, because a secret can arrive either way.
//
// ⛔ THE REASON THIS IS A GATE AND NOT A README PARAGRAPH: a public repo is public the
// INSTANT you push, and `git push` is not undoable. Deleting the file in a later commit
// does nothing, because the blob is still in history and anybody can read it. Rotating
// the key is the ONLY real remedy, and by then a scraper has had it for minutes.
//
// So the check has to happen BEFORE the commit exists, not after somebody notices.
//
// Usage:
//   node hooks/no-secrets.mjs --staged     git pre-commit; scans what is about to commit
//   node hooks/no-secrets.mjs --all        scans every blob in every commit, ever
//   node hooks/no-secrets.mjs              PreToolUse; reads a payload on stdin
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { isMain } from '../lib/is-main.mjs'

import { SECRETS, CREDENTIAL_FILENAMES, scanText } from '../lib/secrets.mjs'
export { SECRETS, CREDENTIAL_FILENAMES, scanText }

// ⛔ execFileSync WITH AN ARGUMENT ARRAY, NEVER A SHELL STRING. The first version
// interpolated a filename into `git show :"${f}"`, so a file committed as `a;curl evil`
// would have RUN that. In a tool whose entire job is protecting the repo, a shell
// injection is not an irony, it is the worst possible place for one.
const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 << 20 })
const CAP = 400_000     // read a bounded prefix; a 2GB blob must not take the scan down

export function scanStaged() {
  const files = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR']).trim().split('\n').filter(Boolean)
  const out = []
  for (const f of files) {
    let t = ''
    try { t = git(['show', `:${f}`]).slice(0, CAP) } catch { continue }
    out.push(...scanText(t, f))
  }
  return { out, n: files.length }
}

export function scanAllHistory() {
  const objs = git(['rev-list', '--objects', '--all']).trim().split('\n').filter(Boolean)
  const out = []
  let n = 0
  for (const line of objs) {
    const [sha, path] = line.split(' ')
    if (!path) continue
    let t = ''
    try { t = git(['cat-file', '-p', sha]).slice(0, CAP) } catch { continue }
    n++
    out.push(...scanText(t, path))
  }
  return { out, n }
}

function refuse(found, where) {
  console.error(`\n⛔ REFUSED. ${found.length} possible credential(s) in ${where}:\n`)
  for (const f of found) console.error(`   ${f.path}\n     ${f.what} ${f.sample}`)
  console.error(`
   ⛔ DO NOT "fix" this by deleting the file in the next commit. Once a commit exists it
      is in history, and the moment you push, it is public and scraped within minutes.
      Deleting it later removes it from the working tree and from nothing else.

   Take it out of the commit, put the value in .env, and check .gitignore covers it.
   If it has ALREADY been pushed anywhere: rotate the key. That is the only real fix.\n`)
  process.exit(2)
}

if (isMain(import.meta.url)) {
  const mode = process.argv[2]
  if (mode === '--staged') {
    const { out, n } = scanStaged()
    if (out.length) refuse(out, 'the staged changes')
    console.log(`ok  nothing staged looks like a credential. ${n} file(s) scanned.`)
    process.exit(0)
  }
  if (mode === '--all') {
    const { out, n } = scanAllHistory()
    if (out.length) refuse(out, 'this repository\'s history')
    console.log(`ok  no credential found in history. ${n} blob(s) scanned across every commit.`)
    process.exit(0)
  }
  // PreToolUse: a payload on stdin. Exit 0 on anything unexpected, never block every write.
  const chunks = []
  process.stdin.on('data', c => chunks.push(c))
  process.stdin.on('end', () => {
    let p
    try { p = JSON.parse(Buffer.concat(chunks).toString() || '{}') } catch { process.exit(0) }
    const path = p?.tool_input?.file_path
    const body = p?.tool_input?.content ?? p?.tool_input?.new_string ?? ''
    if (!path) process.exit(0)
    const found = scanText(String(body), path)
    if (!found.length) process.exit(0)
    console.error(
      `⛔ BLOCKED. That write looks like a credential: ${found[0].what} in ${path}.\n\n` +
      `Put the value in .env and read it with process.env. A key committed once is public\n` +
      `the moment this repo is pushed, and deleting it later does not remove it from history.`
    )
    process.exit(2)
  })
}
