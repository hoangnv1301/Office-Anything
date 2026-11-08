#!/usr/bin/env node
// USERPROMPTSUBMIT: records what the owner typed, verbatim, in .office/owner-words.jsonl (lib/owner-words.mjs), so a
// long chat or a compaction cannot lose an ask. Sits beside hooks/typed-prompt.mjs (approvals) and changes none of its rules.
//
// ⛔ A MEMORY, NOT A GATE: any failure exits 0 and prints nothing. Inert outside an office, for a desk (unless
// approvals.desks, the same rule as approvals), for text the office itself typed, system traffic, and anything shaped like a key.
//
// ⚠ GAP: Claude Code fires UserPromptSubmit only for a prompt that STARTS a turn. A message the owner types while the
// session is mid-turn is queued and recorded in the transcript as an attachment (type queued_command, origin human);
// no hook sees it at that moment. So every prompt also reads the transcript tail and records the queued human messages
// not seen yet: they are captured at the next prompt, late but not lost. A queue the owner never follows up on waits.
import { readFileSync } from 'node:fs'
import { readOfficeConfig, findOffice } from '../lib/office.mjs'
import { ownerFacing } from '../lib/approvals.mjs'
import { recordWords, recordQueued } from '../lib/owner-words.mjs'

try {
  let p = {}
  try { p = JSON.parse(readFileSync(0, 'utf8')) } catch {}
  const cwd = typeof p.cwd === 'string' && p.cwd ? p.cwd : process.cwd()
  const root = findOffice(cwd)
  if (root) {
    const session = ownerFacing(root, readOfficeConfig(root), { cwd })
    if (session) {
      if (typeof p.transcript_path === 'string') recordQueued(root, session, p.transcript_path)
      if (typeof p.prompt === 'string') recordWords(root, { session, text: p.prompt })
    }
  }
} catch {}
process.exit(0)
