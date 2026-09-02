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
import { gatherOffice } from './read.mjs'
import { render } from './page.mjs'
import { collect } from '../checks/run.mjs'
import { isMain } from '../lib/is-main.mjs'

export function makeServer(root) {
  return createServer((req, res) => {
    try {
      const office = gatherOffice(root)
      const checks = collect(root)
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(render(office, checks))
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
