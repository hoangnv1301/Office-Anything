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

// ⛔ THE DEFAULT FOR MCP IS "READS ONLY", NOT A LIST OF BAD WORDS. A list
// (send, share, delete, reply, forward) missed create_draft, post, upload,
// invite, trash, and a browser's computer / form_input, which can submit
// anything to anyone. A tool name leads with its verb; only a reading verb
// passes, and not when a sending word follows it (get_and_send).
const READ_VERBS = new Set(['search', 'list', 'get', 'read', 'query', 'fetch', 'describe', 'find', 'view', 'lookup', 'count', 'show', 'status'])
const SENDING = new Set(['send', 'share', 'delete', 'reply', 'forward', 'post', 'publish', 'upload', 'invite', 'submit', 'trash', 'remove', 'write', 'create', 'update'])
export function mcpReads(tool) {
  const words = String(tool).split('__').pop().toLowerCase().split(/[_-]+/).filter(Boolean)
  return READ_VERBS.has(words[0]) && !words.slice(1).some((w) => SENDING.has(w))
}

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
// the path as written, folded the same way: a symlink inside the desk is the desk's
const lit = (p) => { const r = resolve(p); return CASE_BLIND ? r.toLowerCase() : r }
const underLit = (child, parent) => (lit(child) + sep).startsWith(lit(parent) + sep)

