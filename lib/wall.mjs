// THE DESK WALL'S RULES, as a pure judgement: payload + who + office -> the
// reason it is refused, or null. hooks/desk-wall.mjs is the gate that calls
// this; checks/desk-wall.mjs compiles the same rules to report a dead one.
// One engine, so the gate and the check can never disagree about a rule.
import { resolve, join, sep, dirname, basename } from 'node:path'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
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
    // its own project tree and skills are read-only reference; of uploads, only an image file
    // the owner sent (a folder of them, or any other file there, stays closed)
    if (deskDir && (under(abs, join(h, 'projects', slugOf(deskDir))) || under(abs, join(h, 'skills')))) return false
    if (deskDir && under(abs, join(h, 'uploads')) && /\.(jpe?g|png|gif|webp|heic)$/i.test(abs)) return false
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
      if (under(to, desksRoot) && !under(to, deskDir) && canon(to) !== canon(desksRoot)) return 'a desk does not go into another desk'
    }
    return null
  }
  if (tool === 'Read') {
    const f = String(p?.tool_input?.file_path ?? '')
    if (W.secrets.test(f)) return 'secret files are not read'
    const abs = resolve(cwd, tilde(f))
    if (deskDir && claudeClosed(abs, deskDir)) return 'a desk does not read Claude Code\'s own folder (session keys, transcripts, credentials)'
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
    const base = resolve(cwd, tilde(String(i.path ?? '.')))
    if (deskDir && (claudeClosed(base, deskDir) || claudeCovered(base, deskDir))) return 'a desk does not search Claude Code\'s own folder (session keys, transcripts, credentials)'
    const paths = tool === 'Glob' ? [i.path, i.pattern] : [i.path, i.glob]
    if (paths.some((x) => typeof x === 'string' && x && W.secrets.test(x))) return 'secret files are not searched'
    if (tool === 'Glob' && /(^|[\\/])\.\.([\\/]|$)/.test(String(i.pattern ?? ''))) return 'a search pattern does not climb out of its folder (..)'
    if (deskDir && under(base, deskDir)) return null
    // a Glob rooted above desks/ whose fixed prefix stays out of it (lib/**/*.ts)
    if (deskDir && tool === 'Glob' && under(desksRoot, base)) {
      const pat = String(i.pattern ?? '')
      // a pattern that can climb back (.., a brace holding one) is judged as a search of the root
      const fixed = /(^|\/)\.\.(\/|$)|\{|\\/.test(pat) ? '' : pat.split(/[*?[]/)[0].replace(/[^/]*$/, '')
      const at = resolve(base, fixed || '.')
      if (fixed && !under(desksRoot, at) && !under(at, desksRoot) && !claudeCovered(at, deskDir)) return null
    }
    // another desk's single FILE outside its runtime/ (its facts.md), as Bash may read it
    if (deskDir && tool === 'Grep') {
      let isFile = false
      try { isFile = statSync(base).isFile() } catch {}
      const r = canon(base).slice(canon(desksRoot).length).split(/[\\/]/).filter(Boolean)
      if (isFile && !(under(base, desksRoot) && r.length >= 2 && /^runtime$/i.test(r[1]))) return null
    }
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

