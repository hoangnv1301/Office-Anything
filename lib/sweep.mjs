// THE LEAD'S PERIODIC CHECK, with no model in the loop: a model wakes only
// when this prints something.
//
//   node lib/sweep.mjs [root] once [--reset]
//
// office.json:
//   "sweep": { "everyMinutes": 30, "repeatHours": 3,
//              "checks": [{ "name": "server", "command": "…", "parse": "exit" }] }
//
// Each check is a command run from the office root (a string goes to /bin/sh,
// an array runs as-is). parse says what its output means:
//   lines  every non-empty line is one item
//   json   it prints [{ "key", "line" }]
//   exit   a non-zero exit is one item (its output, or "failed")
// A check that cannot run, or prints what its parse cannot read, is an item
// too: a quiet sweep has to mean the checks ran and found nothing.
// An item prints once, then again only if it is still there after repeatHours.
// Nothing new: nothing printed. State: .office/sweep-state.json.
//
// In a background shell, so a model is woken only by work:
//   until out=$(node lib/sweep.mjs once); [ -n "$out" ]; do sleep 1800; done; echo "$out"
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { findOffice, readOfficeConfig } from './office.mjs'
import { isMain } from './is-main.mjs'

export function runCheck(root, c) {
  const name = String(c.name ?? 'check')
  const cmd = c.command
  const s = Array.isArray(cmd) ? spawnSync(String(cmd[0]), cmd.slice(1).map(String), { cwd: root, encoding: 'utf8', timeout: (c.timeoutSec ?? 120) * 1000 })
    : typeof cmd === 'string' ? spawnSync('/bin/sh', ['-c', cmd], { cwd: root, encoding: 'utf8', timeout: (c.timeoutSec ?? 120) * 1000 })
    : null
  const fail = (why) => [{ key: `${name}:cannot-run`, line: `${name}: the check could not run (${why})` }]
  if (!s) return fail('no command')
  if (s.error) return fail(s.error.code === 'ETIMEDOUT' ? `timed out after ${c.timeoutSec ?? 120} s` : s.error.message)
  const out = String(s.stdout ?? '').trim()
  const parse = c.parse ?? 'lines'
  if (parse === 'exit') return s.status === 0 ? [] : [{ key: `${name}:exit`, line: `${name}: ${out.split('\n').slice(-3).join(' / ') || String(s.stderr ?? '').trim().split('\n').pop() || `failed (exit ${s.status})`}` }]
  if (s.status !== 0) return fail(`exit ${s.status}${String(s.stderr ?? '').trim() ? ': ' + String(s.stderr).trim().split('\n').pop() : ''}`)
  if (parse === 'lines') return out ? out.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => ({ key: `${name}:${l}`, line: `${name}: ${l}` })) : []
  if (parse === 'json') {
    let j; try { j = JSON.parse(out || '[]') } catch { return fail('its output is not JSON') }
    if (!Array.isArray(j)) return fail('its output is not a JSON list')
    return j.map((x) => ({ key: `${name}:${x?.key ?? JSON.stringify(x)}`, line: `${name}: ${x?.line ?? JSON.stringify(x)}` }))
  }
  return fail(`unknown parse "${parse}"`)
}

export function sweep(root, { cfg = readOfficeConfig(root), now = Date.now(), reset = false } = {}) {
  const S = cfg.sweep && typeof cfg.sweep === 'object' ? cfg.sweep : null
  if (!S || !Array.isArray(S.checks) || !S.checks.length) return { lines: ['sweep: office.json has no sweep.checks, so there is nothing to run'], configured: false }
  const repeat = (Number(S.repeatHours) || 3) * 3600e3
  const file = join(root, '.office', 'sweep-state.json')
  let state = {}
  if (!reset) { try { state = JSON.parse(readFileSync(file, 'utf8')) } catch {} }
  const next = {}
  const lines = []
  for (const c of S.checks) for (const it of runCheck(root, c)) {
    if (it.key in next) continue
    const last = state[it.key]
    if (last === undefined || now - last > repeat) { lines.push(it.line); next[it.key] = now }
    else next[it.key] = last
  }
  mkdirSync(join(root, '.office'), { recursive: true })
  if (!existsSync(join(root, '.office', '.gitignore'))) writeFileSync(join(root, '.office', '.gitignore'), '# office-anything state and logs; never committed\n*\n')
  writeFileSync(file, JSON.stringify(next))
  return { lines, configured: true }
}

if (isMain(import.meta.url)) {
  const a = process.argv.slice(2)
  const reset = a.includes('--reset')
  const rest = a.filter((x) => x !== '--reset')
  const root = findOffice(rest.length > 1 ? rest[0] : process.cwd())
  if (!root || rest[rest.length - 1] !== 'once') { console.error('usage: node lib/sweep.mjs [root] once [--reset]'); process.exit(1) }
  const { lines } = sweep(root, { reset })
  if (lines.length) console.log(`SWEEP ${new Date().toISOString().slice(11, 16)}Z: ${lines.length} item(s)\n${lines.join('\n')}`)
}
