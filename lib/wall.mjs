// THE DESK WALL'S RULES, as a pure judgement: payload + who + office -> the
// reason it is refused, or null. hooks/desk-wall.mjs is the gate that calls
// this; checks/desk-wall.mjs compiles the same rules to report a dead one.
// One engine, so the gate and the check can never disagree about a rule.
import { resolve, join, sep, dirname, basename } from 'node:path'
import { existsSync, realpathSync } from 'node:fs'
import { childOf } from './office.mjs'

const GIT_READ = new Set(['status', 'log', 'diff', 'show', 'blame', 'ls-files', 'ls-tree', 'rev-parse', 'grep', 'describe', 'shortlog', 'cat-file', 'rev-list', 'whatchanged', 'name-rev', 'merge-base', 'show-ref', 'for-each-ref'])
const TMP = /^\/(private\/)?(tmp|var\/folders)\//
const DELEGATION = /^(Agent|Task|Workflow|RemoteTrigger|EnterWorktree)$/

// ⛔ A PATH IS COMPARED AS THE DISK SEES IT. The folder checks compared the
// strings they were given: on a case-blind disk (macOS APFS, Windows) a desk
// wrote its own .CLAUDE/ and read another desk's RUNTIME/, and a symlink in
// its folder pointing out of it was "inside". So: the real path of the
// longest part that exists (symlinks resolved, .. and // gone), then the rest,
// lowercased where the disk ignores case.
const CASE_BLIND = process.platform === 'darwin' || process.platform === 'win32'
export function canon(p) {
  let cur = resolve(p)
  const rest = []
  for (;;) {
    try { cur = join(realpathSync(cur), ...rest.reverse()); break } catch {}
    const up = dirname(cur)
    if (up === cur) { cur = resolve(p); break }
    rest.push(basename(cur)); cur = up
  }
  return CASE_BLIND ? cur.toLowerCase() : cur
}
const under = (child, parent) => (canon(child) + sep).startsWith(canon(parent) + sep)

