// THE DESK WALL'S RULES, as a pure judgement: payload + who + office -> the
// reason it is refused, or null. hooks/desk-wall.mjs is the gate that calls
// this; checks/desk-wall.mjs compiles the same rules to report a dead one.
// One engine, so the gate and the check can never disagree about a rule.
import { resolve, join, sep } from 'node:path'

const GIT_READ = new Set(['status', 'log', 'diff', 'show', 'blame', 'ls-files', 'ls-tree', 'rev-parse', 'grep', 'describe', 'shortlog', 'cat-file', 'rev-list', 'whatchanged', 'name-rev', 'merge-base', 'show-ref', 'for-each-ref'])
const TMP = /^\/(private\/)?(tmp|var\/folders)\//

export function compileWall(w) {
  const rx = (p, f = '') => new RegExp(p, f)
  return {
    failClosed: w.failClosed === true,
    secrets: rx(typeof w.secrets === 'string' ? w.secrets : '\\.env\\b'),
    lockedEnv: [...new Set([...(Array.isArray(w.lockedEnv) ? w.lockedEnv : []), ...(typeof w.roleEnv === 'string' ? [w.roleEnv] : [])])].filter((v) => /^[A-Za-z_]\w*$/.test(v)),
    deny: (Array.isArray(w.deny) ? w.deny : []).map((d) => ({ re: rx(d.pattern, d.flags ?? ''), why: String(d.why ?? 'refused by this office') })),
    leadBash: Array.isArray(w.lead?.bash) ? w.lead.bash.map((p) => rx(p)) : null,
    leadWrites: w.lead?.write === true,
    footer: { desk: typeof w.footer?.desk === 'string' ? w.footer.desk : '', lead: typeof w.footer?.lead === 'string' ? w.footer.lead : '' },
  }
}

// → null (allowed) or the reason it is refused
export function judge(p, who, root, W) {
  const tool = p?.tool_name ?? ''
  const cwd = p?.cwd ? resolve(p.cwd) : process.cwd()
  const isLead = who.kind === 'lead'
  const deskDir = isLead ? null : who.dir
  const desksRoot = join(root, 'desks')

  if (tool === 'Bash') {
    const cmd = String(p?.tool_input?.command ?? '')
    const locked = W.lockedEnv.length ? new RegExp(`\\b(${W.lockedEnv.join('|')})\\s*=`) : null
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
    const inside = (a) => { const t = resolve(cwd, a); return (t + sep).startsWith(deskDir + sep) || (TMP.test(t) && !(t + sep).startsWith(root + sep)) }
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
      if ((to + sep).startsWith(desksRoot + sep) && !(to + sep).startsWith(deskDir + sep) && to !== desksRoot) return 'a desk does not go into another desk'
    }
    return null
  }
  if (tool === 'Read') {
    const f = String(p?.tool_input?.file_path ?? '')
    if (W.secrets.test(f)) return 'secret files are not read'
    const abs = resolve(cwd, f)
    const mine = deskDir ? join(deskDir, 'runtime') + sep : null
    if (/[\\/]desks[\\/][^\\/]+[\\/]runtime[\\/]/.test(abs) && !(mine && (abs + sep).startsWith(mine))) return 'another desk\'s runtime/ is not read'
    return null
  }
  if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool)) {
    if (isLead) return W.leadWrites ? null : 'the lead writes no file'
    const f = p?.tool_input?.file_path ?? p?.tool_input?.notebook_path
    if (!f) return null
    const abs = resolve(cwd, String(f))
    if (!(abs + sep).startsWith(deskDir + sep)) return `a desk writes only inside its own folder ${deskDir}, not ${abs}`
    if ((abs + sep).startsWith(join(deskDir, '.claude') + sep) || (abs + sep).startsWith(join(deskDir, 'runtime') + sep)) return '.claude/ and runtime/ are the desk\'s door and keys; the desk does not change them'
    return null
  }
  return null
}

