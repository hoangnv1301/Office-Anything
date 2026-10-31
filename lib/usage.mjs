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
//
// CATEGORIES (0.22.0): every call also gets a TRIGGER (what started its turn)
// and an ACTION (what the call did), so tokens can be benchmarked by kind of
// work: node lib/usage.mjs [root] --by trigger|action|trigger,action [--json]
// ⛔ PRIVACY: prompt and command text is read in memory ONLY to pick a label.
// Nothing of it is stored, printed or put in the JSON; output is labels and numbers.
// The office adds its own labels in office.json usage.triggers / usage.actions.
import { readdirSync, statSync, createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { join, basename, sep } from 'node:path'
import { homedir } from 'node:os'
import { findOffice, readOfficeConfig } from './office.mjs'
import { isMain } from './is-main.mjs'
import { deskRoots } from './desk.mjs'

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
    else { const r = deskRoots(root).find((x) => folder.startsWith(slugOf(x.dir) + '-')); if (r) who = 'desk ' + folder.slice(slugOf(r.dir).length + 1) }
  }
  return rel.includes('subagents') ? `${who} [subagent]` : who
}

// ---- categories -----------------------------------------------------------
const TRIGGER_HEAD = 300, ACTION_HEAD = 200
const HEARTBEAT = /<<autonomous-loop|<scheduled-task|<cron|Scheduled office job|scheduled[- ]task|\bScheduleWakeup\b|\bCronCreate\b/i
const FIND_CMDS = new Set(['cat', 'head', 'tail', 'grep', 'rg', 'find', 'ls', 'wc'])
const ACTION_RANK = ['edit', 'message', 'agent', 'browser', 'web', 'skill', 'shell', 'find', 'other-tool']

// an office's own rules: [{label, match, tool?}] with a regex string; a bad one is skipped, never fatal
function rules(list) {
  const out = []
  for (const x of Array.isArray(list) ? list : []) {
    if (!x || typeof x.label !== 'string' || !x.label || typeof x.match !== 'string') continue
    try { out.push({ label: x.label, re: new RegExp(x.match), tool: typeof x.tool === 'string' ? x.tool : null }) } catch {}
  }
  return out
}

// the typed text of a user line, or null when it is a tool result (not a new turn)
function userText(j) {
  const c = j.message?.content
  if (typeof c === 'string') return c
  if (!Array.isArray(c)) return null
  const t = c.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n')
  return t || (c.some((b) => b?.type === 'tool_result') ? null : '')
}

export function classifyTrigger(text, { first = false, sidechain = false, custom = [] } = {}) {
  const head = String(text).slice(0, TRIGGER_HEAD)
  for (const r of custom) if (r.re.test(head)) return r.label
  const t = head.trimStart()
  if (/^This session is being continued from|^<command-name>\/compact|^Caveat:.*compact/i.test(t) || /continued from a previous conversation/i.test(head)) return 'compact'
  if (sidechain && first) return 'subagent-brief'
  if (HEARTBEAT.test(head)) return 'heartbeat'
  if (/^<cross-session-message/.test(t)) return 'peer'
  if (/^<task-notification>/.test(t)) return 'task-notice'
  if (t.startsWith('<system-reminder>') && !String(text).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()) return 'hook'
  return 'person'
}

