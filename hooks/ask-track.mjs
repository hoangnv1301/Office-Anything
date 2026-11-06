#!/usr/bin/env node
// POSTTOOLUSE (SendMessage): a question sent to another session becomes a tracked ask,
// and an ANSWER back to whoever asked closes theirs. (Office-Anything #97: `full`
// asked AICS and waited; nothing re-rang.)
//
// ⛔ OFF UNLESS THE OFFICE SAYS SO: office.json "asks": { "track": true }. A message is not
// an ask by default; an office opts in.
// ⛔ THE TRACKING IS NOT A THING A MODEL MUST REMEMBER. With it on, a message that asks
// something of a KNOWN session (the lead, a desk, a desk's case session, or a registered
// session) opens one ask from the sender, due in ASK_MINUTES; while one is open, another
// message between the same two opens no second. lib/follow.mjs rings it when late.
// ⛔ A QUESTION IS A QUESTION MARK IN THE SENDER'S OWN WORDS, not in a URL or in text it quotes
// (a buyer's message in quotation marks, a `>` line, a code block), or a message starting "ask".
// ⛔ "ON IT" IS NOT AN ANSWER. A short acknowledgement is noted on the ask and leaves it open
// with its clock running; any other reply closes it. The asker can also close it
// (tasks.mjs answer T-… --text "…").
// ⛔ Names are resolved as desk-wall.mjs resolves them: a lead's alias, a desk's old name, a case
// session (desk-x--key is desk-x), and the office module's own alias map.
//
// A REMINDER, NOT A GATE: any failure exits 0 and prints nothing.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { readOfficeConfig, findOffice, whoIs, sessionName } from '../lib/office.mjs'
import { actorName, trackAsk, closeAsksByReply, ackAsksByReply, isAck, isQuestion, knownSession } from '../lib/tasks.mjs'
import { liveSessions } from '../lib/procs.mjs'
import { officeModule } from './desk-wall.mjs'

try {
  let p = {}
  try { p = JSON.parse(readFileSync(0, 'utf8')) } catch {}
  const cwd = typeof p.cwd === 'string' && p.cwd ? p.cwd : process.cwd()
  const root = findOffice(cwd)
  const to0 = String(p?.tool_input?.to ?? '').replace(/\s*\[[^\]]*\]\s*$/, '').trim()
  const msg = p?.tool_input?.message
  if (root && p?.tool_name === 'SendMessage' && to0 && !/^(uds|bridge|tcp):/i.test(to0) && typeof msg === 'string') {
    const cfg = readOfficeConfig(root)
    const w = whoIs(root, cfg, { cwd })
    if (cfg.asks?.track === true && w?.kind !== 'unknown') {
      const by = w?.kind === 'lead' ? { kind: 'lead' } : w?.kind === 'desk' ? { kind: 'desk', desk: w.desk } : { kind: 'session', name: process.env[cfg.roleEnv] || sessionName() }
      let to = to0
      // the office module's alias map, as the wall reads it
      if (cfg.wall?.module) { let mod; try { mod = officeModule(root, cfg); const a = mod ? await mod.call('alias', to0, { root }) : null; if (typeof a === 'string' && a) to = a } catch {} finally { try { mod?.close() } catch {} } }
      const from = actorName(root, by)
      const known = knownSession(root, to) || liveSessions(homedir()).some((s) => s.name === to)
      if (from && from !== 'owner' && known) {
        if (isAck(msg)) ackAsksByReply(root, { from, to })
        else {
          closeAsksByReply(root, { from, to })
          if (isQuestion(msg)) trackAsk(root, { from, to, text: msg })
        }
      }
    }
  }
} catch {}
process.exit(0)