// ⛔ A LOCKED VARIABLE IS READ-ONLY, IN EVERY SPELLING. "NAME=" alone missed
// NAME+= (bash and zsh concatenate, which builds ../another-desk), export,
// unset, env -u, declare, printf -v, read, \${NAME:=x}, \${NAME#x}, quote
// splicing (OPS_TOK""EN=), eval building the name, and \${!x} indirection.
// The only allowed forms are reads: $NAME and \${NAME}.
export function touchesLocked(cmd, names) {
  const flat = String(cmd).replace(/["'\\]/g, '')
  for (const v of names) {
    const rest = flat.replace(new RegExp(`\\$${v}(?![\\w{])|\\$\\{${v}\\}`, 'g'), '')
    if (new RegExp(`\\b${v}\\b`).test(rest)) return true
  }
  // quoted text is data, so it is dropped; dropping it also joins a splice (e""val)
  const unquoted = String(cmd).replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, '')
  // eval as a word anywhere outside quotes (a wrapper does not change it:
  // builtin eval, command eval, exec eval), and \${!x} indirection
  if (/(?<![\w./-])eval(?![\w./-])/.test(unquoted) || /\$\{!/.test(flat)) return true
  // ⛔ A NAME BUILT AT RUN TIME never spells the variable: declare
  // "OPS_$(echo TOKEN)=x". Wherever the shell takes a variable NAME, the name
  // must be a literal; a substitution there is refused (values may use them).
  const subst = flat.replace(/\$\([^)]*\)|`[^`]*`|\$\{[^}]*\}|\$\w+/g, '\u00a7')
  for (const seg of subst.split(/[;&|\n()]+/)) {
    const w = seg.trim().split(/\s+/).filter(Boolean)
    while (w.length && /^(nohup|builtin|command|exec|time|sudo)$/.test(w[0])) w.shift()
    const cmd0 = w[0] ?? ''
    const args = w.slice(1)
    const dyn = (name) => name.includes('\u00a7')
    if (/^(declare|typeset|export|readonly|local|let)$/.test(cmd0)) {
      if (args.filter((a) => !a.startsWith('-')).some((a) => dyn(a.split('=')[0]))) return true
    } else if (/^(unset|read)$/.test(cmd0)) {
      if (args.filter((a) => !a.startsWith('-')).some(dyn)) return true
    } else if (cmd0 === 'printf') {
      const i = args.indexOf('-v')
      if (i >= 0 && dyn(args[i + 1] ?? '')) return true
    } else if (cmd0 === 'env') {
      for (const a of args) { if (a.startsWith('-')) continue; if (!a.includes('=')) break; if (dyn(a.split('=')[0])) return true }
    }
  }
  return false
}

export function compileWall(w) {
  const rx = (p, f = '') => new RegExp(p, f)
  return {
    failClosed: w.failClosed === true,
    // case-blind: APFS and NTFS are, so .ENV is .env
    secrets: rx(typeof w.secrets === 'string' ? w.secrets : '\\.env\\b', 'i'),
    lockedEnv: [...new Set([...(Array.isArray(w.lockedEnv) ? w.lockedEnv : []), ...(typeof w.roleEnv === 'string' ? [w.roleEnv] : [])])].filter((v) => /^[A-Za-z_]\w*$/.test(v)),
    deny: (Array.isArray(w.deny) ? w.deny : []).map((d) => ({ re: rx(d.pattern, d.flags ?? ''), why: String(d.why ?? 'refused by this office') })),
    leadBash: Array.isArray(w.lead?.bash) ? w.lead.bash.map((p) => rx(p)) : null,
    leadWrites: w.lead?.write === true,
    // who a desk or the lead may SendMessage: the lead (by name or alias), a
    // real desk, a real child of a desk, or a name the office module maps to one
    // ON once a wall exists; an office opts out with false (the lead's review:
    // a half-written office.json must not be weaker than a complete one)
    messages: w.messages !== false,
    leadNames: [w.leadSession, ...(Array.isArray(w.leadAliases) ? w.leadAliases : [])].filter((n) => typeof n === 'string' && n),
    // a desk or the lead starts no other pair of hands: no subagent, workflow,
    // cloud task or worktree. Those would run outside this wall
    noDelegation: w.noDelegation !== false,
    // MCP tools reach outsiders (mail, drives, browsers). With an allow list
    // only those run for a desk; otherwise the deny list, by default every
    // tool that sends, shares, deletes, replies or forwards
    mcpAllow: Array.isArray(w.mcp?.allow) ? w.mcp.allow.map((p) => rx(p, 'i')) : null,
    mcpDeny: (Array.isArray(w.mcp?.deny) ? w.mcp.deny : ['^mcp__.*(send|share|delete|reply|forward)']).map((p) => rx(p, 'i')),
    footer: { desk: typeof w.footer?.desk === 'string' ? w.footer.desk : '', lead: typeof w.footer?.lead === 'string' ? w.footer.lead : '' },
  }
}

// → null (allowed) or the reason it is refused
export function judge(p, who, root, W, ctx = {}) {
  const tool = p?.tool_name ?? ''
  const cwd = p?.cwd ? resolve(p.cwd) : process.cwd()
  const isLead = who.kind === 'lead'
  const deskDir = isLead ? null : who.dir
  const desksRoot = join(root, 'desks')

  if (!isLead && tool.startsWith('mcp__')) {
    if (W.mcpAllow) return W.mcpAllow.some((re) => re.test(tool)) ? null : `this office lets a desk use only the MCP tools it lists, and ${tool} is not one`
    return W.mcpDeny.some((re) => re.test(tool)) ? `a desk does not use ${tool}: it reaches people outside the office (wall.mcp lets the office say otherwise)` : null
  }
  if (W.noDelegation && DELEGATION.test(tool)) return `a ${isLead ? 'lead' : 'desk'} starts no subagent, workflow, cloud task or worktree (${tool}): it would work outside this wall`
  if (W.messages && tool === 'SendMessage') {
    const to = String(p?.tool_input?.to ?? '').replace(/\s*\[[^\]]*\]\s*$/, '').trim()
    const canon = ctx.aliasTo ?? to
    if (W.leadNames.includes(to)) return null
    const d = /^desk-([a-z][a-z0-9-]*)$/.exec(canon)
    if (d && existsSync(join(desksRoot, d[1], 'desk.json'))) return null
    if (childOf(root, canon)) return null
    return `messages go to the lead (${W.leadNames.join(' or ') || 'by name'}), a desk (desk-<name>) or a desk's case session (desk-<name>--<key>), not to "${to}". Work for a developer goes to the owner, who asks one`
  }

  if (tool === 'Bash') {
    const cmd = String(p?.tool_input?.command ?? '')
    // another Claude session or terminal started from Bash is another pair of
    // hands, outside this wall: the same refusal as the Agent tool
    if (W.noDelegation && /(?<![\w./-])(claude|orca)(?![\w./-])/.test(cmd.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, '').replace(/\\/g, ''))) return `a ${isLead ? 'lead' : 'desk'} does not start another Claude session or terminal from Bash: it would work outside this wall`
    const locked = W.lockedEnv.length ? { test: (c) => touchesLocked(c, W.lockedEnv) } : null
    if (isLead) {
      if (W.leadBash) {
        // one command, unchained: newline ; | & backtick $( chain; << and > write
        if (/[\r\n|;&`>]|\$\(|<</.test(cmd)) return 'the lead\'s Bash runs one command: no chaining, pipes or redirection'
        if (!W.leadBash.some((re) => re.test(cmd))) return 'the lead\'s Bash is limited to the commands this office lists'
      }
      if (W.secrets.test(cmd)) return 'secret files are not read'
      if (locked?.test(cmd)) return 'the role and token variables are not reassigned'
      return null
    }
    for (const d of W.deny) if (d.re.test(cmd)) return d.why
    if (W.secrets.test(cmd)) return 'secret files are not read or sourced'
    if (locked?.test(cmd)) return 'the role and token variables are not reassigned (that is taking another desk\'s keys)'
    // writes land in the desk's own folder or a temp dir. Only the TARGETS are
    // judged; reading the rest of the repo is fine.
    // ponytail: common shell write shapes only; a script that opens a file
    // for writing from inside python/node is beyond a regex (a sandbox is the
    // upgrade path).
    // (a temp dir counts as outside the office only when the office itself does not live there)
    const inside = (a) => { const t = resolve(cwd, a); return under(t, deskDir) || (TMP.test(canon(t)) && !under(t, root)) }
    // a heredoc body is data, not command: strip it, keep its marker line
    const shell = cmd.replace(/(<<-?\s*['"]?(\w+)['"]?[^\n]*)\n[\s\S]*?\n\2\s*(?=\n|$)/g, '$1 ')
    const hasCd = /\b(cd|pushd)\s/.test(shell)
    const targets = []
    for (const m of shell.matchAll(/(?:^|[^<>=\-])>{1,2}\s*(?!&)(?:"([^"]*)"|'([^']*)'|(\S+))/g)) targets.push(m[1] ?? m[2] ?? m[3])
    for (const seg of shell.split(/[;|&]+|\n/)) {
      const m = seg.match(/^\s*(?:\w+=\S+\s+)*(sed\s+-i|tee|cp|mv|rm|touch|mkdir|chmod|ln|rsync|patch)\b(.*)$/)
      if (m) for (const a of m[2].split(/\s+/)) if (/[/]|^\.\.?$/.test(a) && !/^-/.test(a)) targets.push(a.replace(/^["']|["']$/g, ''))
    }
    // ⛔ GIT IS READ-ONLY FOR A DESK, BY ALLOWLIST. A list of the writing
    // subcommands missed branch -D, clean -fdx, config, tag, worktree…; the
    // reading ones are few and stable, so anything else is refused.
    for (const g of shell.matchAll(/\bgit\s+((?:-C\s+\S+\s+|-c\s+\S+\s+|--no-pager\s+)*)([a-z][\w-]*)([^;&|\n]*)/g)) {
      const sub = g[2], rest = g[3]
      const readOnly = GIT_READ.has(sub) || (sub === 'branch' && !/(^|\s)(-[dDmMcC]\b|--delete|--move|--copy|--force|-f\b|--set-upstream|--unset-upstream|--edit-description)/.test(rest) && !/(^|\s)[\w.][\w./-]*/.test(rest))
      if (!readOnly) return 'a desk does not change the repository (git ' + sub + ' is not a read; git writes belong to a developer session)'
    }
    // NAME=/abs/path defined in the same command can be substituted; any other $var, ~ or backtick cannot be resolved, so it is refused
    const vars = Object.fromEntries([...shell.matchAll(/(?:^|[\s;&|(])([A-Za-z_]\w*)=(\/[^\s;&|]*)/g)].map((v) => [v[1], v[2]]))
    const subst = (a) => a.replace(/\$\{?([A-Za-z_]\w*)\}?/g, (_, v) => vars[v] ?? `$${v}`)
    if (targets.length && (hasCd || targets.map(subst).some((a) => /[$`~]/.test(a) || !inside(a)))) return 'a desk\'s Bash writes only inside its own folder (or a temp dir), and does not cd out to write'
    // cd: the real target path, not the string (`cd ../other` names no desks/)
    for (const m of cmd.matchAll(/\b(?:cd|pushd)\s+(?:"([^"]*)"|'([^']*)'|(\S+))/g)) {
      const arg = m[1] ?? m[2] ?? m[3] ?? ''
      if (/[$`~]/.test(arg)) return 'a cd target is written out, not taken from a variable'
      const to = resolve(cwd, arg)
      if (under(to, desksRoot) && !under(to, deskDir) && canon(to) !== canon(desksRoot)) return 'a desk does not go into another desk'
    }
    return null
  }
  if (tool === 'Read') {
    const f = String(p?.tool_input?.file_path ?? '')
    if (W.secrets.test(f)) return 'secret files are not read'
    const abs = resolve(cwd, f)
    // another desk's runtime/: judged on the real, case-folded path
    const c = canon(abs) + sep
    const inRuntime = under(abs, desksRoot) && /[\\/]desks[\\/][^\\/]+[\\/]runtime[\\/]/i.test(c)
    if (inRuntime && !(deskDir && under(abs, join(deskDir, 'runtime')))) return 'another desk\'s runtime/ is not read'
    return null
  }
  if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool)) {
    if (isLead) return W.leadWrites ? null : 'the lead writes no file'
    const f = p?.tool_input?.file_path ?? p?.tool_input?.notebook_path
    if (!f) return null
    const abs = resolve(cwd, String(f))
    if (!under(abs, deskDir)) return `a desk writes only inside its own folder ${deskDir}, not ${abs}`
    if (under(abs, join(deskDir, '.claude')) || under(abs, join(deskDir, 'runtime'))) return '.claude/ and runtime/ are the desk\'s door and keys; the desk does not change them'
    return null
  }
  return null
}

