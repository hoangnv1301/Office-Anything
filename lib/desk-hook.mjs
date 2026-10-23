// DOES EVERY DESK CARRY THE OFFICE'S OWN WALL HOOK (0.19.4)? Read by health.
//
// An office may keep a wall of its own beside the plugin's (local-cabinets-ops:
// office/hooks/write-wall.mjs, in each desk's .claude/settings.json). Its audit
// lived in that office (desks/checks/write-wall.mjs); health owns it now, so it
// is looked at every two minutes instead of when somebody runs it.
//
//   office.json  "wall": { "deskHook": "office/hooks/write-wall.mjs" }
//
// A desk passes when one PreToolUse entry in its .claude/settings.json
//   - matches every tool that writes: Bash, Write, Edit, MultiEdit, NotebookEdit,
//   - runs a command whose script resolves to that file (through any link:
//     desks/hooks -> office/hooks is the same file) or to the plugin's own
//     hooks/desk-wall.mjs, and
//   - keeps its refusal: nothing after that node call but `|| exit 2`
//     (an allowlist: `|| true`, `; exit 0` and the rest all fail open),
// and no layer the desk's session loads (.claude/settings.json and
// settings.local.json) sets disableAllHooks (commit security review, 0.19.4).
// $R and ${R} are the office root (the commands compute it from the project
// dir), $CLAUDE_PROJECT_DIR is the desk's folder, ${CLAUDE_PLUGIN_ROOT} the
// plugin. No "deskHook": nothing is asked, exactly as before.
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const real = (f) => { try { return statSync(f).isFile() ? realpathSync(f) : null } catch { return null } }

export const deskHookOf = (cfg) => (typeof cfg?.wall?.deskHook === 'string' && cfg.wall.deskHook.trim() ? cfg.wall.deskHook.trim() : null)

// the scripts a hook command runs, with the variables it may use filled in
// -> [{ path, tail }]: tail is the command after that node call
export function hookScripts(cmd, { root, deskDir, pluginRoot = PLUGIN_ROOT }) {
  const out = []
  for (const m of String(cmd).matchAll(/node\s+("([^"]+)"|'([^']+)'|(\S+))/g)) {
    const raw = m[2] ?? m[3] ?? m[4]
    const p = raw.replace(/\$\{?CLAUDE_PROJECT_DIR\}?/g, deskDir).replace(/\$\{?CLAUDE_PLUGIN_ROOT\}?/g, pluginRoot).replace(/\$\{R\}|\$R\b/g, root)
    if (/\$/.test(p)) continue
    out.push({ path: resolve(deskDir, p), tail: String(cmd).slice(m.index + m[0].length) })
  }
  return out
}
const WRITERS = ['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit']
const KEEPS = /^\s*(\|\|\s*exit\s+2\s*;?\s*)?$/

// -> null when the desk carries it, else why not
export function deskHookProblem(root, desk, spec, { pluginRoot = PLUGIN_ROOT } = {}) {
  const want = real(join(root, spec))
  if (!want) return `office.json wall.deskHook names ${spec}, which is not a file in the office`
  const plugin = real(join(pluginRoot, 'hooks', 'desk-wall.mjs'))
  const file = join(desk.dir, '.claude', 'settings.json')
  let s
  try { s = JSON.parse(readFileSync(file, 'utf8')) } catch (e) { return e.code === 'ENOENT' ? `has no .claude/settings.json, so no wall hook (${spec})` : `its .claude/settings.json cannot be read (${e.message}), so its wall hook is not known` }
  for (const layer of [['settings.json', s], ['settings.local.json', (() => { try { return JSON.parse(readFileSync(join(desk.dir, '.claude', 'settings.local.json'), 'utf8')) } catch (e) { return e.code === 'ENOENT' ? null : { unreadable: e.message } } })()]]) {
    if (layer[1]?.unreadable) return `its .claude/${layer[0]} cannot be read (${layer[1].unreadable}), so whether its hooks run is not known`
    if (layer[1]?.disableAllHooks) return `its .claude/${layer[0]} sets disableAllHooks: no hook of the desk runs, the wall included`
  }
  const entries = Array.isArray(s?.hooks?.PreToolUse) ? s.hooks.PreToolUse : []
  let named = null
  for (const e of entries) {
    for (const h of Array.isArray(e?.hooks) ? e.hooks : []) {
      if (typeof h?.command !== 'string') continue
      const run = hookScripts(h.command, { root, deskDir: desk.dir, pluginRoot }).find((x) => { const r = real(x.path); return r && (r === want || r === plugin) })
      if (!run) continue
      let re = null
      try { re = new RegExp(`^(?:${e.matcher ?? ''})$`) } catch {}
      const covers = e.matcher == null || e.matcher === '' || e.matcher === '*' || (re && WRITERS.every((t) => re.test(t)))
      if (!covers) { named = `its wall hook's matcher "${e.matcher}" does not cover every tool that writes (${WRITERS.join(', ')})`; continue }
      if (!KEEPS.test(run.tail)) { named = `its wall hook does not keep its refusal: after the node call it runs "${run.tail.trim().slice(0, 60)}", where only "|| exit 2" is kept`; continue }
      return null
    }
  }
  return named ?? `its .claude/settings.json runs no PreToolUse hook resolving to ${spec}`
}
