// THE NATIVE BASH SANDBOX, PER DESK: the guarantee under the string wall.
//
//   node lib/sandbox.mjs [root] show <desk>    print the settings a desk would get
//   node lib/sandbox.mjs [root] on <desk>      desk.json "sandbox": true
//   node lib/sandbox.mjs [root] off <desk>     desk.json "sandbox": false (the rollback)
//
// A desk with "sandbox": true in its desk.json is started with
// `--settings .office/sandbox/<desk>.json` (lib/start.mjs). Its own
// .claude/settings.json is never edited, so nothing changes in a running
// session. Claude Code enforces it at the OS (Seatbelt on macOS) for Bash,
// Monitor and every process they start: node -e, python -c, pipes. The Read,
// Write and Edit tools are outside it; the desk wall still judges those.
//
// Verified on 2.1.289 (scratch office, 2026-10-10):
// - allowUnsandboxedCommands defaults to TRUE: a blocked command was retried
//   with dangerouslyDisableSandbox and the write went through. It is false
//   here, passed on the command line, and a desk's own settings file could not
//   turn it back on.
// - with allowedDomains alone, `curl https://example.com` got through the
//   proxy (200) while node fetch was blocked; strictAllowlist closes it.
// - ⛔ the session's own TMPDIR is always writable: an office living under it
//   would be writable by every sandboxed desk, so that is refused.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, realpathSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { homedir, tmpdir, userInfo } from 'node:os'
import { readOfficeConfig, findOffice } from './office.mjs'
import { isMain } from './is-main.mjs'

const real = (p) => { try { return realpathSync(p) } catch { return resolve(p) } }
const slugOf = (dir) => String(dir).replace(/[^A-Za-z0-9]/g, '-')

// the folders no sandboxed session may live in: its own temp dir is writable
export function underSessionTmp(root, env = process.env) {
  const tmps = [env.TMPDIR, tmpdir(), '/tmp/claude-' + (process.getuid?.() ?? '')].filter(Boolean).map(real)
  const r = real(root) + sep
  return tmps.some((t) => r.startsWith(t.replace(/\/$/, '') + sep))
}

export function sandboxSettings(root, deskName, cfg = readOfficeConfig(root)) {
  if (underSessionTmp(root)) throw new Error(`the office (${root}) lives under the session's temp folder, which every sandboxed session may write: move it before sandboxing a desk`)
  const desks = join(root, 'desks')
  const deskDir = join(desks, deskName)
  const desk = JSON.parse(readFileSync(join(deskDir, 'desk.json'), 'utf8'))
  const S = cfg.sandbox && typeof cfg.sandbox === 'object' ? cfg.sandbox : {}
  const others = readdirSync(desks, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== deskName).map((e) => join(desks, e.name, e.name === 'runtime' ? '' : 'runtime'))
  const homes = [...new Set([process.env.CLAUDE_CONFIG_DIR, join(homedir(), '.claude'), join(userInfo().homedir, '.claude')].filter(Boolean))]
  const hosts = [...new Set(['localhost', '127.0.0.1', ...(Array.isArray(S.hosts) ? S.hosts : []), ...(Array.isArray(desk.hosts) ? desk.hosts : [])].map(String))]
  return {
    sandbox: {
      enabled: true,
      allowUnsandboxedCommands: false,
      failIfUnavailable: true,
      filesystem: {
        allowWrite: [real(deskDir), '/tmp', '/private/tmp'],
        denyRead: [...others.map(real), real(join(root, '.env')), real(join(root, '.dev.vars')), ...homes],
        // Claude Code's own folder stays closed, but for the desk's own project tree and skills
        allowRead: homes.flatMap((h) => [join(h, 'projects', slugOf(deskDir)), join(h, 'skills')]),
      },
      network: { allowedDomains: hosts, strictAllowlist: true, allowLocalBinding: true },
    },
  }
}

export function writeSandbox(root, deskName) {
  const dir = join(root, '.office', 'sandbox')
  mkdirSync(dir, { recursive: true })
  if (!existsSync(join(root, '.office', '.gitignore'))) writeFileSync(join(root, '.office', '.gitignore'), '# office-anything state and logs; never committed\n*\n')
  const f = join(dir, `${deskName}.json`)
  writeFileSync(f, JSON.stringify(sandboxSettings(root, deskName), null, 2))
  return f
}

export function setSandbox(root, deskName, on) {
  const f = join(root, 'desks', deskName, 'desk.json')
  const d = JSON.parse(readFileSync(f, 'utf8'))
  d.sandbox = !!on
  writeFileSync(f, JSON.stringify(d, null, 2) + '\n')
  return `desk ${deskName}: sandbox ${on ? 'on' : 'off'}. It takes effect when that desk is started again (close its tab, then /desk-start ${deskName}).`
}

if (isMain(import.meta.url)) {
  const a = process.argv.slice(2)
  const root = (a.length > 2 ? findOffice(a.shift()) : findOffice(process.cwd()))
  const [verb, desk] = a
  if (!root || !['show', 'on', 'off'].includes(verb) || !desk) { console.error('usage: node lib/sandbox.mjs [root] show|on|off <desk>'); process.exit(1) }
  try {
    if (verb === 'show') console.log(JSON.stringify(sandboxSettings(root, desk), null, 2))
    else console.log(setSandbox(root, desk, verb === 'on'))
  } catch (e) { console.error(`sandbox: ${e.message}`); process.exit(1) }
}
