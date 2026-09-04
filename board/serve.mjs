#!/usr/bin/env node
// THE BOARD. One read-only page: the office, from what Claude Code already
// knows. Loopback only, no state, re-gathered on every request.
//
//   node board/serve.mjs [root] [--port 7719]
//
// ⛔ THIS EXISTS BY OWNER'S RULING, 2026-09-02, overturning "no UI, no server".
// What survives from that doctrine is its reason: the board must never know
// something `node checks/run.mjs` does not. So it renders collect() and the
// same native sources, and it can be wrong about nothing on its own.
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { gatherOffice, slugFor } from './read.mjs'
import { newestSession, chatFrom, readTail, pendingAsk } from './transcript.mjs'
import { subagentsOf, jobsOf } from './read.mjs'
import { transcriptStats, worktop, filesUnder, treeOf } from './read.mjs'
import { basename } from 'node:path'
import { send, orcaAvailable, normalizeTitle, terminalFor, keepTerminalsWarm } from './send.mjs'
import { execFileSync, execFile } from 'node:child_process'

// ⛔ ONLINE MEANS A LIVE TERMINAL, not "spoke recently". A desk sitting
// quietly at its pane is online; the activity dot said otherwise and the
// whole office read as absent. orca owns terminal truth; cached 5s so nine
// rows cost one call. No orca -> null, and the UI falls back honestly.
let termCache = { at: 0, titles: null }
function liveTitles() {
  if (Date.now() - termCache.at < 5000) return termCache.titles
  try {
    const out = execFileSync('orca', ['terminal', 'list', '--json'], { encoding: 'utf8', timeout: 4000 })
    termCache = { at: Date.now(), titles: new Set((JSON.parse(out)?.result?.terminals ?? []).map((t) => normalizeTitle(t.title))) }
  } catch { termCache = { at: Date.now(), titles: null } }
  return termCache.titles
}
import { screenshotOf } from '../lib/cdp.mjs'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, watch } from 'node:fs'
import { rosterSafe, leadDesk } from '../lib/desk.mjs'
import { hire } from '../lib/hire.mjs'
import { costOf } from '../lib/rates.mjs'
import { collect } from '../checks/run.mjs'
import { isMain } from '../lib/is-main.mjs'

// The chat's session list: every desk plus the LEAD, whose desk is the repo
// root. key = the cwd slug, which is how Claude Code files both the
// transcript and the scratchpad.
export function chatRosterCheap(root) {
  const { desks } = rosterSafe(join(root, 'desks'))
  let lead = null
  try { lead = leadDesk(root) } catch { lead = null }
  return [
    { key: slugFor(root), label: lead?.name ?? 'team-lead', desk: lead?.name ?? 'team-lead', port: lead?.port },
    ...desks.map((d) => ({ key: slugFor(join(root, 'desks', d.name)), label: d.name, desk: d.name, port: d.port })),
  ]
}

export function chatRoster(root, { home = homedir(), now = Date.now() } = {}) {
  const { desks } = rosterSafe(join(root, 'desks'))
  const rows = [
    { key: slugFor(root), label: 'team-lead', sub: 'the repo root · this machine\'s lead session', desk: 'team-lead' },
    ...desks.map((d) => ({ key: slugFor(join(root, 'desks', d.name)), label: d.name, sub: d.kind + (d.live ? ' · LIVE' : ''), desk: d.name, port: d.port, kind: d.kind })),
  ]
  for (const r of rows) {
    const dir = join(home, '.claude', 'projects', r.key)
    const t = newestSession(dir)
    r.activeMin = t ? Math.round((now - (statSafe(t))) / 60000) : null
    r.agents = t ? subagentsOf(dir, t) : []
    r.jobs = jobsOf(join('/private/tmp', 'claude-' + process.getuid(), r.key))
    const st = transcriptStats(join(home, '.claude', 'projects', r.key))
    let lastMsg = null, tp = null
    try { tp = t ? readTail(t) : null; r.waiting = !!(tp && pendingAsk(tp.messages)); lastMsg = tp?.messages?.at(-1) ?? null } catch { r.waiting = false }
    // a background job's NAME lives in the tool call that spawned it: the
    // result names the id, the input carries the human description
    if (r.jobs?.length && tp) {
      for (const j of r.jobs) {
        outer: for (const m of tp.messages) for (const tl of m.tools ?? []) {
          if (tl.output && j.id && tl.output.includes(j.id)) {
            const inp = tl.input ?? {}
            j.label = String(inp.description ?? inp.prompt ?? inp.command ?? '').slice(0, 70)
            break outer
          }
        }
      }
    }
    const titles = liveTitles()
    r.online = titles ? (titles.has(r.desk) || r.desk === 'team-lead') : null
    // WORKING, from the source that cannot lie about it: Claude Code appends
    // to the transcript every few seconds mid-turn. The tab glyph looked like
    // a spinner and is in fact a permanent marker; mtime is the honest pulse.
    // ⛔ A finished turn ENDS with plain assistant text; mid-turn entries end
    // with a tool call or a result. Without this, "working" outlived every
    // turn by the whole mtime window and the owner watched a done desk brew.
    const endedOnText = lastMsg?.role === 'assistant' && !(lastMsg.tools?.length)
    r.busy = t ? ((now - statSafe(t)) < 45000 && !endedOnText) : null
    if (st) {
      const k = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n)
      r.sub += ' · ' + st.turns + ' turns · ' + k(st.input + st.cacheRead) + '/' + k(st.output) + ' tok'
    }
  }
  return rows
}
import { statSync } from 'node:fs'
const statSafe = (p) => { try { return statSync(p).mtimeMs } catch { return 0 } }

