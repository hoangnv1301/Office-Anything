// THE DESK WALL'S RULES, as a pure judgement: payload + who + office -> the
// reason it is refused, or null. hooks/desk-wall.mjs is the gate that calls
// this; checks/desk-wall.mjs compiles the same rules to report a dead one.
// One engine, so the gate and the check can never disagree about a rule.
import { resolve, join, sep, dirname, basename, relative } from 'node:path'
import { existsSync, realpathSync, statSync, readFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { fileURLToPath } from 'node:url'
import { childOf } from './office.mjs'
import { rosterSafe, deskOfSession, officeRoster, deskRoots } from './desk.mjs'

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
// ~/.claude holds every session's key file, transcripts and credentials: a
// desk reads none of it, by any tool
// ⛔ CLOSED, BUT NOT TO THE DESK'S OWN TREE. Claude Code saves a big tool
// output under projects/<the session's folder>/…/tool-results and tells the
// session to Read it; memory and the transcript live there too, and skills/
// is read-only reference. Those stay open; sessions, keys, settings and
// channels do not. Both ~/.claude and CLAUDE_CONFIG_DIR count.
// the account's own home (from the user database) as well as $HOME: ~user is the former
const passwdHome = () => { try { return userInfo().homedir } catch { return homedir() } }
const claudeHomes = () => [...new Set([process.env.CLAUDE_CONFIG_DIR, join(homedir(), '.claude'), join(passwdHome(), '.claude')].filter(Boolean))]
const slugOf = (dir) => String(dir).replace(/[^A-Za-z0-9]/g, '-')
export function claudeClosed(abs, deskDir) {
  for (const h of claudeHomes()) {
    if (!under(abs, h)) continue
    // its own project tree and skills are read-only reference; of uploads, only an image or a
    // PDF the owner sent (a folder of them, or any other file there, stays closed)
    if (deskDir && (under(abs, join(h, 'projects', slugOf(deskDir))) || under(abs, join(h, 'skills')))) return false
    if (deskDir && under(abs, join(h, 'uploads')) && /\.(jpe?g|png|gif|webp|heic|pdf)$/i.test(abs)) return false
    return true
  }
  return false
}
// a search whose folder holds a closed part of it
const claudeCovered = (base, deskDir) => claudeHomes().some((h) => under(h, base)) || claudeClosed(base, deskDir)
// ~ and ~user, as the shell expands them
const tilde = (t) => {
  if (t === '~' || t.startsWith('~/')) return homedir() + t.slice(1)
  const m = /^~([A-Za-z0-9._-]+)(?=\/|$)/.exec(t)
  if (!m) return t
  let me = null; try { me = userInfo().username } catch {}
  return (m[1] === me ? passwdHome() : join(dirname(passwdHome()), m[1])) + t.slice(m[0].length)
}
// $HOME and ${HOME} have a known value: expanded like ~, so a path built on
// them is judged where it really points (it was an "unknown expansion" whose
// empty prefix resolved inside the desk)
const homeVar = (t) => t.replace(/^\$(\{HOME\}|HOME)(?=\/|$)/, homedir())

// Shell words, as bash splits them: { t, q, g } (q: some part was quoted;
// g: an UNQUOTED glob or brace character, which the shell expands) and
// { sep } for ; & | ( ) and newlines.
// Files a command WRITES through redirections, read from shell words, so
// quoted text (node -e "a => a >/re/.test(a)") is never a redirection.
// /dev/null, /dev/stdout, /dev/stderr and /dev/fd/N are not files in anyone's
// folder. <> opens for reading AND writing.
const NOWHERE = /^\/dev\/(null|stdout|stderr|tty|fd\/\d+)$/
export function writeTargets(cmd) {
  const out = []
  for (const text of commandTexts(cmd)) out.push(...redirections(text))
  return out
}
function redirections(cmd) {
  const w = shellWords(cmd)
  const out = []
  for (let k = 0; k < w.length; k++) {
    const x = w[k]
    if (x.sep || !x.op) continue
    const m = /^(?:\d+|&)?(<>|>>|>\||>&|>)(.*)$/s.exec(x.t)
    if (!m) continue
    let target = m[2]
    if (!target) { const n = w[k + 1]; if (!n || n.sep) continue; target = n.t; k++ }
    if (m[1] === '>&' && /^(\d+|-)$/.test(target)) continue
    if (NOWHERE.test(target)) continue
    out.push(target)
  }
  return out
}

export function shellWords(cmd) {
  const out = []
  let cur = null
  const push = () => { if (cur) out.push(cur); cur = null }
  const word = () => (cur ??= { t: '', q: false })
  // $'…' as bash decodes it: \xHH, \NNN octal, \uHHHH and the usual letters
  const ansi = (body) => body.replace(/\\(x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{1,4}|[0-7]{1,3}|.)/g, (m, e) =>
    e[0] === 'x' || e[0] === 'u' ? String.fromCharCode(parseInt(e.slice(1), 16))
      : /^[0-7]/.test(e) ? String.fromCharCode(parseInt(e, 8))
        : ({ n: '\n', t: '\t', r: '\r', e: '\x1b', a: '\x07', b: '\b', f: '\f', v: '\v' })[e] ?? e)
  // the end of $(…) or `…`, so spaces inside stay in one word
  // ⛔ QUOTES INSIDE A SUBSTITUTION HIDE THEIR PARENTHESES: $(node -e 'f(a)=>b')
  // closed at the ) inside the quotes, and the rest read as a redirect
  const closeOf = (i) => {
    if (cmd[i] === '`') { let j = i + 1; while (j < cmd.length && cmd[j] !== '`') j += cmd[j] === '\\' ? 2 : 1; return Math.min(j, cmd.length - 1) }
    let depth = 0
    for (let j = i; j < cmd.length; j++) {
      const c = cmd[j]
      if (c === '\\') { j++; continue }
      if (c === "'") { const e = cmd.indexOf("'", j + 1); j = e < 0 ? cmd.length : e; continue }
      if (c === '"') { let e = j + 1; while (e < cmd.length && cmd[e] !== '"') e += cmd[e] === '\\' ? 2 : 1; j = e; continue }
      if (c === '(') depth++
      else if (c === ')' && --depth === 0) return j
    }
    return cmd.length - 1
  }
  // the commands inside $(…) and `…`, judged like any other command
  const subs = []
  const sub = (i, k) => subs.push(cmd[i] === '`' ? cmd.slice(i + 1, k) : cmd.slice(i + 2, k))
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]
    if (c === '$' && cmd[i + 1] === "'") {
      let j = i + 2, raw = ''
      while (j < cmd.length && cmd[j] !== "'") { if (cmd[j] === '\\' && j + 1 < cmd.length) { raw += cmd[j] + cmd[j + 1]; j += 2 } else raw += cmd[j++] }
      word(); cur.t += ansi(raw); cur.q = true; i = j; continue
    }
    if (c === '$' && cmd[i + 1] === '"') continue            // $"…" is a double-quoted string
    if (c === "'") { const j = cmd.indexOf("'", i + 1); const end = j < 0 ? cmd.length : j; word(); cur.t += cmd.slice(i + 1, end); cur.q = true; i = end; continue }
    if (c === '"') {
      let j = i + 1, v = ''
      word()
      while (j < cmd.length && cmd[j] !== '"') {
        if (cmd[j] === '\\' && j + 1 < cmd.length) { v += cmd[j + 1]; j += 2; continue }
        // $ and ` still expand inside double quotes
        if (cmd[j] === '$' || cmd[j] === '`') { cur.g = true; if (cmd[j] === '`' || cmd[j + 1] === '(') { const k = closeOf(cmd[j] === '`' ? j : j + 1); sub(j, k); v += cmd.slice(j, k + 1); j = k + 1; continue } }
        v += cmd[j++]
      }
      cur.t += v; cur.q = true; i = j; continue
    }
    if (c === '\\') { word(); cur.t += cmd[i + 1] ?? ''; cur.q = true; i++; continue }
    if (c === '`' || (c === '$' && cmd[i + 1] === '(')) { const k = closeOf(c === '`' ? i : i + 1); sub(i, k); word(); cur.t += cmd.slice(i, k + 1); cur.g = true; i = k; continue }
    if (/\s/.test(c) && c !== '\n') { push(); continue }
    // redirection operators stay whole: 2>&1, >&2, &>, >|, <>
    if ((c === '&' || c === '|') && cur && cur.op && /[<>]$/.test(cur.t)) { cur.t += c; continue }
    if (c === '&' && cmd[i + 1] === '>') { push(); cur = { t: '&', q: false, op: true }; continue }
    if (/[;&|()\n]/.test(c)) { push(); out.push({ sep: true }); continue }
    // an unquoted < or > starts a redirection, as its own word (x>file is x and >file)
    // ...unless it continues an operator (>>, <>) or follows a bare descriptor
    // number (2>); after an operator's target (2>&1>file) it starts a new one
    if ((c === '<' || c === '>') && !(cur && (/[<>]$/.test(cur.t) || (/^\d+$/.test(cur.t) && !cur.q)))) { push(); cur = { t: '', q: false, op: true } }
    if ((c === '<' || c === '>') && cur && /^\d+$/.test(cur.t) && !cur.q) cur.op = true
    word(); cur.t += c
    // an UNQUOTED * ? [ { or $ is expanded by the shell, whatever else in the word was quoted
    if (/[*?[{$]/.test(c)) cur.g = true
  }
  push()
  out.subs = subs
  return out
}

// every command text in a command line: itself, then what its $(…) and `…` run
// ⛔ A CAP IS A REFUSAL, NOT A PASS: past the limit a text used to be kept
// while its own substitutions were never opened. `truncated` says so.
export function commandTexts(cmd, max = 256) {
  const out = [cmd]
  let i = 0
  for (; i < out.length && out.length < max; i++) {
    const words = shellWords(out[i])
    out.push(...words.subs)
    // ⛔ sh -c '…' IS A COMMAND LINE TOO: its quoted script ran unjudged
    for (const seg of segmentsAll(words)) { const c = shellScript(simpleCommand(seg)); if (c != null) out.push(c) }
  }
  out.truncated = i < out.length
  return out
}

export const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'tcsh', 'csh'])
// the script a shell runs from -c (any short-option cluster holding c), or null
export function shellScript({ prog, args }) {
  if (!SHELLS.has(prog)) return null
  for (let a = 0; a < args.length; a++) {
    const x = args[a]
    if (!x.q && /^-[a-zA-Z]*c[a-zA-Z]*$/.test(x.t)) return args[a + 1]?.t ?? ''
  }
  return null
}
// the plain arguments: no options, no redirections, no redirection targets
export function plainArgs(args) {
  const out = []
  for (let a = 0; a < args.length; a++) {
    const x = args[a]
    if (x.op || (!x.q && /^\d*[<>]/.test(x.t))) { if (/^(?:\d+|&)?(<<<?|<>|>>|>\||>&|>|<)$/.test(x.t)) a++; continue }
    if (!x.q && x.t.startsWith('-')) continue
    out.push(x)
  }
  return out
}
// segments, plus the command find runs with -exec / -execdir / -ok / -okdir
export function segmentsAll(words) {
  const out = []
  for (const seg of segmentsOf(words)) {
    out.push(seg)
    const { prog, args } = simpleCommand(seg)
    if (prog !== 'find') continue
    for (let a = 0; a < args.length; a++) {
      if (args[a].q || !/^-(exec|execdir|ok|okdir)$/.test(args[a].t)) continue
      const inner = []
      for (a++; a < args.length && !(args[a].t === ';' || args[a].t === '+'); a++) inner.push(args[a])
      if (inner.length) out.push(inner)
    }
  }
  return out
}

