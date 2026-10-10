# Per-case child sessions: one session per case, under its parent desk

Status: CONTRACT FROZEN 2026-10-10 for 0.9.0. The §Contract section is what a project adapter implements; changes after this are versioned (a `contract` field will be added to perCase if it ever changes). Requested by local-cabinets-ops on 2026-10-10. Scope set by the maintainer's owner: generic machinery in core, the case data and the claim store in the project.

## The incident this answers

One design desk carried five jobs in one conversation (WestIndies, Marcel, Maria, Liset, Abdullah). It mirrored one kitchen from another job's line and had to revert. The customer-service desk already avoids this with one session per buyer thread (`desk-alibaba-customer-service--BT-…`, claim + heartbeat in the project's book), built as a 68 KB project-only launcher. Core makes that pattern available to any desk.

## Shape

- **The parent desk stays.** `desk-<parent>` keeps everything that is not one case: new work with no session yet, sweeps, cross-case questions, relaying to children, closing and reaping, and the lead's direct messages.
- **A child is one interactive Claude Code session for one case key**, named `desk-<parent>--<key>`. It is the parent in every respect that matters to the office:
  - same folder (cwd `desks/<parent>`)
  - same role variable (office.json `roleEnv` = `desk-<parent>`)
  - same token and principal
  - same desk wall and CLAUDE.md, same facts and runtime
  - it signs as the parent toward the project (the adapter sees `session` = its canonical name)
- **A child never takes a suffix of its own.** `desk-a--k--j` is not a session name; the wall refuses it.
- **Case-less work stays with the parent.** A child refuses work for another key and hands it back to the parent.

### Native Claude Code primitive per piece

| piece | primitive | custom code only because |
|---|---|---|
| liveness, name, status, idle time | session registry `~/.claude/sessions/<pid>.json` (`name`, `pid`, `status`, `statusUpdatedAt`) | none |
| identity and wall inherited | the existing desk wall PreToolUse hook (`hooks/desk-wall.mjs`), which already reads identity from the session name | parsing the `--<key>` suffix |
| boot brief for the case | SessionStart hook (`hooks/desk-boot.mjs`) injects the case brief | none |
| messages parent↔child, lead→child | SendMessage between sessions | none |
| doorbell | Monitor, armed and proven exactly as in 0.7.38 | none |
| opening a child | `claude --name desk-<parent>--<key>` in the terminal adapter (orca) | Claude Code has no "open a session" API; subagents share the parent's turn and context, and that is the mixing this exists to stop |
| claim store | the project's own backend, through the adapter | the plugin has no database, by doctrine |

## Contract (what a project adapter implements)

The adapter is one command declared per desk, run from the desk's folder, with a JSON request on argv[2] and JSON on stdout. Exit 0 on an answer, including refusals; non-zero means "the adapter itself failed", and core treats it as UNKNOWN, never as a grant.

```json
// desk.json
"perCase": {
  "kind": "design-job",
  "key": "^[A-Z]{2}-\\d{6}-\\d{3}$",
  "max": 3,
  "idleCloseMinutes": 60,
  "adapter": "node ../../scripts/desk/design-cases.mjs"
}
```

| field | required | meaning |
|---|---|---|
| `kind` | yes | a label shown on the board, e.g. `design-job`, `buyer-thread` |
| `key` | yes | a regex every case key must match in full. It must not allow `--`, `/` or whitespace (validated at load) |
| `max` | no, default 3 | live children of this parent at once. Further cases queue with the parent |
| `idleCloseMinutes` | no, default 60 | a child idle this long (registry `status: idle`, `statusUpdatedAt` older) is closed and its claim released |
| `adapter` | yes | the command below |

### Operations

Every request carries `"op"` and `"desk"` (the parent's name). `session` is always the child's canonical name `desk-<parent>--<key>`.

| op | request extra | answer |
|---|---|---|
| `open` | none | `{"cases":[{"key","title","brief"}]}`: cases that need a session now, oldest first. `brief` is the text the child boots with |
| `claim` | `key`, `session` | `{"ok":true}`, or `{"ok":false,"status":409,"holder":"<session>"}` when another session holds it |
| `heartbeat` | `claims:[{key,session}]` | `{"lost":[{"key","holder"}]}`: claims that are no longer this session's. Core closes those children |
| `release` | `key`, `session`, `why` | `{"ok":true}` (idempotent) |
| `forceRelease` | `key`, `by`, `said` | `{"ok":true,"was":"<session>"}`. `said` is the human's words, required and recorded (an override must cost something) |
| `supersede` (optional) | `key`, `session`, `ref` | `{"ok":true}`. The project marks older work on that case as replaced. Core only relays it |

### Rules core enforces regardless of the adapter

- **A claim is taken before a child opens**, renewed by heartbeat (default every 60 s), and released when the child closes or is found dead. A lapsed claim (no heartbeat within 3 intervals) is the project's to expire.
- **Duplicate guard per (parent, key):** two live registry entries with the same canonical name.
  - The newer one is told to stop at boot, by SessionStart.
  - The wall refuses the newer one's tools until the older is gone.
  - The board shows it RED.
  - The parent and a child can never collide: the parent has no suffix.
- **Cap:** never more than `max` live children per parent. Case `open` beyond the cap queues with the parent. The machine load is reported, never used to exceed the cap.
- ⛔ **Never `claude --continue` in a desk folder.** Children share the parent's cwd, and `--continue` resumes the NEWEST conversation there. After the 2026-10-10 SSD crash, a recovery resumed a child's conversation (`cs-WestIndies`) as the parent desk, and the parent believed it was the child.
  - `office start` and `office recover` resume a session only by explicit id (`--resume <id>`).
  - The id is that session's OWN conversation, found by its name record in the transcript.
  - Conversations that belong to children, or are open in another live session, are skipped.
  - Nothing found means a fresh start.
- **Lead → parent forwarding:** the parent's boot brief instructs it to relay a lead message that carries a case key matching `perCase.key` to that child with SendMessage, or to open the child first if none is live. Core supplies `office case route <text>`, which prints the child's name or `parent`.

## Not in core

- What a case is, its brief, and the claim table: the project adapter.
- Promise watchdog and idempotent proposal keys: they need the project's server. They stay in the project.

## Tests (each red before green)

- naming: canonical name built and parsed; a bad key or a double suffix refused
- identity, wall, CLAUDE.md and runtime inherited from the parent
- adapter claim / 409 / heartbeat lost / release / forceRelease (requires `said`), against a fake adapter
- duplicate guard per (parent, key)
- idle close
- the cap queues the extra case
- case-less work stays with the parent
- `office case route` picks the right child
- adapter failure is UNKNOWN, never a grant
