#!/usr/bin/env node
// POSTTOOLUSE (SendMessage): a question sent to another session becomes a tracked ask,
// and a message back to whoever asked you closes theirs. (Office-Anything #97: `full`
// asked AICS and waited; nothing re-rang.)
//
// ⛔ THE TRACKING IS NOT A THING A MODEL MUST REMEMBER. A model that forgets to run
// `tasks.mjs ask` is the failure; this hook records the ask from the message itself:
// a text with a question mark (or starting "ASK") sent to a session opens one ask
// from the sender to the recipient, due in ASK_MINUTES; while one is open, another
// message between the same two opens no second. lib/follow.mjs rings it when late.
//
// ⛔ A REMINDER, NOT A GATE: any failure exits 0 and prints nothing. Inert outside an
// office, and for a message to a session this office does not know as a lead, a
// desk or a dev session it can name.
import { readFileSync } from 'node:fs'
import { readOfficeConfig, findOffice, whoIs, sessionName } from '../lib/office.mjs'
import { actorName, trackAsk, closeAsksByReply } from '../lib/tasks.mjs'

export const isQuestion = (text) => /\?/.test(text) || /^\s*ask\b/i.test(text)

try {
  let p = {}
  try { p = JSON.parse(readFileSync(0, 'utf8')) } catch {}
  const cwd = typeof p.cwd === 'string' && p.cwd ? p.cwd : process.cwd()
  const root = findOffice(cwd)
  const to = String(p?.tool_input?.to ?? '').replace(/\s*\[[^\]]*\]\s*$/, '').trim()
  const msg = p?.tool_input?.message
  if (root && p?.tool_name === 'SendMessage' && to && !/^(uds|bridge|tcp):/i.test(to) && typeof msg === 'string') {
    const cfg = readOfficeConfig(root)
    const w = whoIs(root, cfg, { cwd })
    if (w?.kind !== 'unknown') {
      const by = w?.kind === 'lead' ? { kind: 'lead' } : w?.kind === 'desk' ? { kind: 'desk', desk: w.desk } : { kind: 'session', name: process.env[cfg.roleEnv] || sessionName() }
      const from = actorName(root, by)
      if (from && from !== 'owner') {
        closeAsksByReply(root, { from, to })
        if (isQuestion(msg)) trackAsk(root, { from, to, text: msg })
      }
    }
  }
} catch {}
process.exit(0)
