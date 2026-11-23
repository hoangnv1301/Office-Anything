#!/usr/bin/env node
// A FAKE OFFICE FOR SCREENSHOTS AND THE E2E RIG. Every desk, message, number
// and file here is invented (Pat Example, example.com): nothing is read from
// this machine's real Claude Code home or any real office.
//
//   node board/ui/mock/demo-office.mjs [--port 7799]
//
// It builds a throwaway office and a throwaway HOME in the temp dir, points
// the real board server at them (HOME is swapped before serve.mjs loads), and
// keeps running until Ctrl-C. This process's own pid stands in as the live
// session of every desk, so the registry reads "alive" without starting one.
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = Number(process.argv[process.argv.indexOf('--port') + 1]) || 7799
// /tmp, not os.tmpdir(): macOS's per-user temp path carries "__", and the
// board refuses a project key with an underscore in it ("bad key")
const base = mkdtempSync(join(existsSync('/tmp') ? '/tmp' : tmpdir(), 'oa-demo-'))
const root = join(base, 'office')
const home = join(base, 'home')
process.env.HOME = home
// ⛔ the demo must never reach a REAL terminal: with the orca CLI on PATH the
// board would find this machine's own tabs and route the composer into them.
// Every PATH entry that holds an `orca` is dropped, so every desk reads
// "no terminal" and the composer can only reach the fake inboxes.
process.env.PATH = (process.env.PATH ?? '').split(':').filter((d) => d && !existsSync(join(d, 'orca'))).join(':')

const { slugFor } = await import('../../read.mjs')
const { makeServer } = await import('../../serve.mjs')

const write = (p, s) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, s) }
const now = Date.now()
const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString()

// ── the office: a lead at the root and five desks ──
write(join(root, 'desk.json'), JSON.stringify({ name: 'team-lead', kind: 'lead', port: 9230, heartbeat: "echo 'heartbeat: 9/9 loops up'" }))
write(join(root, 'office.json'), JSON.stringify({ panels: [{ id: 'approvals', title: 'Pending approvals', command: `printf '%s\\n' 'SO-1019 revised quote — waits on freight' 'SO-1031 drawing set — waits on the buyer' 'SO-1040 refund — waits on the owner'` }] }))
write(join(root, 'CLAUDE.md'), '# The demo office\n\nA made-up office for screenshots. ' + 'Every desk, buyer and number here is invented. '.repeat(8) + '\n')
write(join(root, 'notes', 'freight.md'), '# Freight\n\nRates for SO-1019 are pending.\n')
const desks = [
  ['design', 'knowledge', 9231], ['design-quotation', 'knowledge', 9232], ['inventory', 'knowledge', 9233],
  ['customer-service', 'channel', 9234], ['manufacturing', 'knowledge', 9235],
]
for (const [name, kind, p] of desks) {
  write(join(root, 'desks', name, 'desk.json'), JSON.stringify({ name, kind, port: p, live: false }))
  write(join(root, 'desks', name, 'CLAUDE.md'), '# ' + name + '\n\nA demo desk. ' + 'Its notes are invented. '.repeat(10) + '\n')
  // a few hooks, so the drawer's Hooks tab has a lifecycle to show
  const hook = (command, matcher = '*') => [{ matcher, hooks: [{ type: 'command', command }] }]
  write(join(root, 'desks', name, '.claude', 'settings.json'), JSON.stringify({ hooks: {
    Stop: hook('node hooks/report-done.mjs'), PreToolUse: hook('node hooks/desk-wall.mjs', 'Bash|Write|Edit'), SessionStart: hook('node hooks/boot.mjs'),
  } }))
}

