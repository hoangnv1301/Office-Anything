// THE PLUGIN'S VERSION, SAID PLAINLY: what this machine loaded, what the
// office approved, and the latest release. `node lib/status.mjs [root]`.
// A release that cannot be fetched is "unknown", never "up to date".
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readOfficeConfig, findOffice } from './office.mjs'
import { loadedVersion, versionVerdict } from './version.mjs'
import { isMain } from './is-main.mjs'

const repoOf = () => {
  try { return String(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.claude-plugin', 'plugin.json'), 'utf8')).repository ?? '') } catch { return '' }
}
export async function latestRelease({ repo = repoOf(), timeoutMs = 4000 } = {}) {
  const m = /github\.com\/([^/]+\/[^/#?]+)/.exec(repo)
  if (!m) throw new Error('no GitHub repository in plugin.json')
  const r = await fetch(`https://api.github.com/repos/${m[1].replace(/\.git$/, '')}/releases/latest`, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/vnd.github+json' } })
  if (!r.ok) throw new Error(`GitHub answered ${r.status}`)
  return String((await r.json()).tag_name ?? '').replace(/^v/, '') || null
}

export async function pluginStatus(root, { fetchLatest = latestRelease } = {}) {
  const cfg = root ? readOfficeConfig(root) : {}
  const loaded = loadedVersion()
  const v = versionVerdict(cfg, loaded)
  let latest = null
  try { latest = await fetchLatest() } catch {}
  const approvedTxt = v ? (v.ok ? `approved (${v.approved.join(', ')})` : `NOT approved (approved: ${v.approved.join(', ')}${v.enforce ? '; desks are refused' : '; alert only'})`) : 'no approved list in office.json'
  return {
    loaded, approved: v?.approved ?? null, approvedOk: v ? v.ok : null, enforce: v?.enforce ?? false, latest,
    line: `office-anything: loaded ${loaded ?? 'unknown'} · ${approvedTxt} · latest release ${latest ?? 'unknown'}`,
  }
}

if (isMain(import.meta.url)) {
  const root = findOffice(process.argv[2] ?? process.cwd())
  const s = await pluginStatus(root)
  console.log(s.line)
  process.exit(s.approvedOk === false ? 4 : 0)
}
