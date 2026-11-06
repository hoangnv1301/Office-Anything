#!/usr/bin/env node
// USERPROMPTSUBMIT: the ONLY writer of an approval grant (lib/approvals.mjs). When the first line of a prompt that
// reached an owner-facing session is the owner's approval phrase,
//
//     approve <action> target:<where> [hours:<1-168>] [once]
//
// a grant is written for exactly that action and that target. Nothing else makes a grant: no command, no quote
// search, no agent. The grant is not trusted on its own; every check re-verifies it against the session's
// transcript (was that turn typed by a person, and does it say this).
//
// ⛔ A MEMORY, NOT A GATE: any failure exits 0. Inert outside an office, for a desk (unless approvals.desks), and for
// text the office itself typed (lib/typed-mark.mjs). Prints nothing.
import { readFileSync } from 'node:fs'
import { readOfficeConfig, findOffice } from '../lib/office.mjs'
import { ownerFacing, grantFromPrompt, parseApproval } from '../lib/approvals.mjs'

try {
  let p = {}
  try { p = JSON.parse(readFileSync(0, 'utf8')) } catch {}
  // an ordinary prompt is none of this hook's business: nothing is read, looked up or spawned for it
  if (typeof p.prompt !== 'string' || !parseApproval(p.prompt)) process.exit(0)
  const cwd = typeof p.cwd === 'string' && p.cwd ? p.cwd : process.cwd()
  const root = findOffice(cwd)
  if (root && typeof p.prompt === 'string') {
    const cfg = readOfficeConfig(root)
    const session = ownerFacing(root, cfg, { cwd })
    if (session) grantFromPrompt(root, cfg, { session, sessionId: p.session_id ?? p.sessionId ?? null, text: p.prompt, promptId: p.prompt_id ?? p.promptId ?? null, transcript: p.transcript_path ?? null, cwd })
  }
} catch {}
process.exit(0)
