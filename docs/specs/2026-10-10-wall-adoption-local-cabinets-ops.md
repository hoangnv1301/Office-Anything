# Adopting the 0.7.40 wall in local-cabinets-ops

Status: PROPOSAL for the local-cabinets-ops lead. These are changes to THAT repo, never to the plugin. They were proven in a scratch copy of the office, never the live one.

## Evidence

The proof ran in a scratch copy of local-cabinets-ops: `desks/` and `scripts/` with no `runtime/`, no `.env`, no tokens, plus `office.json` and `tests/write-wall.test.mjs`.

| hook | office.json | write-wall suite |
|---|---|---|
| plugin 0.7.38 | unchanged | 16/28 (live repo) |
| plugin 0.7.40 | unchanged | 19/28 |
| plugin 0.7.40 | the changes below | **27/28** |
| their local `desks/hooks/write-wall.mjs` | unchanged | 26/28 in the same scratch copy (28/28 in the live repo) |

The one remaining failure is test 12, the freight-skill self-check. It fails for both hooks in the scratch copy, because the skill's offline check cannot run outside the real office. It does not exercise the wall.

## 1. office.json

- add `lead.aliases: ["lead"]`
- add `wall.messages: true`, `wall.noDelegation: true` and `wall.module: "desks/hooks/wall-extra.mjs"`
- REMOVE the `wall.deny` entry whose pattern starts `lcc-freight|Application Support/lcc|…`. It moves into the module, where a plain `node scripts/desk/<x>.mjs` call keeps its data exemption: a lead-note saying "osascript?" is data, not a command.

## 2. desks/alibaba-customer-service/desk.json

```json
"perCase": { "kind": "buyer-thread", "key": "BT-\\d{6}-\\d{3,}" }
```

## 3. desks/hooks/wall-extra.mjs (new)

```js
// local-cabinets-ops' own wall rules, loaded by the Office-Anything desk wall (office.json "wall.module").
// The plugin's rules run first (folder, secrets, locked variables, git, messages, no delegation, deny list);
// this adds what only this office understands. It can refuse more, never allow more.
//   alias(name)   cs-<Buyer> → desk-alibaba-customer-service--<BT> (only names the launcher recorded)
//   judge(p, who) the freight skill's one entry point and its broker, adapter-owned scripts
import { resolve } from 'node:path';
import { threadOfName, nameMap, CS_NAME } from './buyer-session.mjs';

export function alias(name) {
  if (!CS_NAME.test(String(name ?? ''))) return null;
  const t = threadOfName(name, nameMap());
  return t ? `desk-alibaba-customer-service--${t}` : null;
}

const RATE_ENTRY = /^\s*node\s+(?:\.\/)?\.claude\/skills\/freight-quote\/scripts\/rate\.mjs(?:\s+(?:--[\w-]+|'[^'`$\\]*'|"[^"`$\\]*"|[\w.,:\/@+-]+))*\s*$/;
const FREIGHT_WORDS = /rate(-keep)?\.mjs|freight-quote|login\.mjs|broker\.mjs|speedship|wwex|shopflow|lcc-freight/i;
// shell quoting walk: outside = unquoted chars, live = unquoted + double-quoted (still expanded)
function shellParts(c) {
  let q = '', outside = '', live = '';
  for (let i = 0; i < c.length; i++) {
    const ch = c[i];
    if (q === "'") { if (ch === "'") q = ''; continue; }
    if (ch === '\\') { i++; if (!q) outside += ' '; live += ' '; continue; }
    if (q === '"') { if (ch === '"') q = ''; else live += ch; continue; }
    if (ch === "'" || ch === '"') { q = ch; continue; }
    outside += ch; live += ch;
  }
  return { outside, live, open: !!q };
}