// ⛔ A HEREDOC IS WHAT THE SHELL CALLS ONE. A regex blind to quotes took
// echo "<<X" for a heredoc and hid every line after it from the wall, and a
// line-at-a-time reading lost a quote opened on the line before. So the
// whole command is scanned once, carrying quotes, $( ), backticks, (( ))
// and comments across newlines; << counts only in plain command context.
// Its body, up to its delimiter, is data and is removed. ⛔ When anything is
// unclear (a line continued by \, a newline inside a quote while a heredoc
// waits, no delimiter, a body never closed, an unclosed context) NOTHING is removed: the whole
// text is judged, which can only refuse more.
export function stripHeredocs(cmd) {
  const src = String(cmd)
  if (!src.includes('<<')) return src
  const stack = ['top']
  const top = () => stack[stack.length - 1]
  const plain = () => top() === 'top' || top() === 'paren'
  let out = ''
  let pending = []
  let wordStart = true
  let i = 0
  while (i < src.length) {
    const c = src[i], ctx = top()
    if (c === '\n') {
      if (pending.length) {
        if (!plain()) return src
        out += '\n'; i++
        for (const h of pending) {
          for (;;) {
            if (i >= src.length) return src
            let e = src.indexOf('\n', i); if (e < 0) e = src.length
            const line = src.slice(i, e)
            i = e + 1
            if ((h.dash ? line.replace(/^\t+/, '') : line) === h.delim) break
          }
        }
        pending = []; wordStart = true
        continue
      }
      out += c; i++; wordStart = true; continue
    }
    if (ctx === 'sq') { out += c; i++; if (c === "'") stack.pop(); continue }
    if (c === '\\') {
      if (src[i + 1] === '\n') return src
      out += src.slice(i, i + 2); i += 2; wordStart = false; continue
    }
    if (ctx === 'dq') {
      if (c === '"') stack.pop()
      else if (c === '$' && src[i + 1] === '(') { stack.push(src[i + 2] === '(' ? 'arith' : 'paren'); out += src.slice(i, i + (src[i + 2] === '(' ? 3 : 2)); i += src[i + 2] === '(' ? 3 : 2; continue }
      else if (c === '`') stack.push('bt')
      out += c; i++; continue
    }
    if (ctx === 'arith') {
      if (c === ')' && src[i + 1] === ')') { stack.pop(); out += '))'; i += 2; continue }
      out += c; i++; continue
    }
    // top, paren, bt: command context
    if (c === '#' && wordStart) { let e = src.indexOf('\n', i); if (e < 0) e = src.length; out += src.slice(i, e); i = e; continue }
    if (c === "'") { stack.push('sq'); out += c; i++; wordStart = false; continue }
    if (c === '"') { stack.push('dq'); out += c; i++; wordStart = false; continue }
    if (c === '`') { if (ctx === 'bt') stack.pop(); else stack.push('bt'); out += c; i++; wordStart = false; continue }
    if (c === '$' && src[i + 1] === '(') {
      const ar = src[i + 2] === '('
      stack.push(ar ? 'arith' : 'paren'); out += src.slice(i, i + (ar ? 3 : 2)); i += ar ? 3 : 2; wordStart = true; continue
    }
    if (c === '(' && src[i + 1] === '(' && wordStart) { stack.push('arith'); out += '(('; i += 2; continue }
    if (c === '(') { stack.push('paren'); out += c; i++; wordStart = true; continue }
    if (c === ')') { if (ctx === 'paren') stack.pop(); out += c; i++; wordStart = true; continue }
    if (c === '<' && src[i + 1] === '<' && src[i + 2] !== '<' && ctx !== 'bt') {
      let j = i + 2
      const dash = src[j] === '-'; if (dash) j++
      while (src[j] === ' ' || src[j] === '\t') j++
      let delim = '', k = j
      while (k < src.length && !/[\s;&|<>()]/.test(src[k])) {
        if (src[k] === "'") { const e = src.indexOf("'", k + 1); if (e < 0) return src; delim += src.slice(k + 1, e); k = e + 1 }
        else if (src[k] === '"') { const e = src.indexOf('"', k + 1); if (e < 0) return src; delim += src.slice(k + 1, e).replace(/\\(.)/g, '$1'); k = e + 1 }
        else if (src[k] === '\\') { delim += src[k + 1] ?? ''; k += 2 }
        else { delim += src[k]; k++ }
      }
      if (!delim || /[\n$`]/.test(delim)) return src
      pending.push({ delim, dash })
      out += src.slice(i, k); i = k; wordStart = false; continue
    }
    if (c === '<' && src[i + 1] === '<' && ctx === 'bt') return src
    wordStart = /[\s;&|<>]/.test(c)
    out += c; i++
  }
  if (stack.length !== 1 || pending.length) return src
  return out
}

// one simple command per segment: the words between separators
export function segmentsOf(words) {
  const out = [[]]
  for (const w of words) { if (w.sep) out.push([]); else out[out.length - 1].push(w) }
  return out.filter((x) => x.length)
}

const WRITERS = new Set(['tee', 'cp', 'mv', 'rm', 'touch', 'mkdir', 'chmod', 'ln', 'rsync', 'patch', 'install', 'truncate'])
// ⛔ A WRAPPER DOES NOT CHANGE WHAT RUNS. nohup cp, timeout 5 tee, xargs cp -t,
// env FOO=1 cp, /bin/cp, \cp and "cp" all run cp; only the first word was
// looked at, so a writer behind any of them was never judged. Each wrapper's
// options (and the ones taking a value) are skipped; env -C and sudo -D
// change the folder the command runs in.
const WRAPPERS = {
  env: { value: 'uCS', chdir: 'C', long: { chdir: true, unset: false, 'split-string': false } },
  nohup: {}, command: {}, builtin: {}, time: {}, caffeinate: {}, chronic: {}, unbuffer: {}, busybox: {},
  exec: { value: 'a' }, nice: { value: 'n' }, doas: { value: 'u' },
  timeout: { value: 'sk', positional: 1, long: { signal: false, 'kill-after': false } },
  stdbuf: { value: 'ioe' },
  sudo: { value: 'ugphCDrtU', chdir: 'D', long: { user: false, group: false, chdir: true } },
  xargs: { value: 'InPLsdEa', long: { 'max-args': false, 'max-procs': false, delimiter: false, 'arg-file': false, replace: false } },
}
export function simpleCommand(words) {
  let k = 0, chdir = false
  const skipAssign = () => { while (k < words.length && !words[k].q && /^[A-Za-z_]\w*=/.test(words[k].t)) k++ }
  skipAssign()
  for (let guard = 0; guard < 16; guard++) {
    const name = (words[k]?.t ?? '').split('/').pop()
    const spec = WRAPPERS[name]
    if (!spec) break
    k++
    let positional = spec.positional ?? 0
    while (k < words.length) {
      const x = words[k]
      if (!x.q && x.t === '--') { k++; break }
      if (!x.q && x.t.startsWith('--')) {
        const m = /^--([a-z-]+)(=.*)?$/.exec(x.t)
        if (m && spec.long && m[1] in spec.long) { if (spec.long[m[1]]) chdir = true; k += m[2] ? 1 : 2; continue }
        k++; continue
      }
      if (!x.q && x.t.startsWith('-') && x.t.length > 1) {
        const ch = x.t[1]
        if (spec.chdir && spec.chdir.includes(ch)) chdir = true
        k += spec.value && spec.value.includes(ch) && x.t.length === 2 ? 2 : 1
        continue
      }
      if (name === 'env' && !x.q && /^[A-Za-z_]\w*=/.test(x.t)) { k++; continue }
      if (positional > 0) { positional--; k++; continue }
      break
    }
    skipAssign()
  }
  return { prog: (words[k]?.t ?? '').split('/').pop(), args: words.slice(k + 1), chdir }
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
  // eval, ${!x} indirection, and zsh's ${(e)…} / ${(P)…} flags, which evaluate too
  if (/(?<![\w./-])eval(?![\w./-])/.test(unquoted) || /\$\{[!(]/.test(flat)) return true
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

// ⛔ AN UNANCHORED wall.lead.bash ENTRY IS A HOLE (audit of 0.9.7): the regex ran
// as a search, so `node scripts/dev/x\.mjs add` also matched
// `rm -rf y node scripts/dev/x.mjs add`. Every entry must start with ^, and so
// must every top-level | alternative of it (`^a|b` anchors only a). A closing $
// is advised, not required: `^\s*(node \S*ops\.mjs\s+\S|ls(\s|$))` is how
// offices already write them, and the wall refuses chaining anyway. An entry
// that names a script (node/python3/bash/sh) names one real file, written
// literally, relative to the office root, inside it. A bad entry is DROPPED
// (it matches nothing) and reported: throwing would switch the whole wall off
// in an office that does not fail closed.
// {plugin} in an entry stands for THIS plugin's own folder and nothing else: exactly
// once, right after the interpreter, naming one real file inside it, never climbing.
// The wall expands it when it compiles, so an office's entry survives a plugin update.
const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN_ENTRY = /^\^node \{plugin\}\/((?:[\w-]+\/)*[\w-]+\\\.\w+)(?=[ $(])/
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// ⛔ THIS VERSION OR THE NEWER ONE CLAUDE CODE INSTALLED (0.18.8). A session
// keeps the hooks it started with, so ERP (2026-10-23) on the 0.18.4 wall
// refused its 0.18.7 doorbell and was stranded on the old bell until restarted.
// {plugin} is also a newer version that installed_plugins.json records for this
// plugin, sitting next to this one in the plugin cache, really this plugin (same
// name, a real folder there, not a link). A folder that merely appeared in the
// cache is not an install (commit security review). Never an older one: an
// update must not open a road back to a fixed bug. In a checkout, only this folder.
const SEMVER = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false }
const pluginName = (dir) => { try { return JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8')).name ?? null } catch { return null } }
export function pluginRoots(pluginRoot = PLUGIN_ROOT, { configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude') } = {}) {
  const own = basename(pluginRoot), parent = dirname(pluginRoot), name = pluginName(pluginRoot)
  if (!SEMVER.test(own) || !name) return [pluginRoot]
  let realParent, installed = []
  try {
    realParent = realpathSync(parent)
    const j = JSON.parse(readFileSync(join(configDir, 'plugins', 'installed_plugins.json'), 'utf8'))
    installed = Object.entries(j.plugins ?? {}).filter(([k]) => k.startsWith(`${name}@`)).flatMap(([, v]) => (Array.isArray(v) ? v : [])).map((e) => e?.installPath).filter((x) => typeof x === 'string')
  } catch { return [pluginRoot] }
  const ok = (d) => { const n = basename(d); try { return realpathSync(d) === join(realParent, n) && statSync(d).isDirectory() && pluginName(d) === name } catch { return false } }
  return [pluginRoot, ...[...new Set(installed.map((d) => resolve(d)))].filter((d) => SEMVER.test(basename(d)) && newer(basename(d), own) && ok(d))]
}
const expandPlugin = (p, roots) => { const r = Array.isArray(roots) ? roots : [roots]; return String(p).split('{plugin}').join(r.length === 1 ? escapeRe(r[0]) : `(?:${r.map(escapeRe).join('|')})`) }
// a doorbell command as the session runs it: {plugin} is this plugin's folder (lead.wake: "node {plugin}/lib/lead-bell.mjs")
export const wakeCommand = (w, pluginRoot = PLUGIN_ROOT) => (typeof w === 'string' ? w.trim().split('{plugin}').join(pluginRoot) : '')
// the session's own doorbell under any version {plugin} may be
const isOwnWake = (cmd, w, roots) => typeof w === 'string' && !!w.trim() && roots.some((r) => cmd === wakeCommand(w, r))
// ⛔ SECRETS NO OFFICE CAN UNLIST (security review 2026-10-20, after the lead
// could chain): env files, keys, tokens, Claude's account file and channel
// tokens, this office's /etc/lco. Matched on the command as typed AND as the
// shell reads it, so quoting a name ('.e'nv) does not hide it.
export const SECRETS_FLOOR = [
  '\\.env\\b', '\\.dev\\.vars\\b', '\\.ssh\\b', '\\.netrc\\b', '\\.pem\\b', '\\bid_(rsa|ed25519|ecdsa|dsa)\\b',
  '\\.token\\b', '\\.?credentials\\.json\\b', '\\.claude\\.json\\b', '\\.claude/channels\\b', '/etc/lco\\b', 'lead-audit\\.log\\b',
].join('|')
// and for the lead, which has no per-path ~/.claude rules the way a desk does:
// the home Claude folder except its plugins, uploads and memory folders, any ..
// after .claude/, and token files (gh-token.json)
export const LEAD_SECRETS = new RegExp([
  '(~|\\$HOME|\\$\\{HOME\\}|/Users/[^/\\s]+|/home/[^/\\s]+|/root)/\\.claude(/(?!plugins/|uploads/|projects/[^/\\s]+/memory/)|(?=[\\s\'"]|$))',
  '\\.claude/[^\\s\'"]*\\.\\.(/|$)', '[\\w-]*token[\\w-]*\\.(json|txt|key|env|ya?ml)\\b',
].join('|'), 'i')
const unquoted = (c) => c.replace(/['"\\\\]/g, '')
export const isSecret = (W, c) => W.secrets.test(c) || W.secrets.test(unquoted(c))

// ⛔ WHAT A LEAD'S COMMAND NEVER DOES, WHATEVER wall.lead.bash LISTS (security
// review 2026-10-20). Judged per chained part, on the words as the shell reads
// them (quotes removed: grep '-r' is grep -r). git takes any unambiguous prefix
// of a long option, so --upl is --upload-pack: a prefix is refused as the whole.
const GIT_NEVER = ['upload-pack', 'exec', 'output', 'ext-diff', 'textconv', 'no-index', 'git-dir', 'work-tree', 'exec-path', 'config-env', 'receive-pack']
export function leadNever(seg) {
  const w = unquoted(seg).trim().split(/\s+/)
  const prog = w[0]
  if (/^[A-Za-z_]\w*=/.test(prog)) return 'the lead sets no variable in front of a command (GIT_*=, PAGER=)'
  const longs = w.filter((x) => x.startsWith('--')).map((x) => x.slice(2).split('=')[0])
  if (prog === 'git') {
    const hit = longs.find((n) => n.length >= 2 && GIT_NEVER.some((g) => g.startsWith(n)))
    if (hit) return `git --${hit} is never run by the lead (it runs a program, writes a file or reads outside the repo)`
    if (w.some((x) => /::/.test(x) || /^-[A-Za-z]*[cC]$/.test(x) || /^-[cC]./.test(x) || x === '-o' || x === '-u')) return 'that git option or remote (-c, -C, -o, -u, ext::, fd::) is never run by the lead'
  }
  if (prog === 'grep' || prog === 'egrep' || prog === 'fgrep') {
    if (w.some((x) => /^-[A-Za-z0-9]*[rRd]/.test(x) && !x.startsWith('--')) || longs.some((n) => n.length >= 2 && ['recursive', 'dereference-recursive', 'directories', 'devices', 'file'].some((g) => g.startsWith(n))) || w.some((x) => /^-[A-Za-z0-9]*f/.test(x) && !x.startsWith('--')))
      return 'grep never recurses (-r, -R, -d, --recursive, --directories) or reads patterns from a file (-f) for the lead: name the files'
  }
  if (prog === 'gh' && (w.some((x) => x === '-w' || /^-[A-Za-z]*w$/.test(x)) || longs.some((n) => n.length >= 2 && 'web'.startsWith(n)))) return 'gh --web is never run by the lead'
  if (prog === 'jq') {
    if (w.some((x) => /^-[A-Za-z]*[fL]/.test(x) && !x.startsWith('--')) || longs.some((n) => n.length >= 2 && ['from-file', 'rawfile', 'slurpfile', 'library-path'].some((g) => g.startsWith(n)))) return 'jq never reads a program or extra files for the lead (-f, -L, --rawfile, --slurpfile)'
    if (/\benv\b|\$ENV|input_filename|\$__loc__|\$__prog/i.test(unquoted(seg))) return 'jq never reads the environment for the lead (env, $ENV)'
  }
  return null
}

// The lead's command split where the shell would split it: && ; and | outside
// quotes. -> { segments } | { refused: why }. '…' is literal; "…" only when
// nothing in it expands ($ ` \\); a backslash outside quotes is refused when
// the command has quotes too, because then the quotes cannot be read safely.
export function leadParts(cmd) {
  const no = (why) => ({ refused: why })
  if (/\\/.test(cmd) && /['"]/.test(cmd)) return no('runs no command that mixes a backslash with quotes')
  const segments = [], globs = []
  let cur = '', q = null, glob = false
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i], n = cmd[i + 1]
    if (q === "'") { cur += c; if (c === "'") q = null; continue }
    if (q === '"') { if (c === '$' || c === '`' || c === '\\') return no('runs nothing that expands inside "…": use \'…\''); cur += c; if (c === '"') q = null; continue }
    if (c === "'" || c === '"') { q = c; cur += c; continue }
    if ('*?[{'.includes(c)) glob = true
    if (c === '\r' || c === '\n') return no('runs one line: no newlines')
    if (c === '`' || (c === '$' && n === '(') || (c === '<' && n === '(')) return no('runs no command inside a command (` $( <()')
    if (c === '<' && n === '<') return no('writes no here-document (<<)')
    if (c === '2' && cmd.startsWith('2>&1', i) && (i === 0 || /\s/.test(cmd[i - 1])) && (i + 4 === cmd.length || /[\s;|&]/.test(cmd[i + 4]))) { i += 3; continue }
    if (c === '>') return no('writes no file: no > or >> (2>&1 is fine)')
    if (c === '&' && n === '&') { segments.push(cur); globs.push(glob); cur = ''; glob = false; i++; continue }
    if (c === '&') return no('runs nothing in the background (&)')
    if (c === '|' && n === '|') return no('chains with && ; or | only, not ||')
    if (c === ';' || c === '|') { segments.push(cur); globs.push(glob); cur = ''; glob = false; continue }
    cur += c
  }
  if (q) return no('runs no command with an unclosed quote')
  segments.push(cur); globs.push(glob)
  const out = segments.map((x) => x.trim())
  if (out.some((x) => !x)) return no('runs no empty command between && ; or |')
  // a glob names files the wall never sees as text (desks/runtime/*.e?v is .env):
  // only ls, which prints names and reads nothing, may take one unquoted
  const g = out.findIndex((x, k) => globs[k] && !/^ls(\s|$)/.test(x))
  if (g >= 0) return no(`names files, not globs: * ? [ { outside quotes (in "${out[g].slice(0, 60)}")`)
  return { segments: out }
}

export function leadBashProblems(list, root, pluginRoot = PLUGIN_ROOT) {
  const out = []
  ;(Array.isArray(list) ? list : []).forEach((p, i) => {
    const bad = (why) => out.push({ index: i, entry: p, why })
    if (typeof p !== 'string' || !p) return bad('is not a pattern string')
    const usesPlugin = p.includes('{plugin}')
    try { new RegExp(usesPlugin ? expandPlugin(p, pluginRoot) : p) } catch (e) { return bad(`does not compile: ${e.message}`) }
    if (!p.startsWith('^')) return bad('is not anchored: it must start with ^, or it also matches inside a longer command')
    let depth = 0, cls = false, from = 0
    const alts = []
    for (let k = 0; k < p.length; k++) {
      const c = p[k]
      if (c === '\\') { k++; continue }
      if (cls) { if (c === ']') cls = false; continue }
      if (c === '[') cls = true
      else if (c === '(') depth++
      else if (c === ')') depth--
      else if (c === '|' && depth === 0) { alts.push(p.slice(from, k)); from = k + 1 }
    }
    alts.push(p.slice(from))
    if (alts.some((x) => !x.startsWith('^'))) return bad('has a | outside any group, and an alternative that does not start with ^')
    if (usesPlugin) {
      const pm = p.split('{plugin}').length === 2 && alts.length === 1 ? PLUGIN_ENTRY.exec(p) : null
      if (!pm) return bad('uses {plugin} in a shape the wall does not accept: it must appear once, right after "node", as {plugin}/path/to/file\\.ext')
      const file = pm[1].replace(/\\\./g, '.')
      try { const real = realpathSync(join(pluginRoot, file)), top = realpathSync(pluginRoot); if (!statSync(real).isFile() || !real.startsWith(top + sep)) throw 0 } catch { return bad(`names {plugin}/${file}, which is not a file inside this plugin`) }
      return
    }
    const m = /^\^(?:node|python3?|bash|sh) ((?:[\w/-]|\\\.)+)/.exec(p)
    if (!m) return
    const lit = m[1].replace(/\\\./g, '.')
    const next = p[m[0].length]
    if (next !== undefined && next !== ' ' && next !== '$' && next !== '(') return bad(`names a script (${lit}) only in part: write the whole path, not a pattern for it`)
    if (lit.startsWith('/') || lit.startsWith('~')) return bad(`names ${lit}: a script is written relative to the office root, never absolutely`)
    if (lit.split('/').includes('..')) return bad(`names ${lit}: a script path does not climb with ..`)
    if (!root) return
    const abs = resolve(root, lit)
    let real
    try { real = realpathSync(abs); if (!statSync(real).isFile()) throw 0 } catch { return bad(`names ${lit}, which is not a file under the office root`) }
    const top = (() => { try { return realpathSync(root) } catch { return resolve(root) } })()
    if (real !== top && !real.startsWith(top + sep)) return bad(`names ${lit}, which resolves outside the office root`)
  })
  return out
}

// ⛔ WHERE {plugin} IS COMES FROM THE CALLER, NEVER FROM w. The gate spreads
// office.json's wall block into w, so a pluginRoot there would let an office
// point {plugin}, and so the lead's own doorbell, at any folder (0.18.8).
export function compileWall(w, { pluginRoot = PLUGIN_ROOT, configDir } = {}) {
  const rx = (p, f = '') => new RegExp(p, f)
  const roots = pluginRoots(pluginRoot, configDir ? { configDir } : {})
  const badBash = leadBashProblems(w.lead?.bash, w.root, pluginRoot)
  return {
    failClosed: w.failClosed === true,
    // case-blind: APFS and NTFS are, so .ENV is .env
    // the office's pattern AND the floor below: an office can add secrets, never remove one
    secrets: rx(`(?:${typeof w.secrets === 'string' && w.secrets ? w.secrets : '\\.env\\b'})|${SECRETS_FLOOR}`, 'i'),
    lockedEnv: [...new Set([...(Array.isArray(w.lockedEnv) ? w.lockedEnv : []), ...(typeof w.roleEnv === 'string' ? [w.roleEnv] : [])])].filter((v) => /^[A-Za-z_]\w*$/.test(v)),
    deny: (Array.isArray(w.deny) ? w.deny : []).map((d) => ({ re: rx(d.pattern, d.flags ?? ''), why: String(d.why ?? 'refused by this office') })),
    // only the entries that hold; the rest are named in leadBashProblems (checks/desk-wall.mjs, the refusal)
    leadBashProblems: badBash,
    leadBash: Array.isArray(w.lead?.bash) ? w.lead.bash.filter((p, i) => !badBash.some((x) => x.index === i)).map((p) => rx(expandPlugin(p, roots))) : null,
    leadWrites: w.lead?.write === true,
    leadWake: typeof w.leadWake === 'string' ? w.leadWake : '',
    leadMonitor: (Array.isArray(w.lead?.monitor) ? w.lead.monitor : []).filter((x, i, arr) => !leadBashProblems(arr, w.root, pluginRoot).some((b) => b.index === i)).map((x) => rx(expandPlugin(x, roots))),
    pluginRoots: roots,
    // who a desk or the lead may SendMessage: the lead (by name or alias), a
    // real desk, a real child of a desk, or a name the office module maps to one
    // ON once a wall exists; an office opts out with false (the lead's review:
    // a half-written office.json must not be weaker than a complete one)
    messages: w.messages !== false,
    // departments: the desks this machine runs (null = no limit). A message to
    // another department's desk reaches nobody here; the book is the handoff
    scope: w.scope instanceof Set ? w.scope : null,
    leadNames: [w.leadSession, ...(Array.isArray(w.leadAliases) ? w.leadAliases : [])].filter((n) => typeof n === 'string' && n),
    // names a desk may message that are NOT session identities (a session
    // named "lead" at the repo root is a developer, not the walled lead)
    // office.json wall.messageFallback: what a refused message should do instead (e.g. the office's tell-lead verb)
    messageFallback: typeof w.messageFallback === 'string' ? w.messageFallback.slice(0, 300) : '',
    // office.json wall.lead.devSessions: developer sessions THE LEAD (only) may
    // message, by exact name or glob (* ?). Desks gain nothing from it
    leadDevSessions: (Array.isArray(w.lead?.devSessions) ? w.lead.devSessions : []).filter((n) => typeof n === 'string' && n.trim()).map((g) => new RegExp('^' + g.trim().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$')),
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
  // ⛔ MONITOR RUNS A SHELL COMMAND TOO, and it was outside this hook's matcher:
  // a desk or the lead could run anything through it. The session's own
  // declared doorbell (desk.json wake, office.json lead.wake) always runs;
  // anything else is judged as the Bash it is.
  if (p?.tool_name === 'Monitor') {
    const cmd = String(p?.tool_input?.command ?? '').trim()
    if (!cmd) return null          // a WebSocket monitor runs no command
    const wake = who.kind === 'lead' ? W.leadWake : (() => { try { return JSON.parse(readFileSync(join(who.dir, 'desk.json'), 'utf8')).wake } catch { return '' } })()
    if (isOwnWake(cmd, wake, W.pluginRoots ?? [PLUGIN_ROOT])) return null
    // office.json wall.lead.monitor: other Monitor commands the office lets its lead run (anchored regexes)
    if (who.kind === 'lead' && W.leadMonitor.some((re) => re.test(cmd))) return null
    return judge({ ...p, tool_name: 'Bash', tool_input: { command: cmd } }, who, root, W, ctx)
  }
  const tool = p?.tool_name ?? ''
  const cwd = p?.cwd ? resolve(p.cwd) : process.cwd()
  const isLead = who.kind === 'lead'
  // a command with its relative path words rewritten from the office root: ../../scripts/x
  // run in departments/aics is scripts/x. Quoted or flag words, and paths outside the office, stay
  // (./x and ../x anywhere; a bare a/b only as the script an interpreter runs)
  // ⛔ PHYSICAL, NOT LEXICAL (security review of 0.18.2). The shell follows a
  // symlink before it walks "..": desks/x/../../scripts/y through a moved desk's
  // link is not scripts/y. A word with ".." after a real folder name is never
  // rewritten (it stays as typed and matches no root entry); otherwise both ends
  // are resolved through the disk's own links before the relative path is taken.
  const physical = (p) => { let cur = resolve(p); const rest = []; for (;;) { try { return join(realpathSync(cur), ...rest.reverse()) } catch {} const up = dirname(cur); if (up === cur) return resolve(p); rest.push(basename(cur)); cur = up } }
  const rel1 = (w) => {
    if (/(^|\/)(?!\.\.?(\/|$))[^/]+\/(.*\/)?\.\.(\/|$)/.test(w)) return w
    // from the REAL cwd: a session standing in a link (desks/x after a move) climbs from where the link points
    const abs = physical(resolve(physical(cwd), w)), base = physical(root)
    return (abs + sep).startsWith(base + sep) ? (relative(base, abs) || '.') : w
  }
  const fromRoot = (c) => String(c)
    .replace(/(^|\s)((?:node|python3?|bash|sh)\s+)(?!-)([A-Za-z0-9_][^\s'"`$;&|<>()]*\/[^\s'"`$;&|<>()]*)/g, (m0, pre, prog, w) => pre + prog + rel1(w))
    .replace(/(^|\s)(\.\.?\/[^\s'"`$;&|<>()]*)/g, (m0, pre, w) => pre + rel1(w))
  const deskDir = isLead ? null : who.dir
  // ⛔ EVERY FOLDER THAT HOLDS DESKS (0.16.0): desks/ and each department's,
  // declared or not yet created. Each runtime/ rule below asks all of them; a
  // department's own (non-desk) folders are guarded as desks' are, which only
  // ever refuses more.
  const roots = deskRoots(root).map((r) => r.dir)
  const relIn = (abs, R) => canon(abs).slice(canon(R).length).split(/[\\/]/).filter(Boolean)
  // abs is, or is inside, some desk's runtime/ (any desk: own excluded by callers)
  const anyRuntime = (abs) => roots.some((R) => under(abs, R) && relIn(abs, R).length >= 2 && /^runtime$/i.test(relIn(abs, R)[1]))
  // abs holds desks' runtime/: an ancestor of a desk root, a root itself, a desk folder, or a runtime/
  const holdsRaw = (abs) => roots.some((R) => under(R, abs) || (under(abs, R) && (relIn(abs, R).length < 2 || /^runtime$/i.test(relIn(abs, R)[1]))))
  const aboveRoots = (abs) => roots.some((R) => under(R, abs))
  const inRoots = (abs) => roots.some((R) => under(abs, R))

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
    if (isLead && W.leadDevSessions.some((re) => re.test(to))) return null
    // desk-<name>: a desk's name now. Its id, after a rename, reaches nobody (the
    // session restarts under the new name), so it is refused with the new one
    const d = /^desk-([a-z][a-z0-9-]*)$/.test(canon) ? deskOfSession(officeRoster(root).desks, canon) : null
    const away = (id) => (W.scope && !W.scope.has(id) ? `${canon} belongs to a department this machine does not run, so no session of it is here to hear you. Work for it goes through the book (an order, quote or task), which its own lead picks up` : null)
    if (d && !d.stale) return away(d.desk.name)
    if (d?.stale) return `${canon} was renamed: it is ${d.desk.session} now. Send to ${d.desk.session}`
    const kid = childOf(root, canon)
    if (kid) return away(kid.parent)
    const lead = W.leadNames.join(' or ') || 'by name'
    const fb = W.messageFallback ? ` If the lead is not reachable by name: ${W.messageFallback}` : ''
    if (/^(uds|bridge|tcp):/i.test(to)) return `a desk messages by name, never by socket or address ("${to}"): send to the lead as ${lead}.${fb}`
    return `messages go to the lead (${lead}), a desk (desk-<name>) or a desk's case session (desk-<name>--<key>), not to "${to}". Work for a developer goes to the owner, who asks one.${fb}`
  }

  if (tool === 'Bash') {
    const cmd = String(p?.tool_input?.command ?? '')
    // ⛔ BOUNDED BEFORE IT IS PARSED: 30,000 nested ${ took 6.6 s to refuse
    // against a 5 s budget. Real commands nest a few levels.
    { let d = 0, max = 0; for (let i = 0; i < cmd.length && max <= 64; i++) { if (cmd[i] === '$' && (cmd[i + 1] === '{' || cmd[i + 1] === '(')) { d++; if (d > max) max = d } else if (cmd[i] === '}' || cmd[i] === ')') d = Math.max(0, d - 1) }
      if (max > 64 || cmd.length > 200_000) return 'this command is nested too deeply (or is too long) to judge, so it is not run' }
    if (commandTexts(cmd).truncated) return 'this command holds more nested commands than the wall reads, so it is not run'
    // another Claude session or terminal started from Bash is another pair of
    // hands, outside this wall: the same refusal as the Agent tool
    if (W.noDelegation && /(?<![\w./-])(claude|orca)(?![\w./-])/.test(cmd.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, '').replace(/\\/g, ''))) return `a ${isLead ? 'lead' : 'desk'} does not start another Claude session or terminal from Bash: it would work outside this wall`
    const locked = W.lockedEnv.length ? { test: (c) => touchesLocked(c, W.lockedEnv) } : null
    if (isLead) {
      if (W.leadBash) {
        // chained with && ; or |, each part one listed command (owner 2026-10-20:
        // "let the lead do things as needed"). Still refused: a newline, a lone &
        // (background), backticks, $( and <( (a command inside a command), << and
        // > or >> (writes). 2>&1 joins stderr to stdout and writes no file.
        const parts = leadParts(cmd)
        if (parts.refused) return `the lead's Bash ${parts.refused}`
        for (const seg of parts.segments) { const no = leadNever(seg); if (no) return no }
        // ⛔ ROOT-RELATIVE (0.18.2): a lead in departments/aics runs node ../../scripts/x;
        // the office lists ^node scripts/x. A segment is matched as what it RUNS: its
        // relative paths written from the office root. So `node scripts/x` typed there
        // is departments/aics/scripts/x, and matches no root entry
        const off = parts.segments.find((seg) => !W.leadBash.some((re) => re.test(fromRoot(seg))))
        if (off != null) return `the lead's Bash is limited to the commands this office lists${parts.segments.length > 1 ? ` (not listed: "${off.slice(0, 80)}")` : ''}` + (W.leadBashProblems.length ? ` (${W.leadBashProblems.length} wall.lead.bash entr${W.leadBashProblems.length > 1 ? 'ies are' : 'y is'} not used: ${W.leadBashProblems.map((x) => `[${x.index}] ${x.why}`).join('; ')})` : '')
      }
      if (isSecret(W, cmd) || LEAD_SECRETS.test(cmd) || LEAD_SECRETS.test(unquoted(cmd))) return 'secret files are not read'
      if (locked?.test(cmd)) return 'the role and token variables are not reassigned'
      return null
    }
    // the office's refusals, as typed and written from the root (a desk one level deeper types ../../../scripts)
    for (const d of W.deny) if (d.re.test(cmd) || d.re.test(fromRoot(cmd))) return d.why
    if (isSecret(W, cmd)) return 'secret files are not read or sourced'
    if (locked?.test(cmd)) return 'the role and token variables are not reassigned (that is taking another desk\'s keys)'
    // writes land in the desk's own folder or a temp dir. Only the TARGETS are
    // judged; reading the rest of the repo is fine.
    // ponytail: common shell write shapes only; a script that opens a file
    // for writing from inside python/node is beyond a regex (a sandbox is the
    // upgrade path).
    // (a temp dir counts as outside the office only when the office itself does not live there)
    const inside = (a) => { const t = resolve(cwd, a); return under(t, deskDir) || (TMP.test(canon(t)) && !under(t, root)) }
    // ⛔ NO OFFICE INSIDE A DESK (0.18.6, a security review of local-cabinets-ops' move): an office's hook command that falls back to
    // the session's own folder would run <desk>/desks/hooks/*.mjs. A desk never writes that shape: desks/, departments/ or office.json
    const plants = (a) => { const t = resolve(cwd, a); if (!under(t, deskDir)) return false; const segs = canon(t).slice(canon(deskDir).length).split(/[\\/]/).filter(Boolean); return segs.some((x) => /^(desks|departments)$/i.test(x)) || /^office\.json$/i.test(segs.at(-1) ?? '') }
    // a heredoc body is data, not command: strip it, keep its marker line
    const shell = stripHeredocs(cmd)
    let hasCd = /\b(cd|pushd)\s/.test(shell)
    const targets = []
    // ⛔ AS BASH READS IT: >| (clobber) and >&path (stdout and stderr to a
    // file) are writes too. The old pattern took "|path" as a name that
    // resolved inside the desk, and skipped >& entirely. >&2, 2>&1 and >&-
    // duplicate or close a descriptor and write no file.
    targets.push(...writeTargets(shell))
    for (const text of commandTexts(shell)) for (const seg of segmentsAll(shellWords(text))) {
      const { prog, args: w, chdir } = simpleCommand(seg)
      if (chdir) hasCd = true                         // env -C / sudo -D: writes land somewhere else
      // sed: the script is a script, only the files after it are written
      // (a script like '/^import/d' looked like an absolute path), parsed as
      // sed reads its options: -e/-f attached, separate or long form
      if (prog === 'sed' && w.some((x) => !x.q && /^(-[a-zA-Z]*[iI]|--in-place)/.test(x.t))) {
        let script = false
        for (let a2 = 0; a2 < w.length; a2++) {
          const x = w[a2]
          if (x.q || !x.t.startsWith('-') || x.t === '-') { if (!script) { script = true; continue } targets.push(x.t); continue }
          if (x.t === '--') { for (let b2 = a2 + 1; b2 < w.length; b2++) { if (!script) { script = true; continue } targets.push(w[b2].t) } break }
          const long = /^--([a-z-]+)(=.*)?$/.exec(x.t)
          if (long) { if (long[1] === 'expression' || long[1] === 'file') { script = true; if (!long[2]) a2++ } continue }
          for (let c = 1; c < x.t.length; c++) {
            const ch = x.t[c]
            if (ch === 'e' || ch === 'f') { script = true; if (c === x.t.length - 1) a2++; break }
            if (ch === 'l') { if (c === x.t.length - 1) a2++; break }
            if (ch === 'i' || ch === 'I') { if (c === x.t.length - 1 && w[a2 + 1] && (w[a2 + 1].t === '' || /^\./.test(w[a2 + 1].t))) a2++; break }
          }
        }
        continue
      }
      // ⛔ A TARGET GIVEN AS AN OPTION: cp -t../../lib x, mv --target-directory=…
      if (/^(cp|mv|install|ln)$/.test(prog)) for (let a2 = 0; a2 < w.length; a2++) {
        const x = w[a2]
        if (x.q) continue
        if (x.t === '-t' || x.t === '--target-directory') { if (w[a2 + 1]) targets.push(w[++a2].t); continue }
        const m1 = /^(?:-t(.+)|--target-directory=(.+))$/.exec(x.t)
        if (m1) targets.push(m1[1] ?? m1[2])
      }
      if (prog === 'dd') for (const x of w) { const m2 = /^of=(.+)$/.exec(x.t); if (m2 && !NOWHERE.test(m2[1])) targets.push(m2[1]) }
      if ((prog === 'perl' || prog === 'ruby') && w.some((x) => !x.q && /^-[a-zA-Z]*i/.test(x.t))) {
        let script = false
        for (let a2 = 0; a2 < w.length; a2++) {
          const x = w[a2]
          if (!x.q && x.t.startsWith('-')) { const e = x.t.search(/[eE]/); if (e > 0) { script = true; if (e === x.t.length - 1) a2++ } continue }
          if (!script) { script = true; continue }
          targets.push(x.t)
        }
      }
      // the plain writers: every path-like operand is a target
      // (after env -C / sudo -D every operand is somewhere else, so every one counts)
      if (WRITERS.has(prog)) for (const x of w) if (!(!x.q && x.t.startsWith('-')) && (chdir || /[/]|^\.\.?$/.test(x.t))) targets.push(x.t)
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
    if (targets.length) {
      // the refusal names what was refused and where it may write instead
      const bad = targets.find((a) => /[$`~]/.test(subst(a)) || !inside(subst(a)) || canon(resolve(cwd, subst(a))) === canon(join(deskDir, 'desk.json')))
      const planted = targets.find((a) => !/[$`~]/.test(subst(a)) && plants(subst(a)))
      if (planted) return `a desk does not build an office inside its own folder (a desks/ or departments/ folder, or an office.json: ${planted}): an office's hooks could be made to run it`
      if (hasCd || bad) return `a desk's Bash writes only inside its own folder ${deskDir} (or a temp dir)${bad ? `, not ${bad}` : ''}${hasCd ? ', and does not cd out to write' : ''}. Save it there and tell the lead where it is`
    }
    // ⛔ BASH READS ANOTHER DESK'S runtime/ AS EASILY AS THE READ TOOL. Only
    // Read was judged for it; `cat ../other/runtime/token.json`, a glob over
    // desks/*/runtime and `grep -r` from the repo root all passed. Each path
    // word is resolved against the cwd and every cd in the command.
    {
      // the real target, judged: another desk's runtime/, or (for a desk's
      // own path reached through a symlink) anything holding one
      const otherRuntime = (abs) => anyRuntime(abs) && !under(abs, deskDir)
      const holdsRuntime = (abs) => aboveRoots(abs) || (holdsRaw(abs) && !under(abs, deskDir))
      const reaches = (abs) => underLit(abs, deskDir) ? holdsRuntime(abs) : (aboveRoots(abs) || (inRoots(abs) && !under(abs, deskDir)))
      const RECURSIVE = { rg: 'pattern', find: 'all', tar: 'all', zip: 'all', rsync: 'all', du: 'all' }
      // where the shell stands: one folder after a plain cd; after popd, cd -
      // or a bare cd it cannot be followed, so every folder seen counts
      // NAME=value set in this command line has a known value: H=$HOME; cat $H/…
      const known = {}
      for (const m of cmd.matchAll(/(?:^|[\s;&|(])([A-Za-z_]\w*)=("[^"]*"|'[^']*'|[^\s;&|]*)/g)) {
        const v = tilde(homeVar(m[2].replace(/^["']|["']$/g, '')))
        if (v.startsWith('/') && !/[$`]/.test(v)) known[m[1]] = v
      }
      const expand = (t) => homeVar(t).replace(/^\$\{?([A-Za-z_]\w*)\}?(?=\/|$)/, (m0, v) => known[v] ?? m0)
      // heredoc bodies are data here too: `python3 - <<'EOF'` with a helper named sh,
      // or a file written whose first line is #!/bin/sh, is not a shell reading them
      for (const text of commandTexts(shell)) {
      let bases = [cwd]
      const seen = new Set([cwd])
      for (const w of segmentsAll(shellWords(text))) {
        const { prog, args, chdir } = simpleCommand(w)
        // ⛔ A SHELL WITH NO -c AND NO SCRIPT FILE READS ITS SCRIPT FROM STDIN: a
        // heredoc or a pipe the wall never sees (bash <<EOF, echo … | sh)
        if (SHELLS.has(prog) && shellScript({ prog, args }) == null && !plainArgs(args).length) return 'a desk does not feed a shell a script from a pipe or a heredoc: the wall cannot see it (write a script file, or use sh -c)'
        if (chdir) bases = [...seen]
        if (prog === 'popd' || ((prog === 'cd' || prog === 'pushd') && !args.some((x) => !(x.t.startsWith('-') && !x.q)))) { bases = [...seen]; continue }
        if (prog === 'cd' || prog === 'pushd') {
          const to = args.find((x) => !(x.t.startsWith('-') && !x.q))
          if (to.t === '-' && !to.q) { bases = [...seen]; continue }
          bases = [...new Set(bases.map((b) => resolve(b, to.t)))]
          for (const b of bases) seen.add(b)
          continue
        }
        const flags = args.filter((x) => !x.q && x.t.startsWith('-')).map((x) => x.t).join(' ')
        let mode = RECURSIVE[prog] ?? null
        if (/^[ef]?grep$/.test(prog) && /(^|\s)-[a-zA-Z]*[rR]/.test(flags)) mode = 'pattern'
        if (prog === 'cp' && /(^|\s)-[a-zA-Z]*[rRa]/.test(flags)) mode = 'all'
        if (prog === 'ls' && /(^|\s)-[a-zA-Z]*R/.test(flags)) mode = 'all'
        let operands = args.filter((x) => !(!x.q && x.t.startsWith('-')) && !/^\d*[<>]/.test(x.t))
        // <file reads it: cat <../other/runtime/token, $(<file)
        const inputs = w.filter((x) => (x.op || !x.q) && /^\d*<(?![<>&])(.+)$/s.test(x.t)).map((x) => ({ ...x, t: x.t.replace(/^\d*</, '') }))
        // grep and rg take the pattern first (unless -e or -f gave it)
        if (mode === 'pattern' && !/(^|\s)-[a-zA-Z]*[ef]\b/.test(flags)) operands = operands.slice(1)
        for (const x0 of [...operands, ...inputs]) for (const base of bases) {
          const home = expand(x0.t)
          const x = home === x0.t ? x0 : { ...x0, t: home, g: /[*?[{`]|\$/.test(home) }
          const glob = !!x.g
          // an unknown variable leading into a .claude folder: where it points cannot be judged
          if (/^\$[^/]*\/(?:.*\/)?\.claude(?:\/|$)/.test(x.t)) return 'a path built on an unknown variable into a .claude folder cannot be judged, so it is not read'
          if (!mode && !glob && !/[/]/.test(x.t) && !/^(\.\.?|~)$/.test(x.t)) continue
          if (glob) {
            const prefix = x.t.slice(0, x.t.search(/[*?[{$`]/)).replace(/[^/]*$/, '') || '.'
            if (reaches(resolve(base, prefix))) return 'a desk does not glob across other desks: their runtime/ holds their keys'
          }
          const abs = resolve(base, tilde(glob ? x.t.replace(/[*?[{$`].*$/, '') : x.t))
          if (claudeClosed(abs, deskDir) || (mode && claudeCovered(abs, deskDir))) return 'a desk does not read Claude Code\'s own folder (session keys, transcripts, credentials)'
          if (otherRuntime(abs)) return 'another desk\'s runtime/ is not read, by any tool'
          // a single FILE another desk keeps outside its runtime/ (its facts.md) is readable
          let isFile = false
          try { isFile = !glob && statSync(abs).isFile() } catch {}
          if (mode && !isFile && reaches(abs)) return 'a desk does not walk other desks\' folders recursively: their runtime/ holds their keys (search lib/ or your own folder)'
        }
      }
      }
    }
    // cd: the real target path, not the string (`cd ../other` names no desks/)
    for (const m of cmd.matchAll(/\b(?:cd|pushd)\s+(?:"([^"]*)"|'([^']*)'|(\S+))/g)) {
      const arg = m[1] ?? m[2] ?? m[3] ?? ''
      if (/[$`~]/.test(arg)) return 'a cd target is written out, not taken from a variable'
      const to = resolve(cwd, arg)
      if (roots.some((R) => under(to, R) && canon(to) !== canon(R)) && !under(to, deskDir)) return 'a desk does not go into another desk'
    }
    return null
  }
  if (tool === 'Read') {
    const f = String(p?.tool_input?.file_path ?? '')
    if (W.secrets.test(f)) return 'secret files are not read'
    const abs = resolve(cwd, tilde(f))
    if (deskDir && claudeClosed(abs, deskDir)) return 'a desk does not read Claude Code\'s own folder (session keys, transcripts, credentials)'
    // another desk's runtime/: judged on the real, case-folded path
    const inRuntime = anyRuntime(abs)
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
    const base = resolve(cwd, tilde(String(i.path ?? '.')))
    if (deskDir && (claudeClosed(base, deskDir) || claudeCovered(base, deskDir))) return 'a desk does not search Claude Code\'s own folder (session keys, transcripts, credentials)'
    const paths = tool === 'Glob' ? [i.path, i.pattern] : [i.path, i.glob]
    if (paths.some((x) => typeof x === 'string' && x && W.secrets.test(x))) return 'secret files are not searched'
    if (tool === 'Glob' && /(^|[\\/])\.\.([\\/]|$)/.test(String(i.pattern ?? ''))) return 'a search pattern does not climb out of its folder (..)'
    if (deskDir && under(base, deskDir)) return null
    // a Glob rooted above desks/ whose fixed prefix stays out of it (lib/**/*.ts)
    if (deskDir && tool === 'Glob' && aboveRoots(base)) {
      const pat = String(i.pattern ?? '')
      // a pattern that can climb back (.., a brace holding one) is judged as a search of the root
      const fixed = /(^|\/)\.\.(\/|$)|\{|\\/.test(pat) ? '' : pat.split(/[*?[]/)[0].replace(/[^/]*$/, '')
      const at = resolve(base, fixed || '.')
      if (fixed && !aboveRoots(at) && !inRoots(at) && !claudeCovered(at, deskDir)) return null
    }
    // another desk's single FILE outside its runtime/ (its facts.md), as Bash may read it
    if (deskDir && tool === 'Grep') {
      let isFile = false
      try { isFile = statSync(base).isFile() } catch {}
      if (isFile && !anyRuntime(base)) return null
    }
    // a symlink inside the desk's own folder: the desk's, unless its real
    // target is or holds a runtime/ (another desk's whole folder included)
    if (deskDir && underLit(base, deskDir)) {
      return holdsRaw(base) ? 'that folder links to another desk\'s runtime/' : null
    }
    if (deskDir && (inRoots(base) || aboveRoots(base))) return 'a desk searches inside its own folder, or outside desks/: anything wider reaches another desk\'s runtime/'
    if (!deskDir) {
      if (holdsRaw(base)) return 'a search here would read a desk\'s runtime/: name a folder that holds none'
    }
    return null
  }
  if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool)) {
    if (isLead) return W.leadWrites ? null : 'the lead writes no file'
    const f = p?.tool_input?.file_path ?? p?.tool_input?.notebook_path
    if (!f) return null
    const abs = resolve(cwd, String(f))
    if (!under(abs, deskDir)) return `a desk writes only inside its own folder ${deskDir}, not ${abs}`
    { const segs = canon(abs).slice(canon(deskDir).length).split(/[\\/]/).filter(Boolean)
      if (segs.some((x) => /^(desks|departments)$/i.test(x)) || /^office\.json$/i.test(segs.at(-1) ?? '')) return `a desk does not build an office inside its own folder (a desks/ or departments/ folder, or an office.json: ${abs}): an office's hooks could be made to run it` }
    if (under(abs, join(deskDir, '.claude')) || under(abs, join(deskDir, 'runtime'))) return '.claude/ and runtime/ are the desk\'s door and keys; the desk does not change them'
    if (canon(abs) === canon(join(deskDir, 'desk.json'))) return 'desk.json says who this desk is (its kind decides what it may do); the desk does not change it'
    return null
  }
  return null
}

