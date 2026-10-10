// WHERE THE TOKENS WENT, with no model in the loop.
//
//   node lib/usage.mjs [root] [--days N | --hours N]
//
// Reads Claude Code's own transcripts (<config>/projects/**/*.jsonl), counts
// each API call once (message.id + requestId: a call is written to more than
// one line), and reports by session folder (lead, desk, subagent), by model
// and by day: calls, cache-write, cache-read, output, and the AVERAGE CONTEXT
// PER CALL (cache-read / calls). That last number is what a long session
// costs on every turn, so it gets a plain warning:
// - a session averaging over usage.maxContextPerCall (300K) per call: restart it
// - Opus subagents over usage.maxOpusSubagentPct (20) % of all calls
import { readdirSync, statSync, createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { join, basename, sep } from 'node:path'
import { homedir } from 'node:os'
import { findOffice, readOfficeConfig } from './office.mjs'
import { isMain } from './is-main.mjs'

const slugOf = (dir) => String(dir).replace(/[^A-Za-z0-9]/g, '-')

function transcripts(dir, since, depth = 0, out = []) {
  let entries = []
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { if (depth < 4) transcripts(p, since, depth + 1, out) }
    else if (e.name.endsWith('.jsonl')) { try { if (statSync(p).mtimeMs >= since) out.push(p) } catch {} }
  }
  return out
}

// who a transcript belongs to: the office's lead, one of its desks, or another folder
export function labelFor(projectsDir, file, root = null) {
  const rel = file.slice(projectsDir.length + 1).split(sep)
  const folder = rel[0]
  let who = folder
  if (root) {
    if (folder === slugOf(root)) who = 'lead'
    else if (folder.startsWith(slugOf(join(root, 'desks')) + '-')) who = 'desk ' + folder.slice(slugOf(join(root, 'desks')).length + 1)
  }
  return rel.includes('subagents') ? `${who} [subagent]` : who
}

export async function usage({ configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), root = null, hours = 24 * 7, now = Date.now(), cfg = {} } = {}) {
  const projectsDir = join(configDir, 'projects')
  const since = now - hours * 3600e3
  const files = transcripts(projectsDir, since)
  const seen = new Set()
  const by = { folder: {}, model: {}, day: {}, session: {} }
  const add = (o, k, r, ts) => { const x = (o[k] ??= { calls: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, last: 0 }); x.calls++; x.last = Math.max(x.last, ts); for (const q of ['input', 'cacheWrite', 'cacheRead', 'output']) x[q] += r[q] }
  let calls = 0, opusSub = 0
  for (const f of files) {
    const folder = labelFor(projectsDir, f, root)
    const session = `${folder} ${basename(f, '.jsonl').slice(0, 8)}`
    for await (const line of createInterface({ input: createReadStream(f), crlfDelay: Infinity })) {
      if (!line.includes('"usage"')) continue
      let j; try { j = JSON.parse(line) } catch { continue }
      const u = j.message?.usage
      if (!u) continue
      const ts = Date.parse(j.timestamp ?? '')
      if (!(ts >= since && ts <= now)) continue
      const id = `${j.message.id ?? ''}:${j.requestId ?? ''}`
      if (id !== ':') { if (seen.has(id)) continue; seen.add(id) }
      const r = { input: u.input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, output: u.output_tokens ?? 0 }
      const model = j.message.model ?? '?'
      add(by.folder, folder, r, ts); add(by.model, model, r, ts); add(by.day, new Date(ts).toISOString().slice(0, 10), r, ts); add(by.session, session, r, ts)
      calls++
      if (folder.endsWith('[subagent]') && /opus/i.test(model)) opusSub++
    }
  }
  const U = cfg.usage && typeof cfg.usage === 'object' ? cfg.usage : {}
  const maxCtx = Number(U.maxContextPerCall) || 300_000
  const maxOpus = Number(U.maxOpusSubagentPct) || 20
  const warnings = []
  for (const [k, x] of Object.entries(by.session)) {
    const avg = x.cacheRead / x.calls
    // only a session still working (a call in the last 3 h) can be restarted
    if (x.calls >= 5 && avg > maxCtx && now - x.last < 3 * 3600e3) warnings.push(`session ${k} averages ${Math.round(avg / 1000)}K context per call over ${x.calls} calls (limit ${Math.round(maxCtx / 1000)}K): restart it`)
  }
  if (calls && (opusSub / calls) * 100 > maxOpus) warnings.push(`Opus subagents made ${opusSub} of ${calls} calls (${Math.round((opusSub / calls) * 100)}%, limit ${maxOpus}%): use a smaller model for subagents`)
  return { files: files.length, calls, by, warnings }
}

const M = (x) => (x / 1e6).toFixed(1) + 'M'
export function render(r, hours) {
  const out = [`usage over the last ${hours % 24 || hours < 48 ? hours + ' h' : hours / 24 + ' days'}: ${r.calls} calls in ${r.files} transcripts`]
  const table = (title, o, sortKey) => {
    out.push('', `== ${title}`)
    const rows = Object.entries(o).sort(sortKey ?? ((a, b) => (b[1].cacheRead + b[1].cacheWrite) - (a[1].cacheRead + a[1].cacheWrite)))
    // a long folder name differs at its end
    for (const [k, x] of rows) out.push(`${(k.length > 44 ? '…' + k.slice(-43) : k).padEnd(44)} calls ${String(x.calls).padStart(6)}  cache-write ${M(x.cacheWrite).padStart(7)}  cache-read ${M(x.cacheRead).padStart(8)}  out ${M(x.output).padStart(6)}  avg ctx/call ${(Math.round(x.cacheRead / x.calls / 1000) + 'K').padStart(6)}`)
  }
  table('by session folder', r.by.folder); table('by model', r.by.model); table('by day', r.by.day, (a, b) => a[0].localeCompare(b[0]))
  for (const w of r.warnings) out.push('', `⚠ ${w}`)
  return out.join('\n')
}

if (isMain(import.meta.url)) {
  const a = process.argv.slice(2)
  const flag = (n) => { const i = a.indexOf(n); if (i < 0) return null; const v = Number(a[i + 1]); a.splice(i, 2); return v > 0 ? v : NaN }
  const days = flag('--days'), hrs = flag('--hours')
  if (Number.isNaN(days) || Number.isNaN(hrs)) { console.error('usage: node lib/usage.mjs [root] [--days N | --hours N]'); process.exit(1) }
  const hours = hrs ?? (days ?? 7) * 24
  const root = findOffice(a[0] ?? process.cwd())
  const r = await usage({ root, hours, cfg: root ? readOfficeConfig(root) : {} })
  console.log(render(r, hours))
}
