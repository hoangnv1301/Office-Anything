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
import { join } from 'node:path'
import { gatherOffice, slugFor } from './read.mjs'
import { render } from './page.mjs'
import { chatPage } from './chat-page.mjs'
import { newestSession, chatFrom } from './transcript.mjs'
import { send, orcaAvailable, normalizeTitle } from './send.mjs'
import { readFileSync } from 'node:fs'
import { rosterSafe } from '../lib/desk.mjs'
import { collect } from '../checks/run.mjs'
import { isMain } from '../lib/is-main.mjs'

// The chat's session list: every desk plus the LEAD, whose desk is the repo
// root. key = the cwd slug, which is how Claude Code files both the
// transcript and the scratchpad.
export function chatRoster(root, { home = homedir(), now = Date.now() } = {}) {
  const { desks } = rosterSafe(join(root, 'desks'))
  const rows = [
    { key: slugFor(root), label: 'team-lead', sub: 'the repo root · this machine\'s lead session', desk: 'team-lead' },
    ...desks.map((d) => ({ key: slugFor(join(root, 'desks', d.name)), label: d.name, sub: d.kind + (d.live ? ' · LIVE' : ''), desk: d.name })),
  ]
  for (const r of rows) {
    const t = newestSession(join(home, '.claude', 'projects', r.key))
    r.activeMin = t ? Math.round((now - (statSafe(t))) / 60000) : null
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
      if (url.pathname === '/chat') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        return res.end(chatPage())
      }
      if (url.pathname === '/api/office-chat') {
        return json(res, 200, { canSend: orcaAvailable(), desks: chatRoster(root) })
      }
      if (url.pathname === '/api/transcript') {
        const key = url.searchParams.get('key') ?? ''
        if (!/^[A-Za-z0-9-]+$/.test(key)) return json(res, 400, { why: 'bad key' })
        const t = newestSession(join(homedir(), '.claude', 'projects', key))
        if (!t) return json(res, 200, { label: key, model: null, count: 0, messages: [] })
        const messages = chatFrom(readFileSync(t, 'utf8'))
        const label = chatRoster(root).find((r) => r.key === key)?.label ?? key
        return json(res, 200, { label, model: messages.findLast?.((m) => m.model)?.model ?? null, count: messages.length, messages })
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
      const office = gatherOffice(root)
      const checks = collect(root)
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(render(office, checks) + '<p class=m><a href="/chat" style="color:#8b949e">→ the chat view</a></p>')
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
