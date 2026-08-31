#!/usr/bin/env node
// ⛔ THE SEND WALL, AS A HOOK. This is the difference between a check and a gate.
//
// `checks/send-wall.mjs` tells you a knowledge desk grew a sender. It tells you AFTER it
// happened, when someone runs it, if someone runs it. This BLOCKS the write.
//
// ⛔ WHY A HOOK AND NOT A PROMPT. The system this came from documented the failure exactly:
// three gates existed, all three were bypassed for a full day by the agent that had WRITTEN
// them, while the count printed on screen. A rule the model is asked to follow is a rule the
// model can talk itself out of at 2am with a customer waiting. A PreToolUse hook is not the
// model's decision, so it cannot be forgotten, rationalized, or overridden in a hurry.
//
// Reads a PreToolUse payload on stdin. Exit 2 blocks the tool call and returns stderr to
// the model as the reason.
import { readFileSync, existsSync } from 'node:fs'
import { join, sep } from 'node:path'

const chunks = []
process.stdin.on('data', c => chunks.push(c))
process.stdin.on('end', () => {
  let payload
  // ⛔ A HOOK THAT CRASHES MUST NOT BLOCK EVERYTHING. Exit 0 on anything unexpected: this
  // gate guards one narrow thing, and a parse error is not evidence of a violation.
  try { payload = JSON.parse(Buffer.concat(chunks).toString() || '{}') } catch { process.exit(0) }

  const path = payload?.tool_input?.file_path
  if (!path) process.exit(0)

  // Only care about a file being written INTO a desk's send path.
  const m = path.match(new RegExp(`desks\\${sep}([^\\${sep}]+)\\${sep}runtime\\${sep}(send|relay)\\${sep}`))
  if (!m) process.exit(0)
  const [, deskName] = m

  const root = path.slice(0, path.indexOf(`${sep}desks${sep}`))
  const manifest = join(root, 'desks', deskName, 'desk.json')
  if (!existsSync(manifest)) process.exit(0)      // not a desk we know; not ours to judge

  let desk
  try { desk = JSON.parse(readFileSync(manifest, 'utf8')) } catch { process.exit(0) }

  if (desk.kind === 'knowledge') {
    console.error(
      `⛔ BLOCKED. ${deskName} is a KNOWLEDGE desk and you are giving it a way to send.\n\n` +
      `A knowledge desk holds prices, margins and contracts. The wall is that it has no\n` +
      `route to a customer, and "no route" means the capability is ABSENT, not disabled.\n\n` +
      `If this desk genuinely needs to talk to people, it is the wrong kind. Change its\n` +
      `kind in desks/${deskName}/desk.json deliberately, where somebody reviews it.`
    )
    process.exit(2)
  }

  if (desk.kind === 'channel' && desk.live !== true) {
    console.error(
      `⛔ BLOCKED. ${deskName} is a channel desk but it is DARK, and you are giving it a sender.\n\n` +
      `Going live is meant to be a deliberate, reviewed edit to desk.json, not a file quietly\n` +
      `appearing. Set "live": true first, on purpose, and then write this.`
    )
    process.exit(2)
  }

  process.exit(0)
})