export function judge(p, who, { session = '' } = {}) {
  if (who.kind !== 'desk') return null;
  const cwd = p?.cwd ? resolve(p.cwd) : process.cwd();
  if (p?.tool_name === 'Read') {
    const f = String(p?.tool_input?.file_path ?? '');
    if (/lcc-freight|speedship-profile/i.test(f)) return '运费中介的目录（FREIGHT_HOME：SpeedShip 档案、账本、停止文件）不读';
    if (/[\\/]\.claude[\\/]channels[\\/]discord([\\/]|$)/.test(resolve(cwd, f.replace(/^~(?=\/)/, process.env.HOME ?? '~')))) return 'discord 插件的目录（机器人令牌）不读';
    return null;
  }
  if (p?.tool_name !== 'Bash') return null;
  const cmd = String(p?.tool_input?.command ?? '');
  const flat = cmd.replace(/["'\\]/g, '');
  const sp = shellParts(cmd);
  // a plain `node ../../scripts/{desk,buyer}/<x>.mjs …` with literal arguments: its arguments are data (drafts, notes)
  const plainNode = /^\s*node\s+(?:\.\.\/\.\.\/)?scripts\/(?:desk|buyer)\/[\w-]+\.mjs(?:\s|$)/.test(cmd) && !sp.open && !/\$\(|`|\$\{|<\(/.test(sp.live) && !/[;&|<>\n]/.test(sp.outside);
  if (!plainNode) {
    if (/speedship|wwex|shopflow/i.test(flat) && !RATE_ENTRY.test(cmd)) return 'SpeedShip（档案、会话、域名）只走 rate.mjs 这一个入口；别的命令不碰它';
    if ((/\brate\.mjs\b/.test(flat) && /freight-quote/.test(flat + ' ' + cwd)) || /\brate-keep\.mjs\b/.test(flat)) {
      const teammate = !!who.caseKey || /^cs-|--/.test(session) || !!process.env.LCC_BUYER_THREAD || (process.env.LCC_SESSION && process.env.LCC_SESSION !== 'desk-alibaba-customer-service');
      if (who.desk !== 'alibaba-customer-service' || teammate) return '运费只有询盘桌的主会话报（rate.mjs）。买家会话 / 别的桌子要运费：node ../../scripts/desk/lead-note.mjs "<线路、ZIP、重量、托数>" --thread <BT-…>，主桌报';
      if (!RATE_ENTRY.test(cmd) && /\brate\.mjs\b/.test(flat)) return 'rate.mjs 只按原样跑：node .claude/skills/freight-quote/scripts/rate.mjs --job … --to-zip … （不串联、不换路径）';
    }
    if (/lcc-freight|lcc\*|Application Support\/lcc|freight-quote\/scripts\/broker\.mjs|\blaunchctl\b|\bosascript\b|System Events/i.test(flat)) return '运费中介（broker.mjs、FREIGHT_HOME、它的对话框）是 owner 的，桌子不碰';
    if (/\bagent-browser\b/.test(flat) && /(^|\s)--(profile|state|auto-connect|cdp)\b|\bconnect\s|AGENT_BROWSER_(PROFILE|STATE|SESSION_NAME|AUTO_CONNECT)/.test(flat)) return '桌子的 agent-browser 不带 --profile / --state / --auto-connect / connect（登录状态是别人的）';
    if (/AGENT_BROWSER_(PROFILE|STATE|SESSION_NAME|AUTO_CONNECT)\s*=/.test(flat)) return '不换 agent-browser 的档案';
    if (FREIGHT_WORDS.test(flat) && /(^|[;&|(]\s*|\s)(script|unbuffer|expect|socat)\s/.test(flat)) return '不用 script / unbuffer / expect 伪造终端';
    const bases = [cwd];
    for (const m of cmd.matchAll(/\b(?:cd|pushd)\s+(?:"([^"]*)"|'([^']*)'|(\S+))/g)) bases.push(resolve(bases[bases.length - 1], m[1] ?? m[2] ?? m[3] ?? '.'));
    const toks = cmd.split(/[\s;&|()<>]+/).map((t) => t.replace(/^["']|["']$/g, '')).filter((t) => /login\.mjs$/.test(t));
    if (toks.some((t) => bases.some((b) => /[\\/]freight-quote[\\/]scripts[\\/]login\.mjs$/.test(resolve(b, t))))) return 'SpeedShip 登录是 owner 自己在终端跑的（login.mjs），桌子不登录、不碰密码；rate.mjs 报 LOGIN NEEDED 就经 lead 请 owner';
  }
  return null;
}
```

## 4. Switch

- Install the plugin version that carries 0.7.40.
- Restart the desks; hooks arm only on a restart.
- Run `WALL_HOOK=<plugin>/hooks/desk-wall.mjs node --test tests/write-wall.test.mjs` in the real repo.
- Then remove the local write-wall from each desk's `.claude/settings.json`, and retire the script to `bk/` with a WHY.md.
