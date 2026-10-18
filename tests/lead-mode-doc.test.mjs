// The README states a rule about the lead's permission mode; this pins the rule
// to the code it describes, so the paragraph cannot outlive it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { launchCommand } from '../lib/start.mjs'

test('the README explains "Held peer message", and the lead really is launched with the desks\' flags', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  assert.match(readme, /Held peer message … crossSessionInbound/)
  assert.match(readme, /not delivered and not retried/)
  assert.match(readme, /launched with every flag the desks get/)
  const cfg = { launch: { flags: ['--dangerously-skip-permissions'], lead: { flags: ['--remote-control'] } }, lead: { session: 'lead' } }
  const lead = launchCommand({ cfg, target: { name: 'lead', tag: 'lead', isLead: true, dir: '/o', model: null } })
  const desk = launchCommand({ cfg, target: { name: 'a', tag: 'desk-a', isLead: false, dir: '/o/desks/a', model: null } })
  assert.match(lead, /--dangerously-skip-permissions --remote-control$/)
  assert.match(desk, /--dangerously-skip-permissions$/)
  assert.doesNotMatch(desk, /--remote-control/, 'launch.lead.flags reach the lead only')
})
