// office usage and office sweep: the two model-free token savers.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { usage, render } from '../lib/usage.mjs'
import { sweep } from '../lib/sweep.mjs'

const NOW = Date.parse('2026-10-10T12:00:00Z')
const slug = (d) => d.replace(/[^A-Za-z0-9]/g, '-')
const call = (id, model, cacheRead, ts = NOW - 3600e3, req = 'r' + id) => JSON.stringify({ timestamp: new Date(ts).toISOString(), requestId: req, message: { id, model, usage: { input_tokens: 10, cache_creation_input_tokens: 1000, cache_read_input_tokens: cacheRead, output_tokens: 50 } } }) + '\n'

test('usage: a call written on two lines counts once; lead, desk and subagent are named; old calls are out of the window', async () => {
  const cc = mkdtempSync(join(tmpdir(), 'oa-usage-')), root = '/Volumes/X/office'
  const lead = join(cc, 'projects', slug(root)), desk = join(cc, 'projects', slug(join(root, 'desks', 'billing')))
  mkdirSync(join(lead, 'aaaa', 'subagents'), { recursive: true }); mkdirSync(desk, { recursive: true })
  writeFileSync(join(lead, 'aaaa.jsonl'), call('m1', 'claude-opus-5-5', 100) + call('m1', 'claude-opus-5-5', 100) + call('m0', 'claude-opus-5-5', 100, NOW - 9 * 864e5))
  writeFileSync(join(lead, 'aaaa', 'subagents', 'agent-1.jsonl'), call('m2', 'claude-haiku-4-5', 200))
  writeFileSync(join(desk, 'bbbb.jsonl'), call('m3', 'claude-sonnet-5-5', 300))
  const r = await usage({ configDir: cc, root, hours: 24 * 7, now: NOW })
  assert.equal(r.calls, 3)
  assert.deepEqual(Object.keys(r.by.folder).sort(), ['desk billing', 'lead', 'lead [subagent]'])
  assert.equal(r.by.folder.lead.cacheRead, 100)
  assert.match(render(r, 168), /usage over the last 7 days: 3 calls/)
  assert.deepEqual(r.warnings, [])
})

test('usage: warns on a session over 300K context per call, and on Opus subagents over the share', async () => {
  const cc = mkdtempSync(join(tmpdir(), 'oa-usage-')), root = '/Volumes/X/office'
  const d = join(cc, 'projects', slug(root)); mkdirSync(join(d, 's', 'subagents'), { recursive: true })
  for (let i = 0; i < 6; i++) appendFileSync(join(d, 'big-session.jsonl'), call('b' + i, 'claude-opus-5-5', 400_000))
  for (let i = 0; i < 4; i++) appendFileSync(join(d, 's', 'subagents', 'a.jsonl'), call('o' + i, 'claude-opus-5-5', 1000))
  const r = await usage({ configDir: cc, root, hours: 24, now: NOW })
  assert.ok(r.warnings.some((w) => /lead big-sess averages 400K context per call over 6 calls.*restart it/.test(w)), r.warnings.join('\n'))
  assert.ok(r.warnings.some((w) => /Opus subagents made 4 of 10 calls \(40%, limit 20%\)/.test(w)))
  const quiet = await usage({ configDir: cc, root, hours: 24, now: NOW, cfg: { usage: { maxContextPerCall: 500_000, maxOpusSubagentPct: 50 } } })
  const later = await usage({ configDir: cc, root, hours: 24, now: NOW + 4 * 3600e3 })
  assert.ok(!later.warnings.some((w) => /restart it/.test(w)), 'a session that stopped hours ago is not told to restart')
  assert.deepEqual(quiet.warnings, [])
})

test('sweep: new items print once, a quiet sweep prints nothing, a still-open item repeats after the window, a broken check is an item', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'oa-sweep-')))
  writeFileSync(join(root, 'items.txt'), 'draft 1 waiting\n')
  const cfg = { sweep: { repeatHours: 3, checks: [
    { name: 'drafts', command: 'cat items.txt', parse: 'lines' },
    { name: 'server', command: ['/bin/sh', '-c', 'exit 0'], parse: 'exit' },
    { name: 'json', command: `echo '[{"key":"p1","line":"promise due"}]'`, parse: 'json' },
  ] } }
  assert.deepEqual(sweep(root, { cfg, now: NOW }).lines, ['drafts: draft 1 waiting', 'json: promise due'])
  assert.deepEqual(sweep(root, { cfg, now: NOW + 60e3 }).lines, [], 'quiet: nothing new')
  writeFileSync(join(root, 'items.txt'), 'draft 1 waiting\ndraft 2 waiting\n')
  assert.deepEqual(sweep(root, { cfg, now: NOW + 120e3 }).lines, ['drafts: draft 2 waiting'])
  assert.deepEqual(sweep(root, { cfg, now: NOW + 3.1 * 3600e3 }).lines, ['drafts: draft 1 waiting', 'drafts: draft 2 waiting', 'json: promise due'], 'still there after 3 h')
  const broken = { sweep: { checks: [{ name: 'server', command: 'echo down; exit 3', parse: 'exit' }, { name: 'bad', command: 'echo nope', parse: 'json' }, { name: 'gone', command: ['/no/such/binary'] }] } }
  const lines = sweep(root, { cfg: broken, now: NOW }).lines
  assert.deepEqual(lines.slice(0, 2), ['server: down', 'bad: the check could not run (its output is not JSON)'])
  assert.match(lines[2], /^gone: the check could not run/)
  assert.match(sweep(root, { cfg: {}, now: NOW }).lines[0], /no sweep.checks/)
})
