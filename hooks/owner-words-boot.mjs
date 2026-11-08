#!/usr/bin/env node
// SESSIONSTART (start, resume, clear AND compact): shows the session its still-open owner words, newest first, capped,
// and an ALARM line for any open more than 24 h, next to the open-tasks block (hooks/tasks-boot.mjs).
// ⛔ A REMINDER, NOT A GATE: any failure exits 0 and prints nothing. Inert outside an office and for a desk.
import { readFileSync } from 'node:fs'
import { readOfficeConfig, findOffice } from '../lib/office.mjs'
import { ownerFacing } from '../lib/approvals.mjs'
import { bootBlock } from '../lib/owner-words.mjs'

try {
  let p = {}
  try { p = JSON.parse(readFileSync(0, 'utf8')) } catch {}
  const cwd = typeof p.cwd === 'string' && p.cwd ? p.cwd : process.cwd()
  const root = findOffice(cwd)
  if (root) {
    const session = ownerFacing(root, readOfficeConfig(root), { cwd })
    const block = session ? bootBlock(root, session) : ''
    if (block) console.log(block)
  }
} catch {}
process.exit(0)