// ── transcripts, in Claude Code's own jsonl shape ──
let n = 0
const id = () => 'toolu_demo_' + (++n)
const usage = (i, o, cr) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: cr, cache_creation_input_tokens: 2000 })
const user = (text, min) => ({ type: 'user', permissionMode: 'acceptEdits', timestamp: iso(min), message: { role: 'user', content: text } })
const peer = (from, text, min) => user(`<cross-session-message from="uds:/tmp/demo/${from}.sock" from-name="${from}">\n${text}\n</cross-session-message>`, min)
const said = (text, min, extra = {}) => ({ type: 'assistant', timestamp: iso(min), message: { role: 'assistant', model: 'claude-opus-5-5', usage: usage(1200, 900, 61000), content: [...(extra.thinking ? [{ type: 'thinking', thinking: extra.thinking }] : []), { type: 'text', text }] } })
const tools = (calls, min) => {
  const withIds = calls.map((c) => ({ ...c, id: id() }))
  return [
    { type: 'assistant', timestamp: iso(min), message: { role: 'assistant', model: 'claude-opus-5-5', usage: usage(800, 400, 61000), content: withIds.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.input })) } },
    { type: 'user', timestamp: iso(min), message: { role: 'user', content: withIds.map((c) => ({ type: 'tool_result', tool_use_id: c.id, content: c.out ?? 'ok', is_error: !!c.err })) } },
  ]
}
const ask = (question, options, min) => ({ type: 'assistant', timestamp: iso(min), message: { role: 'assistant', model: 'claude-opus-5-5', usage: usage(600, 200, 61000), content: [{ type: 'tool_use', id: id(), name: 'AskUserQuestion', input: { questions: [{ question, header: 'Quote', multiSelect: false, options: options.map((label) => ({ label, description: '' })) }] } }] } })

const transcripts = {
  [root]: [
    user('Morning. What needs me today?', 48),
    said('Three things moved overnight:\n\n- **SO-1019**: the price dropped by $39.88 after the toe-kick fix; the buyer was not told yet.\n- **SO-1031**: the drawing set went to Pat Example at 08:10.\n- The camera is on. 41 rooms are queued; 12 shot so far.\n\nOne thing needs you: the design desk is waiting on a plan approval.', 47, { thinking: 'Read the overnight log, then the two open orders, then the design desk.' }),
    ...tools([
      { name: 'Read', input: { file_path: 'notes/freight.md' }, out: '# Freight\nRates pending.' },
      { name: 'Edit', input: { file_path: 'notes/freight.md', old_string: 'Rates for SO-1019 are pending.', new_string: 'Rates for SO-1019 asked from two carriers at 08:20.' } },
      { name: 'Bash', input: { command: 'node scripts/queue.mjs --open', description: 'List open orders' }, out: 'SO-1019 open\nSO-1031 open' },
      { name: 'SendMessage', input: { to: 'design', message: 'Pat Example approved the layout for SO-1031. Please draw the four elevation views.\nDone when: four views are in the order folder.' } },
    ], 46),
    ...tools([{ name: 'Bash', input: { command: 'git checkout main', description: 'Switch branch' }, out: 'Hook refused: the main tree is guarded', err: true }], 44),
    user('Approve the design plan if it keeps his 32 inch upper.', 30),
    peer('design', 'The plan keeps the 32 inch upper. I approved it and started on the four views; the first two are in the folder.', 12),
    said('Design kept the 32 inch upper and has two of the four views done. I will check the last two at 10:00.', 11),
    ask('Send the revised quote for SO-1019 now, or wait for the freight rate?', ['Send now', 'Wait for freight', 'Ask me later'], 2),
  ],
  [join(root, 'desks', 'design')]: [
    peer('lead', 'Pat Example approved the layout for SO-1031. Please draw the four elevation views.\nDone when: four views are in the order folder.', 46),
    said('Starting the four views for SO-1031. The plan keeps the 32 inch upper.', 45),
    { type: 'assistant', timestamp: iso(3), message: { role: 'assistant', model: 'claude-sonnet-5-5', usage: usage(500, 300, 40000), content: [{ type: 'tool_use', id: id(), name: 'ExitPlanMode', input: { plan: '1. Draw the north and east walls at 1:20.\n2. Keep the 32 inch upper over the range.\n3. Export the four views as PDF into the order folder.' } }] } },
  ],
  [join(root, 'desks', 'design-quotation')]: [
    user('Price SO-1109-251 from the approved layout.', 30),
    said('Priced SO-1109-251: $4,860.00 for 14 boxes, freight not included.', 4),
  ],
  [join(root, 'desks', 'inventory')]: [
    user('Count the walnut doors left in bay 3.', 120),
    said('Bay 3 has 22 walnut shaker doors, 18 of them 15 × 30 in.', 118),
  ],
  [join(root, 'desks', 'customer-service')]: [
    user('Answer the new chat from Pat Example about lead times.', 20),
    ...tools([{ name: 'Read', input: { file_path: 'facts.md' }, out: 'Lead time: 2–3 weeks.' }], 1),
  ],
  [join(root, 'desks', 'manufacturing')]: [
    said('Cut list for SO-1002 is done.', 60 * 26),
  ],
}