// Shell words, as bash splits them: { t, q } (q: some part was quoted, so it
// is literal and never a glob) and { sep } for ; & | ( ) and newlines.
export function shellWords(cmd) {
  const out = []
  let cur = null
  const push = () => { if (cur) out.push(cur); cur = null }
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]
    if (c === "'") { const j = cmd.indexOf("'", i + 1); const end = j < 0 ? cmd.length : j; cur ??= { t: '', q: false }; cur.t += cmd.slice(i + 1, end); cur.q = true; i = end; continue }
    if (c === '"') { let j = i + 1, v = ''; while (j < cmd.length && cmd[j] !== '"') { if (cmd[j] === '\\' && j + 1 < cmd.length) { v += cmd[j + 1]; j += 2 } else v += cmd[j++] } cur ??= { t: '', q: false }; cur.t += v; cur.q = true; i = j; continue }
    if (c === '\\') { cur ??= { t: '', q: false }; cur.t += cmd[i + 1] ?? ''; cur.q = true; i++; continue }
    if (/\s/.test(c) && c !== '\n') { push(); continue }
    if (/[;&|()\n]/.test(c)) { push(); out.push({ sep: true }); continue }
    cur ??= { t: '', q: false }; cur.t += c
  }
  push()
  return out
}

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
    // a redirection ends the names: `read a b <<< "$x"` reads INTO a and b
    const cut = w.slice(1).findIndex((x) => /^\d*(<|>)/.test(x))
    const args = cut < 0 ? w.slice(1) : w.slice(1, 1 + cut)
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
    // names a desk may message that are NOT session identities (a session
    // named "lead" at the repo root is a developer, not the walled lead)
    messageTo: (Array.isArray(w.messageTo) ? w.messageTo : []).filter((n) => typeof n === 'string' && n),
    // compiled here too, so the desk-wall check reports a pattern that does not compile
    aliasNames: (Array.isArray(w.aliasNames) ? w.aliasNames : []).map((p) => rx(p)),
    // a desk or the lead starts no other pair of hands: no subagent, workflow,
    // cloud task or worktree. Those would run outside this wall
    noDelegation: w.noDelegation !== false,
    // MCP tools reach outsiders (mail, drives, browsers). With an allow list
    // only those run for a desk; with a deny list, all but those; with
    // neither, only a tool that READS (see mcpReads)
    mcpAllow: Array.isArray(w.mcp?.allow) ? w.mcp.allow.map((p) => rx(p, 'i')) : null,
    mcpDeny: Array.isArray(w.mcp?.deny) ? w.mcp.deny.map((p) => rx(p, 'i')) : null,
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
    if (W.mcpDeny) return W.mcpDeny.some((re) => re.test(tool)) ? `this office does not let a desk use ${tool}` : null
    return mcpReads(tool) ? null : `a desk only reads through MCP tools, and ${tool} does more than read: it can reach people outside the office (wall.mcp lets the office say otherwise)`
  }
  if (W.noDelegation && DELEGATION.test(tool)) return `a ${isLead ? 'lead' : 'desk'} starts no subagent, workflow, cloud task or worktree (${tool}): it would work outside this wall`
  if (W.messages && tool === 'SendMessage') {
    const to = String(p?.tool_input?.to ?? '').replace(/\s*\[[^\]]*\]\s*$/, '').trim()
    const canon = ctx.aliasTo ?? to
    if (W.leadNames.includes(to) || W.messageTo.includes(to)) return null
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
    // ⛔ AS BASH READS IT: >| (clobber) and >&path (stdout and stderr to a
    // file) are writes too. The old pattern took "|path" as a name that
    // resolved inside the desk, and skipped >& entirely. >&2, 2>&1 and >&-
    // duplicate or close a descriptor and write no file.
    for (const m of shell.matchAll(/(?:^|[^<>=\-])>{1,2}\|?(?:&(?![\d-]))?\s*(?:"([^"]*)"|'([^']*)'|([^\s&]\S*))/g)) targets.push(m[1] ?? m[2] ?? m[3])
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
    // ⛔ BASH READS ANOTHER DESK'S runtime/ AS EASILY AS THE READ TOOL. Only
    // Read was judged for it; `cat ../other/runtime/token.json`, a glob over
    // desks/*/runtime and `grep -r` from the repo root all passed. Each path
    // word is resolved against the cwd and every cd in the command.
    {
      // the real target, judged: another desk's runtime/, or (for a desk's
      // own path reached through a symlink) anything holding one
      const rel = (abs) => canon(abs).slice(canon(desksRoot).length).split(/[\\/]/).filter(Boolean)
      const otherRuntime = (abs) => under(abs, desksRoot) && rel(abs).length >= 2 && /^runtime$/i.test(rel(abs)[1]) && !under(abs, deskDir)
      const holdsRuntime = (abs) => under(desksRoot, abs) || (under(abs, desksRoot) && (rel(abs).length < 2 || /^runtime$/i.test(rel(abs)[1])) && !under(abs, deskDir))
      const reaches = (abs) => underLit(abs, deskDir) ? holdsRuntime(abs) : (under(desksRoot, abs) || (under(abs, desksRoot) && !under(abs, deskDir)))
      const RECURSIVE = { rg: 'pattern', find: 'all', tar: 'all', zip: 'all', rsync: 'all', du: 'all' }
      let base = cwd
      const words = shellWords(cmd)
      for (let i = 0; i <= words.length; i++) {
        if (i < words.length && !words[i].sep) continue
        // one simple command: words since the last separator
        let j = i - 1; while (j >= 0 && !words[j].sep) j--
        const w = words.slice(j + 1, i)
        let k0 = 0
        while (k0 < w.length && !w[k0].q && /^[A-Za-z_]\w*=/.test(w[k0].t)) k0++
        while (k0 < w.length && /^(nohup|builtin|command|exec|time|env)$/.test(w[k0].t)) k0++
        const prog = (w[k0]?.t ?? '').split('/').pop()
        const args = w.slice(k0 + 1)
        if (prog === 'cd' || prog === 'pushd') { const to = args.find((x) => !x.t.startsWith('-')); if (to) base = resolve(base, to.t); continue }
        const flags = args.filter((x) => !x.q && x.t.startsWith('-')).map((x) => x.t).join(' ')
        let mode = RECURSIVE[prog] ?? null
        if (/^[ef]?grep$/.test(prog) && /(^|\s)-[a-zA-Z]*[rR]/.test(flags)) mode = 'pattern'
        if (prog === 'cp' && /(^|\s)-[a-zA-Z]*[rRa]/.test(flags)) mode = 'all'
        if (prog === 'ls' && /(^|\s)-[a-zA-Z]*R/.test(flags)) mode = 'all'
        let operands = args.filter((x) => !(!x.q && x.t.startsWith('-')) && !/^\d*[<>]/.test(x.t))
        // grep and rg take the pattern first (unless -e or -f gave it)
        if (mode === 'pattern' && !/(^|\s)-[a-zA-Z]*[ef]\b/.test(flags)) operands = operands.slice(1)
        for (const x of operands) {
          const glob = !x.q && /[*?[]/.test(x.t)
          if (!mode && !glob && !/[/]/.test(x.t) && !/^\.\.?$/.test(x.t)) continue
          if (glob) {
            const prefix = x.t.slice(0, x.t.search(/[*?[]/)).replace(/[^/]*$/, '') || '.'
            if (reaches(resolve(base, prefix))) return 'a desk does not glob across other desks: their runtime/ holds their keys'
          }
          const abs = resolve(base, glob ? x.t.replace(/[*?[].*$/, '') : x.t)
          if (otherRuntime(abs)) return 'another desk\'s runtime/ is not read, by any tool'
          if (mode && reaches(abs)) return 'a desk does not walk other desks\' folders recursively: their runtime/ holds their keys (search lib/ or your own folder)'
        }
      }
    }
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
  // ⛔ GREP AND GLOB ARE READS, AND A SEARCH READS A WHOLE TREE. A desk
  // grepped another desk's runtime/ (its token) because only Read was judged.
  // Secrets are checked on the PATH fields (a search for the text ".env" in
  // code is fine); a search may not cover any desk's runtime/ but the desk's
  // own: a desk searches its own folder or outside desks/, the lead anywhere
  // that holds no runtime/.
  if (tool === 'Grep' || tool === 'Glob') {
    const i = p?.tool_input ?? {}
    const base = resolve(cwd, String(i.path ?? '.'))
    const paths = tool === 'Glob' ? [i.path, i.pattern] : [i.path, i.glob]
    if (paths.some((x) => typeof x === 'string' && x && W.secrets.test(x))) return 'secret files are not searched'
    if (tool === 'Glob' && /(^|[\\/])\.\.([\\/]|$)/.test(String(i.pattern ?? ''))) return 'a search pattern does not climb out of its folder (..)'
    if (deskDir && under(base, deskDir)) return null
    // a symlink inside the desk's own folder: the desk's, unless its real
    // target is or holds a runtime/ (another desk's whole folder included)
    if (deskDir && underLit(base, deskDir)) {
      const r = canon(base).slice(canon(desksRoot).length).split(/[\\/]/).filter(Boolean)
      const holds = under(desksRoot, base) || (under(base, desksRoot) && (r.length < 2 || /^runtime$/i.test(r[1])))
      return holds ? 'that folder links to another desk\'s runtime/' : null
    }
    if (deskDir && (under(base, desksRoot) || under(desksRoot, base))) return 'a desk searches inside its own folder, or outside desks/: anything wider reaches another desk\'s runtime/'
    if (!deskDir) {
      const rel = canon(base).slice(canon(desksRoot).length).split(/[\\/]/).filter(Boolean)
      if (under(desksRoot, base) || (under(base, desksRoot) && (rel.length < 2 || /^runtime$/i.test(rel[1])))) return 'a search here would read a desk\'s runtime/: name a folder that holds none'
    }
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