function firstWord(cmd) {
  let c = String(cmd).trim()
  for (let i = 0; i < 4; i++) {   // skip `cd x &&`, VAR=1, rtk / env wrappers
    const m = c.match(/^(?:cd\s+\S+\s*(?:&&|;)\s*|[A-Za-z_][A-Za-z0-9_]*=\S*\s+|rtk\s+|env\s+)/)
    if (!m) break
    c = c.slice(m[0].length)
  }
  const w = c.split(/\s+/)
  return w[0] === 'sed' ? (w[1] === '-n' ? 'sed -n' : 'sed') : w[0].replace(/^.*\//, '')
}

function actionOfTool(b) {
  const n = b.name ?? ''
  if (n === 'Bash') { const w = firstWord(b.input?.command ?? ''); return FIND_CMDS.has(w) || w === 'sed -n' ? 'find' : 'shell' }
  if (['Read', 'Grep', 'Glob', 'LS'].includes(n)) return 'find'
  if (['Edit', 'Write', 'NotebookEdit', 'MultiEdit'].includes(n)) return 'edit'
  if (n.startsWith('mcp__claude-in-chrome__')) return 'browser'
  if (n === 'SendMessage') return 'message'
  if (n === 'Agent' || n === 'Task') return 'agent'
  if (n === 'WebFetch' || n === 'WebSearch') return 'web'
  if (n === 'Skill') return 'skill'
  return 'other-tool'
}

// one assistant call's action: the office's rules first (on a command or skill name, in memory only), then the built-ins
export function classifyAction(blocks, custom = []) {
  if (!blocks.length) return 'reply'
  for (const r of custom) for (const b of blocks) {
    if (r.tool && r.tool !== b.name) continue
    const probe = b.name === 'Bash' ? String(b.input?.command ?? '').slice(0, ACTION_HEAD) : b.name === 'Skill' ? String(b.input?.skill ?? b.input?.name ?? '') : b.name
    if (r.re.test(probe)) return r.label
  }
  const kinds = blocks.map(actionOfTool)
  return ACTION_RANK.find((k) => kinds.includes(k)) ?? 'other-tool'
}

export async function usage({ configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), root = null, hours = 24 * 7, now = Date.now(), cfg = {} } = {}) {
  const projectsDir = join(configDir, 'projects')
  const since = now - hours * 3600e3
  const files = transcripts(projectsDir, since)
  const seen = new Map()   // call id -> its record: later lines of the same call add their tool blocks
  const U0 = cfg.usage && typeof cfg.usage === 'object' ? cfg.usage : {}
  const customT = rules(U0.triggers), customA = rules(U0.actions)
  const by = { folder: {}, model: {}, day: {}, session: {}, trigger: {}, action: {}, pair: {} }
  const rows = new Map()
  const add = (o, k, r, ts) => { const x = (o[k] ??= { calls: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, last: 0 }); x.calls++; x.last = Math.max(x.last, ts); for (const q of ['input', 'cacheWrite', 'cacheRead', 'output']) x[q] += r[q] }
  let calls = 0, opusSub = 0
  const finish = (c) => {
    const { r, ts, model, folder, session, trigger } = c
    const action = classifyAction(c.blocks, customA)
    add(by.folder, folder, r, ts); add(by.model, model, r, ts); add(by.day, new Date(ts).toISOString().slice(0, 10), r, ts); add(by.session, session, r, ts)
    add(by.trigger, trigger, r, ts); add(by.action, action, r, ts); add(by.pair, `${trigger} / ${action}`, r, ts)
    const rk = `${trigger}\u0000${action}\u0000${session}\u0000${model}`
    const row = rows.get(rk) ?? { trigger, action, group: folder, session, model, calls: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, effective: 0 }
    row.calls++; row.input += r.input; row.output += r.output; row.cacheWrite += r.cacheWrite; row.cacheRead += r.cacheRead; row.effective += r.input + r.output + r.cacheWrite
    rows.set(rk, row)
    calls++
    if (folder.endsWith('[subagent]') && /opus/i.test(model)) opusSub++
  }
  for (const f of files) {
    const folder = labelFor(projectsDir, f, root)
    const session = `${folder} ${basename(f, '.jsonl').slice(0, 8)}`
    const inSub = f.split(sep).includes('subagents')
    const streams = new Map()   // stream -> { trigger, users }
    const pending = []
    for await (const line of createInterface({ input: createReadStream(f), crlfDelay: Infinity })) {
      const isUser = line.includes('"type":"user"'), isUsage = line.includes('"usage"')
      if (!isUser && !isUsage) continue
      let j; try { j = JSON.parse(line) } catch { continue }
      const side = inSub || j.isSidechain === true
      const sk = side ? 'side:' + (j.agentId ?? '') : 'main'
      const st = streams.get(sk) ?? (streams.set(sk, { trigger: null, users: 0 }), streams.get(sk))
      if (j.type === 'user' && !j.isMeta) {
        const text = userText(j)
        if (text !== null) {
          st.trigger = j.isCompactSummary ? 'compact' : classifyTrigger(text, { first: st.users === 0, sidechain: side, custom: customT })
          st.users++
        }
        continue
      }
      const u = j.message?.usage
      if (!u) continue
      const ts = Date.parse(j.timestamp ?? '')
      if (!(ts >= since && ts <= now)) continue
      const blocks = Array.isArray(j.message.content) ? j.message.content.filter((b) => b?.type === 'tool_use').map((b) => ({ name: String(b.name ?? ''), input: b.name === 'Bash' ? { command: String(b.input?.command ?? '').slice(0, ACTION_HEAD) } : b.name === 'Skill' ? { skill: String(b.input?.skill ?? b.input?.name ?? '') } : {} })) : []
      const id = `${j.message.id ?? ''}:${j.requestId ?? ''}`
      if (id !== ':') { const prev = seen.get(id); if (prev) { prev.blocks.push(...blocks); continue } }
      const r = { input: u.input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, output: u.output_tokens ?? 0 }
      const c = { r, ts, model: j.message.model ?? '?', folder, session, trigger: st.trigger ?? (side ? 'subagent-brief' : 'unknown'), blocks }
      if (id !== ':') seen.set(id, c)
      pending.push(c)
    }
    for (const c of pending) finish(c)
    // the text-bearing blocks of this file are dropped here; only labels and numbers outlive it
    for (const c of pending) c.blocks = []
  }
  const U = U0
  const maxCtx = Number(U.maxContextPerCall) || 300_000
  const maxOpus = Number(U.maxOpusSubagentPct) || 20
  const warnings = []
  for (const [k, x] of Object.entries(by.session)) {
    const avg = x.cacheRead / x.calls
    // only a session still working (a call in the last 3 h) can be restarted
    if (x.calls >= 5 && avg > maxCtx && now - x.last < 3 * 3600e3) warnings.push(`session ${k} averages ${Math.round(avg / 1000)}K context per call over ${x.calls} calls (limit ${Math.round(maxCtx / 1000)}K): restart it`)
  }
  if (calls && (opusSub / calls) * 100 > maxOpus) warnings.push(`Opus subagents made ${opusSub} of ${calls} calls (${Math.round((opusSub / calls) * 100)}%, limit ${maxOpus}%): use a smaller model for subagents`)
  return { files: files.length, calls, by, rows: [...rows.values()], warnings }
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

// category tables: biggest share of effective tokens (input+output+cacheWrite) first, with cache-read share beside it
export function renderBy(r, hours, dims) {
  const out = [`usage by ${dims.join(' + ')} over the last ${hours % 24 || hours < 48 ? hours + ' h' : hours / 24 + ' days'}: ${r.calls} calls in ${r.files} transcripts`]
  const o = dims.length === 2 ? r.by.pair : r.by[dims[0]]
  const eff = (x) => x.input + x.output + x.cacheWrite
  const totE = Object.values(o).reduce((a, x) => a + eff(x), 0) || 1, totC = Object.values(o).reduce((a, x) => a + x.cacheRead, 0) || 1
  const pct = (n) => (n * 100).toFixed(1) + '%'
  out.push('', `${'category'.padEnd(34)} ${'calls'.padStart(6)}  ${'effective'.padStart(9)} ${'share'.padStart(6)}  ${'cache-read'.padStart(10)} ${'share'.padStart(6)}`)
  for (const [k, x] of Object.entries(o).sort((a, b) => eff(b[1]) - eff(a[1]))) out.push(`${(k.length > 34 ? '…' + k.slice(-33) : k).padEnd(34)} ${String(x.calls).padStart(6)}  ${M(eff(x)).padStart(9)} ${pct(eff(x) / totE).padStart(6)}  ${M(x.cacheRead).padStart(10)} ${pct(x.cacheRead / totC).padStart(6)}`)
  return out.join('\n')
}

if (isMain(import.meta.url)) {
  const a = process.argv.slice(2)
  const flag = (n) => { const i = a.indexOf(n); if (i < 0) return null; const v = Number(a[i + 1]); a.splice(i, 2); return v > 0 ? v : NaN }
  const word = (n) => { const i = a.indexOf(n); if (i < 0) return null; const v = a[i + 1]; a.splice(i, 2); return v ?? '' }
  const days = flag('--days'), hrs = flag('--hours')
  const by = word('--by'), json = a.includes('--json'); if (json) a.splice(a.indexOf('--json'), 1)
  const dims = by === null ? null : by.split(',').map((x) => x.trim())
  const okBy = dims === null || (dims.length <= 2 && dims.every((d) => d === 'trigger' || d === 'action') && new Set(dims).size === dims.length && (dims.length < 2 || dims[0] === 'trigger'))
  if (Number.isNaN(days) || Number.isNaN(hrs) || !okBy) { console.error('usage: node lib/usage.mjs [root] [--days N | --hours N] [--by trigger|action|trigger,action] [--json]'); process.exit(1) }
  const hours = hrs ?? (days ?? 7) * 24
  const root = findOffice(a[0] ?? process.cwd())
  const r = await usage({ root, hours, cfg: root ? readOfficeConfig(root) : {} })
  if (json) console.log(JSON.stringify({ hours, calls: r.calls, files: r.files, rows: r.rows.sort((x, y) => y.effective - x.effective) }))
  else console.log(dims ? renderBy(r, hours, dims) : render(r, hours))
}