const ids = {}
for (const [cwd, lines] of Object.entries(transcripts)) {
  const sid = '00000000-0000-4000-8000-' + String(Object.keys(ids).length + 1).padStart(12, '0')
  ids[cwd] = sid
  const p = join(home, '.claude', 'projects', slugFor(cwd), sid + '.jsonl')
  write(p, lines.map((l) => JSON.stringify({ ...l, sessionId: sid, cwd })).join('\n') + '\n')
}
// the manufacturing desk has been quiet for a day
utimesSync(join(home, '.claude', 'projects', slugFor(join(root, 'desks', 'manufacturing')), ids[join(root, 'desks', 'manufacturing')] + '.jsonl'), new Date(now - 26 * 3600e3), new Date(now - 26 * 3600e3))
// two teammates working beside the lead (other transcripts in its project folder)
const leadDir = join(home, '.claude', 'projects', slugFor(root))
write(join(leadDir, 'aaaaaaaa-0000-4000-8000-000000000001.jsonl'), JSON.stringify(user('cs-buyer-650 · drafting a reply to Pat Example', 3)) + '\n' + JSON.stringify(said('Drafting.', 1)) + '\n')
write(join(leadDir, 'aaaaaaaa-0000-4000-8000-000000000002.jsonl'), JSON.stringify(user('reviewer · check the SO-1019 quote lines', 2)) + '\n' + JSON.stringify(said('Checking.', 1)) + '\n')

// ── the live registry, one record per desk; all point at this process ──
const live = [
  [root, 'lead', 'waiting', { needs: 'your answer' }],
  [join(root, 'desks', 'design'), 'desk-design', 'waiting', { needs: 'plan approval' }],
  [join(root, 'desks', 'design-quotation'), 'desk-design-quotation', 'idle', {}],
  [join(root, 'desks', 'inventory'), 'desk-inventory', 'idle', {}],
  [join(root, 'desks', 'customer-service'), 'desk-customer-service', 'shell', { detail: 'running a command' }],
]
// each desk also gets an inbox address so the composer reads as it does in a
// real office; the socket does not exist, so a send fails plainly, never lands
const { createHash } = await import('node:crypto')
live.forEach(([cwd, name, status, extra], i) => {
  const sock = join(base, 'inbox-' + i + '.sock')
  write(join(home, '.claude', 'sessions', String(1000 + i) + '.json'), JSON.stringify({ pid: process.pid, cwd, name, status, sessionId: ids[cwd], updatedAt: now, version: '2.1.311', messagingSocketPath: sock, ...extra }))
  write(join(home, '.claude', 'sessions', `${process.pid}.${createHash('sha256').update(sock).digest('hex')}.key`), JSON.stringify({ peerToken: 'demo-token-' + i }))
})

makeServer(root).listen(port, '127.0.0.1', () => {
  console.log(`demo office · http://127.0.0.1:${port} · root ${root} · fake HOME ${home}`)
})
