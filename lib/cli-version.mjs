import { execFileSync } from 'node:child_process'

const SEMVER = /(\d+)\.(\d+)\.(\d+)/

export function cmpVersion(a, b) {
  const x = SEMVER.exec(String(a ?? '')), y = SEMVER.exec(String(b ?? ''))
  if (!x || !y) return null
  for (let i = 1; i <= 3; i++) if (+x[i] !== +y[i]) return +x[i] < +y[i] ? -1 : 1
  return 0
}

export function versionOfPath(p) {
  const parts = String(p ?? '').split('/').filter(Boolean)
  for (const seg of parts.slice(-2).reverse()) { const m = /^v?(\d+\.\d+\.\d+)$/.exec(seg); if (m) return m[1] }
  return null
}

export function installedClaudeVersion(run = execFileSync) {
  if (process.env.NODE_TEST_CONTEXT && run === execFileSync) return null
  try { return SEMVER.exec(run('claude', ['--version'], { encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'] }))?.[0] ?? null } catch { return null }
}

export function executablesOf(pids, run = execFileSync) {
  const out = new Map()
  const list = [...new Set(pids)].filter((p) => Number.isInteger(p) && p > 0)
  if (!list.length || (process.env.NODE_TEST_CONTEXT && run === execFileSync)) return out
  let text = ''
  try { text = run('lsof', ['-a', '-p', list.join(','), '-d', 'txt', '-Fpn'], { encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'] }) } catch (e) { text = String(e?.stdout ?? '') }
  let pid = null
  for (const line of text.split('\n')) {
    if (line.startsWith('p')) pid = +line.slice(1)
    else if (line.startsWith('n') && pid != null && !out.has(pid) && /(^|\/)(claude|\d+\.\d+\.\d+)$/.test(line)) out.set(pid, line.slice(1))
  }
  return out
}

export function sessionVersion(s, exes = new Map()) {
  if (SEMVER.test(String(s?.version ?? ''))) return SEMVER.exec(String(s.version))[0]
  return versionOfPath(exes.get(s?.pid))
}

export function outdatedOf(items, installed, { exes = null, run } = {}) {
  if (!installed) return []
  const need = items.filter((x) => x.session && !SEMVER.test(String(x.session.version ?? ''))).map((x) => x.session.pid)
  const map = exes ?? (need.length ? executablesOf(need, run) : new Map())
  return items.flatMap((x) => {
    if (!x.session) return []
    const v = sessionVersion(x.session, map)
    return v && cmpVersion(v, installed) < 0 ? [{ ...x, version: v }] : []
  })
}
