#!/usr/bin/env node
// SESSIONSTART (start, resume, clear AND compact): the lead is shown the tasks it holds
// for the owner, and every other session the tasks assigned to ITS name, so a context reset can not lose them. Its stdout lands in the model's context.
//
// ⛔ A REMINDER, NOT A GATE: any failure exits 0 and prints nothing. Inert outside an
// office, for a desk, and when nothing is open. Also takes the day's first snapshot.
import { readFileSync } from 'node:fs'
import { readOfficeConfig, findOffice, whoIs, sessionName } from '../lib/office.mjs'
import { openTable, sessionTable, snapshot } from '../lib/tasks.mjs'
import { sessionOf } from '../lib/desk.mjs'

try {
  let payload = {}
  try { payload = JSON.parse(readFileSync(0, 'utf8')) } catch {}
  const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd()
  const root = findOffice(cwd)
  if (root) {
    const cfg = readOfficeConfig(root)
    const w = whoIs(root, cfg, { cwd })
    if (w?.kind === 'lead') {
      snapshot(root)
      const table = openTable(root)
      if (table) console.log(table)
    } else if (w?.kind !== 'unknown') {
      // a desk (a case session reads its parent's) or a dev session: only what is assigned to its name
      const name = w?.kind === 'desk' ? sessionOf(root, w.desk) : (process.env[cfg.roleEnv] || sessionName())
      const table = name ? sessionTable(root, name) : ''
      if (table) console.log(table)
    }
  }
} catch {}
process.exit(0)