const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }

export function makeServer(root) {
  if (!globalThis.__oaWarmer && orcaAvailable()) globalThis.__oaWarmer = keepTerminalsWarm()
  return createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    try {
      // ⛔ CHAT IS THE FRONT DOOR, owner's ruling — and it is the REAL
      // component build (shadcn/ui + AI Elements), compiled once by the
      // maintainer and shipped as static files in board/ui/dist. Users build
      // nothing; this server only hands the files over.
      if (url.pathname === '/' || url.pathname === '/chat') {
        try {
          // no-store: an open tab must not keep yesterday's UI after an update
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
          return res.end(readFileSync(new URL('./ui/dist/index.html', import.meta.url)))
        } catch {
          res.writeHead(503, { 'content-type': 'text/plain' })
          return res.end('board UI not built: run `npm run build` in board/ui (maintainers only; releases ship it prebuilt)')
        }
      }
      if (url.pathname === '/api/version') {
        // the tab heals itself: the client compares this to what it booted
        // with and reloads when the board has shipped underneath it
        let builtAt = 0
        try { builtAt = statSafe(fileURLToPath(new URL('./ui/dist/index.html', import.meta.url))) } catch {}
        let version = 'unknown'
        try { version = JSON.parse(readFileSync(fileURLToPath(new URL('../.claude-plugin/plugin.json', import.meta.url)), 'utf8')).version } catch {}
        return json(res, 200, { version, builtAt })
      }
      if (url.pathname === '/hello') {
        // a desk browser's START page: says whose it is and that it is ready,
        // so a wall of open Chromes stops reading as "what even runs here"
        const who = (url.searchParams.get('desk') ?? 'a desk').replace(/[^a-zA-Z0-9 _.-]/g, '').slice(0, 60)
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        return res.end(`<!doctype html><meta charset="utf-8"><title>${who} · the office</title>
<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0a;color:#fafafa;font-family:system-ui">
<div style="text-align:center"><div style="font-size:44px">🏢</div>
<div style="font-size:22px;font-weight:600;margin-top:8px">${who}</div>
<div style="color:#8a8a8a;margin-top:6px;font-size:14px">browser ready · watched from the office board</div></div></body>`)
      }
      if (url.pathname === '/api/key' && req.method === 'POST') {
        // one named keystroke, straight into the desk's pty. Shift-Tab is
        // how the CLI cycles permission modes; the record does not carry the
        // resulting mode, so this is fire-and-observe-in-terminal, said so.
        let body = ''
        req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy() })
        req.on('end', () => {
          try {
            const { key, k } = JSON.parse(body)
            const KEYS = { 'shift-tab': '[Z', escape: '' }
            if (!KEYS[k]) return json(res, 400, { ok: false, why: 'unknown key' })
            const row = chatRosterCheap(root).find((r) => r.key === key)
            if (!row) return json(res, 404, { ok: false, why: 'unknown desk' })
            const deskDir = row.key === slugFor(root) ? root : join(root, 'desks', row.desk)
            const handle = terminalFor(row.desk, undefined, deskDir)
            if (!handle) return json(res, 200, { ok: false, why: 'no live terminal for this desk' })
            execFile('orca', ['terminal', 'send', '--terminal', handle, '--text', KEYS[k], '--json'], { timeout: 15000 }, () => {})
            return json(res, 200, { ok: true, sent: k })
          } catch (e) { return json(res, 500, { ok: false, why: e.message }) }
        })
        return
      }
      if (url.pathname === '/api/upgrade-plugin' && req.method === 'POST') {
        // this plugin's own update, through the CLI that owns the cache. The
        // board serving this page keeps running its current code until its
        // next start, and the reply says so.
        execFile('claude', ['plugin', 'update', 'office-anything'], { timeout: 180000, encoding: 'utf8' }, (e, out, err) => {
          const text = String(out || err || '').trim().split('\n').filter(Boolean).at(-1) ?? ''
          json(res, 200, { ok: !e, note: (text || (e ? String(e.message) : 'updated')).slice(0, 240) + (e ? '' : ' — the board picks it up on its next start') })
        })
        return
      }
      if (url.pathname === '/api/upgrade' && req.method === 'POST') {
        // `claude update`, run by the board, versions before and after. It
        // updates the INSTALL; running sessions keep their version until
        // they restart, and the reply says so rather than implying magic.
        execFile('claude', ['--version'], { timeout: 15000 }, (e1, before) => {
          execFile('claude', ['update'], { timeout: 180000 }, (e2, out, err) => {
            execFile('claude', ['--version'], { timeout: 15000 }, (e3, after) => {
              json(res, 200, {
                ok: !e2,
                before: String(before ?? '').trim(),
                after: String(after ?? '').trim(),
                note: e2 ? String(err ?? e2.message).slice(0, 300) : 'running sessions keep their version until restarted',
              })
            })
          })
        })
        return
      }
      if (url.pathname === '/api/heartbeat') {
        // an office that keeps itself alive (a keeper, loops, a daemon) may say
        // HOW to ask: desk.json at the root, "heartbeat": "<command>". The board
        // runs it, reports the exit code and the last line, cached 20s. No
        // heartbeat declared: honest null, never a green light nobody earned.
        let lead = null
        try { lead = leadDesk(root) } catch { lead = null }
        const cmd = lead?.heartbeat
        if (!cmd || typeof cmd !== 'string') return json(res, 200, { declared: false })
        const now = Date.now()
        if (globalThis.__oaBeat && now - globalThis.__oaBeat.at < 20000) return json(res, 200, globalThis.__oaBeat.out)
        execFile('/bin/sh', ['-c', cmd], { cwd: root, timeout: 20000, encoding: 'utf8' }, (e, stdout, stderr) => {
          const text = String(stdout || stderr || '').trim()
          const lines = text.split('\n').filter(Boolean)
          const out = { declared: true, ok: !e, code: e?.code ?? 0, last: lines.at(-1) ?? '', lines: lines.slice(-12), at: now }
          globalThis.__oaBeat = { at: now, out }
          json(res, 200, out)
        })
        return
      }
      if (url.pathname === '/api/agents' || url.pathname === '/api/skills') {
        // the desk's .claude, DISPLAYED: agents (frontmatter name/model/effort/
        // description) and skills + commands (name/description), from the same
        // places Claude Code loads them - the desk, the office root, the user,
        // every installed plugin. Nothing invented; the files are the truth.
        const key = url.searchParams.get('key') ?? ''
        const row = chatRosterCheap(root).find((r) => r.key === key)
        if (!row) return json(res, 404, { items: [] })
        const deskDir = row.key === slugFor(root) ? root : join(root, 'desks', row.desk)
        const fm = (file) => {
          try {
            const t = readFileSync(file, 'utf8').slice(0, 4000)
            const g = (k) => {
              const m = t.match(new RegExp('^' + k + ':[ \\t]*(.*)$', 'm'))
              if (!m) return ''
              let v = m[1].trim()
              // YAML folded/literal scalars (>- | >) put the text on the indented lines below
              if (/^[>|]-?$/.test(v)) {
                const after = t.slice(m.index + m[0].length).split('\n')
                const body = []
                for (const ln of after) { if (/^\s+\S/.test(ln)) body.push(ln.trim()); else if (body.length) break }
                v = body.join(' ')
              }
              return v.replace(/^["']|["']$/g, '')
            }
            return { name: g('name'), description: g('description').slice(0, 160), model: g('model'), effort: g('effort') }
          } catch { return null }
        }
        const items = []
        const agentsIn = (d, source) => { try { for (const f of readdirSync(d)) if (f.endsWith('.md')) { const m = fm(join(d, f)); if (m) items.push({ name: m.name || f.replace(/\.md$/, ''), description: m.description, model: m.model, effort: m.effort, source }) } } catch {} }
        const skillsIn = (d, source) => { try { for (const f of readdirSync(d)) { const m = fm(join(d, f, 'SKILL.md')); if (m) items.push({ name: '/' + (m.name || f), description: m.description, kind: 'skill', source }) } } catch {} }
        const commandsIn = (d, source) => { try { for (const f of readdirSync(d)) if (f.endsWith('.md')) { const m = fm(join(d, f)); items.push({ name: '/' + f.replace(/\.md$/, ''), description: m?.description ?? '', kind: 'command', source }) } } catch {} }
        const plugins = []
        try {
          const cache = join(homedir(), '.claude', 'plugins', 'cache')
          for (const mkt of readdirSync(cache)) for (const plug of readdirSync(join(cache, mkt))) {
            try { const vers = readdirSync(join(cache, mkt, plug)).sort().reverse(); if (vers.length) plugins.push([plug, join(cache, mkt, plug, vers[0])]) } catch {}
          }
        } catch {}
        if (url.pathname === '/api/agents') {
          agentsIn(join(deskDir, '.claude', 'agents'), 'this desk')
          if (deskDir !== root) agentsIn(join(root, '.claude', 'agents'), 'the office')
          agentsIn(join(homedir(), '.claude', 'agents'), 'user')
          for (const [plug, base] of plugins) agentsIn(join(base, 'agents'), 'plugin: ' + plug)
        } else {
          skillsIn(join(deskDir, '.claude', 'skills'), 'this desk'); commandsIn(join(deskDir, '.claude', 'commands'), 'this desk')
          if (deskDir !== root) { skillsIn(join(root, '.claude', 'skills'), 'the office'); commandsIn(join(root, '.claude', 'commands'), 'the office') }
          skillsIn(join(homedir(), '.claude', 'skills'), 'user'); commandsIn(join(homedir(), '.claude', 'commands'), 'user')
          for (const [plug, base] of plugins) { skillsIn(join(base, 'skills'), 'plugin: ' + plug); commandsIn(join(base, 'commands'), 'plugin: ' + plug) }
        }
        return json(res, 200, { items })
      }
      if (url.pathname === '/api/checks') {
        // the plugin's own structural checks, run live against this office:
        // 0 = pass, 4 = fail, 7 = unknown (an empty walk is never clean)
        const c = collect(root)
        return json(res, 200, {
          code: c.code,
          rows: c.rows.map((r) => ({ name: r.name, answers: r.answers ?? '', code: r.code, why: r.why ?? '', applicable: r.applicable !== false })),
        })
      }
      if (url.pathname === '/api/hooks') {
        // every hook that can actually fire on this desk, from the three
        // places Claude Code reads them: the desk's project settings, the
        // user's settings, and each installed plugin's hooks.json
        const key = url.searchParams.get('key') ?? ''
        const row = chatRosterCheap(root).find((r) => r.key === key)
        if (!row) return json(res, 404, { hooks: [] })
        const deskDir = row.key === slugFor(root) ? root : join(root, 'desks', row.desk)
        const out = []
        const collect = (file, source) => {
          try {
            const h = JSON.parse(readFileSync(file, 'utf8')).hooks ?? {}
            for (const [event, arr] of Object.entries(h)) for (const m of arr ?? []) {
              for (const hk of m.hooks ?? []) out.push({ source, event, matcher: m.matcher ?? '*', command: String(hk.command ?? hk.type ?? '').slice(0, 200) })
            }
          } catch {}
        }
        collect(join(deskDir, '.claude', 'settings.json'), 'project')
        collect(join(deskDir, '.claude', 'settings.local.json'), 'project (local)')
        collect(join(homedir(), '.claude', 'settings.json'), 'user')
        try {
          const cache = join(homedir(), '.claude', 'plugins', 'cache')
          for (const mkt of readdirSync(cache)) for (const plug of readdirSync(join(cache, mkt))) {
            try {
              const vers = readdirSync(join(cache, mkt, plug)).sort().reverse()
              if (vers.length) collect(join(cache, mkt, plug, vers[0], 'hooks', 'hooks.json'), 'plugin: ' + plug)
            } catch {}
          }
        } catch {}
        return json(res, 200, { hooks: out })
      }
      if (url.pathname === '/api/events') {
        // PUSH, NOT POLL: the transcript directory is watched and every write
        // becomes one SSE tick, so the client refetches the moment Claude
        // writes instead of on a polling beat. Polling stays as the fallback.
        const key = url.searchParams.get('key') ?? ''
        if (!/^[A-Za-z0-9-]+$/.test(key)) { res.writeHead(400); return res.end() }
        res.writeHead(200, {
          'content-type': 'text/event-stream', 'cache-control': 'no-store',
          connection: 'keep-alive', 'x-accel-buffering': 'no',
        })
        res.write(':ok\n\n')
        let timer = null
        let watcher = null
        try {
          watcher = watch(join(homedir(), '.claude', 'projects', key), () => {
            // debounced: a burst of appends becomes one tick
            if (timer) return
            timer = setTimeout(() => { timer = null; try { res.write('data: tick\n\n') } catch {} }, 120)
          })
        } catch { /* no directory yet: heartbeats only, the client keeps polling */ }
        const beat = setInterval(() => { try { res.write(':beat\n\n') } catch {} }, 25000)
        req.on('close', () => { clearInterval(beat); if (timer) clearTimeout(timer); try { watcher?.close() } catch {} })
        return
      }
      if (url.pathname === '/api/tabs') {
        // every page the desk's browser has open, for the mirror's tab strip
        const key = url.searchParams.get('key') ?? ''
        const row = chatRosterCheap(root).find((r) => r.key === key)
        if (!row?.port || row.port === 9222) { res.writeHead(204); return res.end() }
        return fetch(`http://127.0.0.1:${row.port}/json/list`).then(async (r2) => {
          const tabs = (await r2.json()).filter((t) => t.type === 'page')
            .map((t) => ({ id: t.id, title: t.title, url: t.url }))
          return json(res, 200, { tabs })
        }).catch(() => { res.writeHead(204); res.end() })
      }
      if (url.pathname === '/favicon.svg' || url.pathname === '/icons.svg') {
        try {
          res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=3600' })
          return res.end(readFileSync(new URL('./ui/dist' + url.pathname, import.meta.url)))
        } catch { res.writeHead(404); return res.end() }
      }
      if (url.pathname.startsWith('/assets/') && !url.pathname.includes('..')) {
        try {
          const type = url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : url.pathname.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream'
          res.writeHead(200, { 'content-type': type + '; charset=utf-8', 'cache-control': 'max-age=3600' })
          return res.end(readFileSync(new URL('./ui/dist' + url.pathname, import.meta.url)))
        } catch { res.writeHead(404); return res.end() }
      }
      if (url.pathname !== '/board' && url.pathname.startsWith('/api/') === false && url.pathname !== '/') {
        // unknown paths fall through to the table only from /board; anything
        // else is a 404 rather than a surprise page
      }
      if (url.pathname === '/api/wsfile') {
        // Open a file FROM THE TREE THE PAGE IS SHOWING — never outside it.
        const key = url.searchParams.get('key') ?? ''
        const rel = url.searchParams.get('path') ?? ''
        const row = chatRoster(root).find((r) => r.key === key)
        if (!row || rel.includes('..')) { res.writeHead(403); return res.end() }
        const base = row.desk === 'team-lead' ? root : join(root, 'desks', row.desk)
        const p = join(base, rel)
        if (!p.startsWith(base)) { res.writeHead(403); return res.end() }
        try {
          const buf = readFileSync(p)
          const ext = (rel.match(/\.([a-z0-9]+)$/i) ?? [])[1]?.toLowerCase() ?? ''
          if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
            const type = ext === 'svg' ? 'image/svg+xml' : ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
            res.writeHead(200, { 'content-type': type }); return res.end(buf)
          }
          if (buf.length > 2_000_000) return json(res, 200, { kind: 'big', size: buf.length })
          if (buf.includes(0)) return json(res, 200, { kind: 'binary', size: buf.length })
          return json(res, 200, { kind: ext === 'md' ? 'markdown' : 'text', content: buf.toString('utf8') })
        } catch { res.writeHead(404); return res.end() }
      }
      if (url.pathname === '/api/imgfile') {
        // Images the transcript references by PATH (terminal pastes land in the
        // OS temp tree). Loopback page, but still: temp locations only, image
        // extensions only, size-capped, no traversal.
        const p = url.searchParams.get('p') ?? ''
        const okRoot = p.startsWith('/var/folders/') || p.startsWith('/private/tmp/') || p.startsWith('/tmp/')
        const ext = (p.match(/\.(png|jpe?g|gif|webp)$/i) ?? [])[1]?.toLowerCase()
        if (!okRoot || !ext || p.includes('..')) { res.writeHead(403); return res.end() }
        try {
          const buf = readFileSync(p)
          if (buf.length > 12_000_000) { res.writeHead(413); return res.end() }
          const type = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
          res.writeHead(200, { 'content-type': type, 'cache-control': 'max-age=3600' })
          return res.end(buf)
        } catch { res.writeHead(404); return res.end() }
      }
      if (url.pathname === '/api/upload' && req.method === 'POST') {
        let body = ''
        req.on('data', (c) => { body += c; if (body.length > 16_000_000) req.destroy() })
        req.on('end', () => {
          try {
            const { key, name, data } = JSON.parse(body)
            if (!/^[A-Za-z0-9-]+$/.test(key ?? '') || !/^[\w.-]{1,120}$/.test(name ?? '')) return json(res, 400, { ok: false, why: 'bad key or name' })
            const t = newestSession(join(homedir(), '.claude', 'projects', key))
            if (!t) return json(res, 404, { ok: false, why: 'no session for that desk' })
            const dir = join('/private/tmp', 'claude-' + process.getuid(), key, basename(t, '.jsonl'), 'scratchpad', 'uploads')
            mkdirSync(dir, { recursive: true })
            const p = join(dir, Date.now() + '-' + name)
            writeFileSync(p, Buffer.from(String(data).replace(/^data:[^,]*,/, ''), 'base64'))
            return json(res, 200, { ok: true, path: p })
          } catch (e) { return json(res, 500, { ok: false, why: e.message }) }
        })
        return
      }
      if (url.pathname === '/api/commands') {
        // The desk's real slash commands, from the same places Claude Code
        // reads them: the repo's and the user's .claude, and this plugin's own.
        const found = new Map() // name -> description ('' when none)
        const descOf = (p) => {
          try { return readFileSync(p, 'utf8').slice(0, 2000).match(/^description:\s*(.+)$/m)?.[1]?.trim().slice(0, 120) ?? '' } catch { return '' }
        }
        const names = { add: (n, d = '') => { if (!found.has(n) || d) found.set(n, d || found.get(n) || '') } }
        const scan = (d) => {
          try { for (const f of readdirSync(d)) if (f.endsWith('.md')) names.add('/' + f.replace(/\.md$/, ''), descOf(join(d, f))) } catch {}
        }
        const scanSkills = (d) => {
          try { for (const f of readdirSync(d)) names.add('/' + f.replace(/\.md$/, ''), descOf(join(d, f, 'SKILL.md'))) } catch {}
        }
        scan(join(root, '.claude', 'commands'))
        scanSkills(join(root, '.claude', 'skills'))
        scan(join(homedir(), '.claude', 'commands'))
        scanSkills(join(homedir(), '.claude', 'skills'))
        scan(join(fileURLToPath(new URL('../commands/', import.meta.url))))
        // every OTHER installed plugin's commands and skills, from the cache
        // Claude Code itself loads them from
        try {
          const cache = join(homedir(), '.claude', 'plugins', 'cache')
          for (const mkt of readdirSync(cache)) for (const plug of readdirSync(join(cache, mkt))) {
            try {
              const vers = readdirSync(join(cache, mkt, plug)).sort().reverse()
              if (!vers.length) continue
              const base = join(cache, mkt, plug, vers[0])
              scan(join(base, 'commands'))
              scanSkills(join(base, 'skills'))
            } catch {}
          }
        } catch {}
        // the CLI's own built-ins, the ones a desk terminal always answers
        for (const [b, d] of [['/clear', 'start a fresh conversation'], ['/compact', 'compact the context, keep a summary'], ['/config', 'settings'], ['/context', 'what is in the context window'], ['/cost', 'token spend this session'], ['/doctor', 'health-check the install'], ['/effort', 'reasoning effort'], ['/fast', 'toggle fast mode'], ['/help', 'help'], ['/model', 'switch model'], ['/resume', 'resume a past session'], ['/status', 'session status']]) names.add(b, d)
        const sorted = [...found.keys()].sort()
        return json(res, 200, { commands: sorted, detail: sorted.map((n) => ({ name: n, desc: found.get(n) || '' })) })
      }
      if (url.pathname === '/api/screen') {
        const key = url.searchParams.get('key') ?? ''
        const row = chatRosterCheap(root).find((r) => r.key === key)
        if (!row?.port) { res.writeHead(204); return res.end() }
        if (row.port === 9222) { res.writeHead(403); return res.end() } // v1's LIVE account browser. Never.
        return screenshotOf(row.port, { tabId: url.searchParams.get('tab') || null })
          .then((shot) => {
            if (!shot) { res.writeHead(204); return res.end() }
            res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store', 'x-tab-title': encodeURIComponent(shot.title ?? ''), 'x-tab-url': encodeURIComponent(shot.url ?? '') })
            res.end(shot.jpeg)
          })
          .catch(() => { res.writeHead(204); res.end() })
      }
      if (url.pathname === '/api/computer') {
        const key = url.searchParams.get('key') ?? ''
        const row = chatRosterCheap(root).find((r) => r.key === key)
        if (!row?.port) return json(res, 200, { tabs: [], why: row ? 'this desk declares no browser port' : 'unknown desk' })
        // ⛔ 9222 IS v1'S LIVE ALIBABA CHROME, serving real buyers. Never.
        if (row.port === 9222) return json(res, 200, { tabs: [], why: 'port 9222 is the LIVE account browser and is never touched from here' })
        return fetch('http://127.0.0.1:' + row.port + '/json/list')
          .then((r) => r.json())
          .then((tabs) => json(res, 200, {
            port: row.port,
            tabs: tabs.filter((t) => t.type === 'page').map((t) => ({
              title: t.title, url: t.url,
              devtools: t.devtoolsFrontendUrl?.startsWith('/') ? 'http://127.0.0.1:' + row.port + t.devtoolsFrontendUrl : t.devtoolsFrontendUrl,
            })),
          }))
          .catch(() => json(res, 200, { tabs: [], why: 'no headed Chrome answering on port ' + row.port + ' right now' }))
      }
      if (url.pathname === '/api/office-chat') {
        return json(res, 200, { canSend: orcaAvailable(), desks: chatRoster(root) })
      }
      if (url.pathname === '/api/transcript') {
        const key = url.searchParams.get('key') ?? ''
        if (!/^[A-Za-z0-9-]+$/.test(key)) return json(res, 400, { why: 'bad key' })
        const t = newestSession(join(homedir(), '.claude', 'projects', key))
        if (!t) return json(res, 200, { label: key, model: null, count: 0, messages: [] })
        const tail = readTail(t)
        const messages = tail?.messages ?? []
        const row = chatRosterCheap(root).find((r) => r.key === key)
        const label = row?.label ?? key
        // the session's WORKING folder: the desk's own tree, or the repo root
        // for the lead, whose desk IS the root
        const deskDir = row ? (row.desk === 'team-lead' ? root : join(root, 'desks', row.desk)) : null
        const workspace = deskDir ? treeOf(deskDir) : null
        const now = Date.now()
        // ⛔ THE FOLDER OF *THAT* SESSION, tied by session id to the transcript
        // being shown. "Newest tmp dir" repeated the robot bug on the tmp side:
        // an SDK run's empty scratchpad out-mtimed the lead's working one.
        const sessionId = basename(t, '.jsonl')
        const folder = filesUnder(join('/private/tmp', 'claude-' + process.getuid(), key, sessionId, 'scratchpad'))
          .map((x) => ({ name: x.name, size: x.size, ageMin: Math.round((now - x.at) / 60000) }))
        const usage = tail ? { ...tail.stats, cost: costOf({ model: tail.stats.model, input: tail.stats.input, output: tail.stats.output, cacheRead: tail.stats.cacheRead, cacheWrite: tail.stats.cacheWrite ?? 0 }) } : null
        // the CLI status line's numbers: elapsed since the human's message
        // that started this turn, and the tokens it has produced so far
        // the turn starts at whatever last SPOKE TO the desk: a human, a
        // peer desk, or a system event. Anchoring on role user alone read
        // "running for 4,000 minutes" the moment peers stopped counting.
        const lastUser = [...messages].reverse().find((m) => m.role !== 'assistant')
        const elapsedSec = lastUser?.at ? Math.max(0, Math.round((now - Date.parse(lastUser.at)) / 1000)) : null
        const turn = { elapsedSec: elapsedSec != null && elapsedSec < 14400 ? elapsedSec : null, output: tail?.stats?.turnOutput ?? 0 }
        return json(res, 200, { label, model: tail?.stats?.model ?? null, mode: tail?.stats?.permissionMode ?? null, count: messages.length, messages, folder, workspace, usage, turn, pending: pendingAsk(messages) })
      }
      if (url.pathname === '/api/hire' && req.method === 'POST') {
        // ⛔ THE GUARDED ENTRY, NEVER THE PARTS. hire() owns the name rules,
        // the port claim, the one-lead rule, and the two-reader agreement on
        // who may talk to a customer. Here the HUMAN is reader one (they pick
        // the kind in the dialog); hire's own reading is reader two, and its
        // refusal text goes to the screen verbatim, because the refusals are
        // the product.
        let body = ''
        req.on('data', (c) => { body += c; if (body.length > 65536) req.destroy() })
        req.on('end', () => {
          try {
            const { name, kind, description } = JSON.parse(body)
            const r = hire(root, { name, kind, description: description ?? '' })
            return json(res, 200, r)
          } catch (e) {
            // a two-reader disagreement is a 409 (the readings conflict);
            // everything else the contract throws is a plain bad request
            return json(res, e.disagreement ? 409 : 400, { ok: false, why: e.message })
          }
        })
        return
      }
      if (url.pathname === '/api/send' && req.method === 'POST') {
        let body = ''
        req.on('data', (c) => { body += c; if (body.length > 65536) req.destroy() })
        req.on('end', () => {
          try {
            const { key, text } = JSON.parse(body)
            const row = chatRoster(root).find((r) => r.key === key)
            if (!row) return json(res, 404, { ok: false, why: 'unknown desk' })
            if (!text || typeof text !== 'string' || text.length > 8000) return json(res, 400, { ok: false, why: 'no text, or too long' })
            // ⛔ orca TYPES at human speed — 8-12s for a sentence — and a
            // synchronous wait froze this single-threaded server for everyone.
            // Dispatch async, answer in under a second; the transcript (via
            // SSE) is the delivery confirmation, and the outbox shows pending.
            const deskDir = row.key === slugFor(root) ? root : join(root, 'desks', row.desk)
            if (!orcaAvailable()) return json(res, 200, { ok: false, why: 'no orca CLI on this host; the board is read-only here' })
            const handle = terminalFor(row.desk, undefined, deskDir)
            if (!handle) return json(res, 200, { ok: false, why: `no live terminal is titled "${row.desk}" or working in its folder` })
            const child = execFile('orca', ['terminal', 'send', '--terminal', handle, '--text', text, '--enter', '--json'], { timeout: 60000 }, () => {})
            let replied = false
            const early = setTimeout(() => { replied = true; json(res, 200, { ok: true, handle, dispatched: true }) }, 700)
            child.on('exit', (code) => {
              clearTimeout(early)
              if (replied) return
              if (code === 0) json(res, 200, { ok: true, handle })
              else json(res, 200, { ok: false, why: 'orca send exited ' + code })
            })
            return
          } catch (e) { return json(res, 500, { ok: false, why: e.message }) }
        })
        return
      }
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('nothing here. The office lives at /')
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end('board error: ' + e.message)
    }
  })
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2)
  const pi = args.indexOf('--port')
  const port = pi >= 0 ? Number(args[pi + 1]) : 7719
  const root = resolve(args.find((a) => !a.startsWith('--') && a !== String(port)) ?? process.cwd())
  if (!existsSync(root)) { console.error(`⛔ no such directory: ${root}`); process.exit(7) }
  // ⛔ LOOPBACK ONLY. This page lists what every agent is doing; it is for the
  // person at the machine, never for a network.
  makeServer(root).listen(port, '127.0.0.1', () => {
    console.log(`the office · http://127.0.0.1:${port} · root ${root}`)
  })
}
