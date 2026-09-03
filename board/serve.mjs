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
import { subagentsOf } from './read.mjs'
import { transcriptStats, worktop, filesUnder, treeOf } from './read.mjs'
import { basename } from 'node:path'
import { send, orcaAvailable, normalizeTitle } from './send.mjs'
import { execFileSync } from 'node:child_process'

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
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
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
    const st = transcriptStats(join(home, '.claude', 'projects', r.key))
    try { const tp = t ? readTail(t) : null; r.waiting = !!(tp && pendingAsk(tp.messages)) } catch { r.waiting = false }
    const titles = liveTitles()
    r.online = titles ? (titles.has(r.desk) || r.desk === 'team-lead') : null
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
        const names = new Set()
        const scan = (d, suffix) => {
          try { for (const f of readdirSync(d)) if (f.endsWith('.md')) names.add('/' + f.replace(/\.md$/, '') + (suffix ?? '')) } catch {}
        }
        scan(join(root, '.claude', 'commands'))
        try { for (const f of readdirSync(join(root, '.claude', 'skills'))) names.add('/' + f) } catch {}
        scan(join(homedir(), '.claude', 'commands'))
        scan(join(fileURLToPath(new URL('../commands/', import.meta.url))))
        return json(res, 200, { commands: [...names].sort() })
      }
      if (url.pathname === '/api/screen') {
        const key = url.searchParams.get('key') ?? ''
        const row = chatRosterCheap(root).find((r) => r.key === key)
        if (!row?.port) { res.writeHead(204); return res.end() }
        if (row.port === 9222) { res.writeHead(403); return res.end() } // v1's LIVE account browser. Never.
        return screenshotOf(row.port)
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
        return json(res, 200, { label, model: tail?.stats?.model ?? null, count: messages.length, messages, folder, workspace, usage, pending: pendingAsk(messages) })
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
            return json(res, 200, send(row.desk, text))
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
