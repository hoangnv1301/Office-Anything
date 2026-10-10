# Changelog

## 0.7.43

Full real integration is PENDING: it runs on the first real desk restart of
the live office. A scratch-office run found the two launcher bugs fixed below,
but could not finish without switching the owner's Orca window, which was
ruled out. Its scratch tabs opened in the background and sat at a
folder-trust dialog.

- START AND RECOVER ARE IN THE PLUGIN: `/desk-start <name|all|lead|everything>`
  and `/desk-recover` (`lib/start.mjs`). Native primitives: the session
  registry (`~/.claude/sessions`) for "is it up", `claude --resume <id>` and
  `--name`, and the office's terminal adapter (orca).
  - "Up" is the registry saying the session is idle, never a prompt on
    screen. The first launcher waited for "? for shortcuts", which bypass
    mode never shows, and reported every desk failed while all of them came
    up.
  - ⛔ A desk resumes its OWN last conversation, by id (`lib/conversation.mjs`):
    the newest whose every recorded session name is the desk's, and that no
    live session has open. Never `--continue`: after a disk disconnect,
    `--continue` resumed the newest conversation in a desk's folder, which
    was a case session's, and the parent desk woke up as that case.
  - A start never opens a second session under a live name (the duplicate
    guard). A desk that is alive but restored outside its folder, or running
    another session's conversation, is reported, never killed.
  - `/desk-recover` starts the lead first, then every autostart desk.
  - `office.json` `launch`: terminal, flags, model, lead flags,
    `lead.resume`, waitSec. Flags, models and session ids are checked to be
    plain words, never shell.
- Found by the first real run: Orca opens tabs only inside a workspace it
  knows, and the office root need not be one. The launcher now uses the
  Orca workspace that contains the office, and `cd`s to each target's
  absolute folder.
- A claude that started but never registered (it sits at a dialog nobody
  can see: an untrusted folder, or a tab opened in the background with no
  screen) is reported as exactly that, not as "never started".
- Heal restarts a dead desk through core start when `office.json` says
  `"start": "office:start"`, so an office keeps no versioned plugin path.
  Without a `start`, heal still invents no restart.
## 0.7.42

These follow a third security review of the wall. Each has a test that was red first (`tests/wall-hardening.test.mjs`).

- REDIRECTS AS BASH READS THEM. `>|path` was parsed as a file called
  "|path", which resolved inside the desk while bash wrote outside it, and
  `>&path` was skipped entirely. Both are judged as writes now. `>&2`,
  `2>&1` and `>&-` write no file and still pass.
- GREP AND GLOB ARE READS. Only Read was judged, so a desk could grep
  another desk's `runtime/` (its token) or a `.env`. The hook's matcher now
  includes Grep and Glob.
  - Secrets are checked on their path fields; a search for the text
    ".env" in code is fine.
  - A search may not cover any desk's `runtime/` but the desk's own. A desk
    searches its own folder or outside `desks/`; the repo root is refused
    because it contains every desk. The lead may search anywhere that holds
    no `runtime/`.
  - A Glob pattern may not climb out with `..`.
- BASH DOES NOT READ ANOTHER DESK'S `runtime/` EITHER. Only the Read tool
  was judged for it, so `cat ../other/runtime/token.json`, a glob over
  `desks/*/runtime` and `grep -r` from the repo root all passed. Each path
  word in a desk's command is now resolved against the cwd and every `cd`
  in the command. Refused:
  - a path into another desk's `runtime/`;
  - a glob whose fixed part is at or above `desks/`, or inside another desk;
  - a recursive command (`grep -r`, `rg`, `find`, `tar`, `zip`, `rsync`,
    `cp -r`, `ls -R`) aimed at or above `desks/`, or at another desk.
  Reading another desk's facts and searching `lib/` still pass.

## 0.7.41

These are the follow-ups to a second security review of the 0.7.40 wall. Each has a test that was red first (`tests/wall-hardening.test.mjs`).

- THE HOOK JUDGES UNLESS IT WAS IMPORTED. Started by a wrapper (`node -e`, a
  loader), argv[1] was not the hook's own file, so the hook "was not main",
  did nothing and exited 0: an allow. It now runs unless another script
  imported it.
- MCP: THE DEFAULT IS "READS ONLY". 0.7.40's list of bad words (send, share,
  delete, reply, forward) missed create_draft, post, upload, invite, trash,
  and a browser's computer / form_input, which can submit anything to
  anyone. A tool now passes only when its name leads with a reading verb
  (search, list, get, read, query, fetch, find, view, …) and no sending word
  follows (get_and_send). `wall.mcp.allow` and `wall.mcp.deny` still decide
  when an office sets them.
- The office module's worker and its deadline no longer `unref()`. A
  hanging module was denied in practice, but only because something else
  happened to keep the process alive.

## 0.7.40

- THE DESK WALL TAKES AN OFFICE'S OWN RULES. One office kept its own wall
  beside the plugin's, and its suite passed 16 of 28 against the plugin wall.
  New, each off until office.json sets it (native primitive: PreToolUse hook):
  - `wall.messages`: a desk or the lead may SendMessage only the lead
    (`lead.session` or `lead.aliases`), a real desk, or a real case session of
    one. The hook's matcher now includes SendMessage.
  - `wall.noDelegation`: no Agent, Task, Workflow, RemoteTrigger or worktree
    for a desk or the lead.
  - `wall.module`: an ES module inside the office adds `judge()` rules and
    `alias()` names. It runs after the plugin's rules, so it can refuse more
    and never allow more. It is told the session's own name.
  - desk.json `perCase.key`: `desk-<name>--<key>` is a case session of that
    desk, behind the same wall. A key that does not match in full, or that
    carries `--`, a slash or whitespace, is refused.
- A LOCKED VARIABLE IS READ-ONLY IN EVERY SPELLING. `NAME=` alone missed `+=`,
  `export`, `unset`, `env -u`, `declare`, `printf -v`, `read`, `${NAME:=…}`,
  `${NAME#…}`, quote splicing, `eval` and `${!…}`.
  A name built at run time is refused wherever the shell takes a variable name
  (`declare "OPS_$(echo TOKEN)=x"`, `unset $N`, `printf -v "$N"`, `env
  "X_$(…)=v"`), and `eval` is refused as a word anywhere outside quotes
  (`builtin eval`, `command eval`, `exec eval`). Values may still use
  substitutions (`export PATH=$PATH:…`).
- With `wall.noDelegation`, starting `claude` or `orca` from Bash is refused
  as well: another session or terminal is another pair of hands.
- Known limit, unchanged: a string wall cannot see inside a script, so a desk
  that writes `NAME=x` into a file of its own and sources it is not caught.
  A sandbox is the upgrade path.
- Core stays generic: a test refuses any project word in core code. Comments
  may still tell the history of a fault.
- THE WALL HOLDS UNDER REVIEW. These are the six fixes from the local-cabinets-ops
  lead's security review, each with a test that was red first
  (`tests/wall-hardening.test.mjs`):
  1. A hook started through a symlinked path (macOS `/tmp` → `/private/tmp`,
     a linked plugin root) judged nothing and allowed. `isMain` now compares
     real paths.
  2. An office.json that exists but cannot be read was read as `{}`, which
     meant no wall. Now a session that claims a desk is refused until the
     file is fixed, and a developer at the root can still fix it. A payload
     the hook cannot read is refused in a walled office.
  3. `failClosed` is the default once an office has a wall; an office opts
     out with `false`. The office module runs in a worker with a 2 s
     deadline, so a missing, throwing or hanging module refuses a desk.
     The hook keeps its own deadline rather than relying on what Claude Code
     does when a hook times out; the hooks.json entry also carries a
     `timeout` of 10 s.
  4. MCP tools were never checked. Now the matcher includes `mcp__.*`, and
     `wall.mcp` holds `allow` or `deny` patterns. The default denies a desk
     every tool that sends, shares, deletes, replies or forwards.
  5. A case-blind disk let a desk write its own `.CLAUDE/` and read another
     desk's `RUNTIME/`, and a symlink in its folder counted as inside it.
     Paths are now compared as real paths (symlinks, `..` and `//`
     resolved), case-folded on macOS and Windows; the secrets pattern is
     case-blind.
  6. `wall.messages` and `wall.noDelegation` are on once a wall exists; an
     office opts out with `false`.
## 0.7.39

- A FOURTH DESK KIND: `liaison`. It is for a desk that talks to the team on a
  channel (coworkers, partners), never to customers. Like `channel`, it is
  given a sender only once it is live. Before this, desk.json refused the kind,
  so desk health reported a working team-channel desk as "unreadable" and
  stopped watching it.
- The send-wall gate now reads the issue table instead of a list of kind
  names. A `lead` desk, which is never issued a sender, used to pass the gate,
  and so would any kind added later.

## 0.7.38

- ALIVE AND IDLE IS NOT LISTENING. After a Mac restart every desk came back
  resumed with no doorbell running (a resumed session does not restore its
  Monitors), and the registry still said idle. lib/health.mjs asks the process
  tree instead: a desk with `wake` is armed only when that command runs under
  its own session's pid. It also reports each desk's session, permission
  mode, status and last activity, office.json `health` checks, and orphan
  doorbells whose session is gone. `/desk-health`; the `desk-health` check
  puts it on the board. Exit 0 / 4 / 7 like every check.
- `--heal` acts only within the powers the office granted: kill a proven
  orphan (re-proven the moment before), restart a dead desk through
  office.json `start` (3 per hour per desk), run a check's own `heal`, and
  leave alerts for the lead in .office/alerts.log, one per subject per 15
  minutes. It never types into a desk. Every act is logged.
- `--install-watchdog` runs `--heal` every 120 s from a LaunchAgent, through
  a shim on the home disk (~/Library/Application Support/office-anything/)
  that finds the plugin's CURRENT install, so a version bump does not strand
  it.
- New desk.json fields: `wakeMatch`, `wakeGraceSec`, `wakeOwner: "launchd"`,
  `watch: true` (a desk with autostart:false that must still be running).
  New office.json keys: `start`, `health`, `watchdog`.
- After review: a doorbell is the interpreter `wake` names running the
  script (a pager, editor or grep naming it is not); an orphan has only
  shells and node above it up to launchd and its script inside this office;
  a session file whose pid was reused is not a live session; every kill
  re-reads the process table and requires the same command, parent and an
  age no younger; one heal at a time (lock), the budget spent before the
  act; logs rotate and .office/ ignores itself; the LaunchAgent carries
  PATH, runs node through env, is ProcessType Standard, keeps its shim and
  log on the home disk, says once an hour when the office disk is missing,
  and refuses temp folders and git worktrees.
- An orphan whose script cannot be placed in this office (a relative path,
  a cwd nobody can read) is listed as unproven, never dropped and never
  killed. Seen live: five buyer-wake processes, 1 to 30 hours old.
- After the second review: an orphan is PROVEN only by an exact form, never
  a parse: after node, the raw command is the desk's own wake script run from
  the desk's folder, or that script's exact absolute path (a path with a space
  is compared as written). A linter given the file, --require, a worktree
  under the office, or a sibling folder sharing its prefix is not ours. A
  shell is never the doorbell, even under wakeMatch. The heal lock belongs to
  a live pid (never taken by age), is taken over atomically and released only
  while it is ours; the budget is re-read before every spend; a desk
  restarted in the last 5 minutes is left to register. The shim honours
  CLAUDE_CONFIG_DIR and runs the newest install that exists.
- After the third review: `node lib/health.mjs --heal` HUNG (exit 13, an
  unsettled top-level await): heal.mjs imported health.mjs while the CLI was
  still evaluating it, and the unit tests, calling heal() directly, could not
  see it. The process primitives live in lib/procs.mjs now; a test runs the
  CLI. The heal lock is held only by a live pid that touched it within twice
  the longest act (a reused pid, like pid 1, no longer blocks healing
  forever); a stale lock is taken over by the one contender that creates
  heal.lock.takeover, never by moving a lock that might be live (six
  contenders over a crashed lock had produced two holders); a skipped heal
  says why. A doorbell under a path with a space is recognised by the same
  exact forms as the orphan proof.
- The boot hook's doorbell line now asks for Monitor timeout_ms 1800000 and
  to re-arm on every expiry notice: a Monitor dies at 30 minutes at most,
  and "persistent" is not a setting it has.

## 0.7.37

- THE DESK WALL AND DESK BOOT MOVE INTO THE PLUGIN. Every office that ran
  desks for long wrote the same two hooks: a gate that keeps each desk inside
  its own folder (no writes elsewhere, no secrets, no other desk's keys, no
  walking into another desk, a lead that only runs the commands it is given),
  and a start-up note that tells a restarted desk who it is and where its
  memory is. They are `hooks/desk-wall.mjs` and `hooks/desk-boot.mjs` now,
  with the rules in `lib/wall.mjs` and identity in `lib/office.mjs`, and every
  business-specific part (refused commands and their reasons, the lead's
  commands, which files are memory, the words used) in `office.json`.
- ⛔ OFF UNTIL ASKED. A plugin hook runs in every project it is installed in;
  both do nothing without the `wall` / `boot` sections in `office.json`.
- IDENTITY FOLLOWS THE SESSION: the declared role variable, then the session
  name from the CLI's registry (it survives `--resume` at the repo root,
  which drops both the folder and the variable), then the folder. A session
  claiming a desk the office does not have is refused.
- FAILS OPEN BY DEFAULT, as every gate here does; `wall.failClosed` lets an
  office whose wall is its only door refuse a desk call it cannot judge.
- GIT IS READ-ONLY FOR A DESK BY ALLOWLIST (status, log, diff, show, …).
  The source office listed the writing subcommands and missed `branch -D`,
  `clean -fdx`, `config`, `tag`, `worktree`; review caught it.
- THE WALL FOLLOWS THE SESSION OUT OF THE REPO (review). It found the
  office only from the payload's cwd, so a desk that cd'd to /tmp had no
  wall. It now asks CLAUDE_PROJECT_DIR first (the session's own folder,
  which cd does not move), then the cwd, and the role variable from
  `office.json`. With `failClosed`, a wall that breaks while judging refuses
  (the `|| exit 2` the source office had), including an uncaught crash.
- A NEW CHECK, `desk-wall`: a rule that does not compile (the gate cannot
  apply it), and any desk record running a command the office audits for.
- MIGRATING an office that has its own copies: add the sections, install
  this version, restart the desks; the two walls agree while both run. Then
  remove the old hook lines from each desk's settings and retire the scripts.

## 0.7.36

- BETWEEN DESKS: an office-wide timeline of every desk-to-desk message, read
  from both ends (a desk's SendMessage calls and the peer messages it
  received), one line per message, with the asks nobody has answered marked
  and counted beside the desks. A closing "done, thanks" is not an ask.
- EACH DESK SAYS WHAT IT IS DOING in the CLI's own words (working, running a
  command, waiting on you and on what), and a desk running Remote Control
  gets an "open in the Claude app" button.
- THE COMPOSER SAYS ITS ROAD before you type: the desk's inbox, its
  terminal, or why it cannot be reached. A question's option is answered in
  the desk's own dialog; multi-select, multi-question and plan approval point
  to the Claude app instead of typing words into a dialog.
- THE EXTENSION POINT: `panels` in `office.json`. A project lists a read-only
  command per panel and the board shows its items beside the desks; the
  board itself stays free of any one business's nouns.
- ⛔ ONLY THE BOARD PAGE MAY WRITE (review). Each board process mints a
  token and hands it only to the page it serves; every writing request
  carries it back, on top of the Host/Origin/JSON guard. A panel command runs
  only on that guarded POST, never on a GET a link or image tag could fire.
  An answer sends the id of the question it answers.
- /model offers the aliases and today's ids (claude-opus-5-5,
  claude-fable-5-1, claude-sonnet-5, claude-haiku-4-5-20251001).
- RATES RECHECKED against the reference (as of 2026-06-24): Opus 5.5 is
  $4/$20 with $0.20 cache reads, and had been billed as Opus 5 because
  `claude-opus-5` is a prefix of its id; Fable 5.1 reads cache at $0.25. The
  rates' date now shows beside every estimate instead of in a hidden card.

## 0.7.35

- BROWSERS START WHEN A DESK BROWSES, NOT WHEN THE OFFICE STARTS. The owner's
  first complaint about the office was a screen full of Chrome windows every
  time it came up, one per desk, most of them for desks that never opened a
  page. `/desk-board` no longer opens a browser at all: it hands over the
  link and opens it only when asked.
- A NEW CHECK, `browser-on-demand`, reads every hook Claude Code fires by
  itself (SessionStart, Setup, UserPromptSubmit) in the office's and each
  desk's settings, and the local script each one runs, for the shapes that
  launch a browser. A browser MCP that starts its browser on its first tool
  call is the rule working, and passes. What it cannot see, it says: a launchd
  job or keeper loop outside the repo is the other place to look.

## 0.7.34

- THE BOARD TALKS THROUGH THE SESSION'S OWN INBOX. Every interactive Claude
  Code session registers a messaging socket and a key beside its session
  record; that is where SendMessage delivers. The board now sends there first
  (one auth line, one message line in the CLI's own envelope, "from office
  board"), so a message reaches a busy desk without typing into its terminal.
  The orca keystrokes stay as the fallback.
- ⛔ IT NEVER CLAIMS A PERMISSION MODE. A session running with permissions
  bypassed holds a message that asserts no mode, for approval at its own
  screen. Forging the mode would launder the owner's permission decision, so
  for such a desk the board types into the terminal instead, or says plainly
  why it cannot.
- KEYSTROKES INTO AN OPEN DIALOG ARE ANSWERS. Typing a message while a desk
  showed a question put the text into the dialog, where a leading digit picks
  an option. The terminal road now refuses while a dialog is open.
- ANSWERING A QUESTION IS ITS OWN ACT: `POST /api/answer` presses the chosen
  option's number, which the CLI's choice list takes and submits (verified on
  a live dialog). A plan approval, several questions on tabs and multi-select
  are refused with where to answer them instead of being approximated.
- REVIEW FIXES, before release:
  - Delivered means the desk's own record shows the words queued (its
    enqueue entry); a socket that merely closed is not delivery, and the
    terminal fallback runs instead.
  - The session, its transcript and its terminal tab are resolved together;
    the tab is the one named for that session, never just one at its folder.
    A named lead that is not running gets nothing.
  - An answer carries the id of the question it answers, and is refused
    unless the live session says it is waiting on that very question.
  - Every writing request must come from this board: its own Host (or one
    `office.json` lists under `board.hosts`), a same-host Origin when the
    browser sends one, and `application/json`. A page on another site could
    otherwise POST text/plain to 127.0.0.1 and type into a desk.

## 0.7.33

- MESSAGES THAT ARRIVE MID-TURN ARE CHAT. Claude Code records a message that
  reaches a busy session as an attachment (`queued_command`), not a user
  entry, and the board read only user entries: one desk's session was missing
  75 messages, another 41, the owner's own mid-turn corrections among them.
  They are parsed by origin now (the owner, a peer by its envelope, a
  background task as an event), through the same classifier as a user entry,
  and de-duplicated by the command's own id across incremental reads.
- EVERY LIVE STATUS, NOT TWO. The roster tested `busy` and `waiting` only, so
  a desk in `shell` (a command running in the foreground) read as idle. Every
  status the CLI writes now has a state, `waiting` says what it waits on, and
  an unknown status is shown as-is rather than guessed.
- THE REMOTE CONTROL LINK rides each row: a session the owner can drive from
  the Claude app carries its link, built from the id the CLI registers.
- THE LEAD IS A NAME. Several live sessions share the repo root, and the most
  recent status change picked the lead's row. An optional root `office.json`
  names the lead session; without it the remote-controlled session leads and
  recency only breaks ties. The lead's chat reads that session's own
  transcript, and a `desk-<name>` sender is named by its desk even after its
  session ended.
- ⛔ A NAMED ROW IS THAT NAME OR NOTHING (review). Ranking by the expected
  name still gave the lead's row to a developer session at the root when the
  lead was not running, and the owner's message would have gone there. A
  named lead now matches exactly or reads "not running", and its chat is the
  newest transcript that records that name. A desk's folder never takes a
  session named for another desk.

## 0.7.32

- THE BOARD SHIPS ITS PAGE. board/ui/dist sat in board/ui/.gitignore, and an
  install from GitHub copies only what git tracks: the first 0.7.31 install
  had a board with no UI. The directory-sourced marketplace had hidden this
  by copying the maintainer's untracked build. dist is tracked now, rebuilt
  clean (1.6 MB, down from 16 MB of stale chunks), and a test pins it.
- A route that throws after its headers went out no longer kills the board.
  The catch-all called writeHead a second time, threw ERR_HTTP_HEADERS_SENT
  outside any handler and took the server down with every open page. It
  logs the real error now and ends the response.

## 0.7.31

- THE LEAD'S CHAT FOLLOWS THE LIVE TURN AGAIN. A transcript larger than the
  64 MB read window was parsed from its FIRST byte to the cap and then marked
  as read, so a 74.5 MB lead session showed a turn from hours earlier and
  never moved past it. The reader now takes the newest window, starting at a
  whole line.
- A live session beats a newer transcript. With two live CLI sessions at one
  repo root, newest-mtime flipped the lead's view between them; the session
  registry decides now, and the remote-controlled session leads.
- Tabs titled `desk-<name>` in lower case are recognised: such desks read as
  offline and could not be sent to. The lead's folder fallback never picks a
  tab that names itself a desk, and a desk restored at the repo root never
  takes the lead's live row.
- A subagent hand-back (`Another Claude session sent a message: <agent-message>`)
  renders as a system event, not as the owner typing.

## 0.7.30

- README gains an Updating section: this is a community marketplace, so
  installs do not auto-update. Users run /plugin marketplace update then
  /plugin update to pull a new version, and /reload-plugins to apply it in the
  session. Only official Anthropic marketplaces update in the background.

## 0.7.29

- A SCREENSHOT A TOOL RETURNED NO LONGER RENDERS AS THE OWNER'S MESSAGE.
  The harness records a tool-read image as a user-typed echo, so every
  picture the desk itself took sat right-aligned as if the human had sent
  it. Both shapes (the tool_result image and its marker echo) now render on
  the desk's side. Images the human actually attached still render as theirs.
- Cross-desk peer bubbles name the sender by DESK (team-lead, design), not
  by the harness's raw session handle.

## 0.7.28

- MODE AND CONTEXT LIVE AT THE PROMPT, like the CLI status line: the
  permission mode badge and the model · ctx % badge moved out of the header
  to the top right of the composer, and now show on the phone too. Asked
  for twice; the rig check now asserts the header does NOT carry them.
- A refused bare picker command (/model with no argument) hands the text
  back synchronously. The component resets the form before calling us, so
  a deferred restore raced any reader; the rig caught it one run in four.
- On the phone the update FAB sat on top of the send button; it now floats
  above the composer. The heartbeat rig check waits for the page's own
  fetch instead of probing once, which was red on every cold start.

## 0.7.27

- THE / FLOW BEHAVES LIKE THE CLI: ↑↓ move a highlight, Enter or Tab
  complete the highlighted entry and never submit a partial, Escape closes
  the menu and keeps the text. Tested key by key with real key events; seven
  new rig checks, 28 in all.
- Built-ins that open a PICKER in the terminal (/model, /effort, /config,
  /permissions, /resume, …) are handled honestly: the transcript never
  records a TUI menu, so a bare one sent from the board opened a menu
  nobody watched and parked the desk on "waiting". The board now shows the
  ARGUMENT list inline (/model → the model ids, /effort → the levels),
  completes it, and refuses to send the bare form, handing the text back
  with the inline example.
- README rewritten to what the board is now: live session state, the
  .claude rail, the heartbeat, the phone mount, the 21-then-28 check rig.

## 0.7.26

- THE RIG GREW FROM 9 TO 21 CHECKS, one per thing the owner caught by hand
  this week: the recorded mode and ctx % in the header, the heartbeat pill,
  every rail tab rendering, hooks in lifecycle order, copy path writing the
  clipboard (read back, not assumed), the lightbox, and the phone drawer
  opening and closing on a desk tap. A human found each once; a machine
  finds them now.
- copy path works on iOS: Safari copies only from an editable, explicitly
  ranged selection made inside the gesture; the path is also select-all
  for a long-press.
- What the CLI never renders, the board never renders: system-reminders
  and local-command caveats are context for the model, not for the human.
- The office board runs as a KEPT loop in the runbook (respawned on exit);
  a hand-started process typed from the wrong directory left the site dark
  for seven minutes. The wrapper forwards SIGTERM to its server so a stop
  never leaves an orphan on 7719.

## 0.7.25

- A hook row names its SCRIPT (guard-bash.sh, no-secrets.mjs), not a
  path fragment with a stray quote from splitting a shell command on /.

- Hooks list in LIFECYCLE order, SessionStart to SessionEnd; alphabetical
  had put Stop before UserPromptSubmit.
- The heartbeat is a pill: "12/12 loops up" with the pulse icon, the full
  line on hover, red and "attention" when not.

- A bare slash command typed at a prompt is recorded as plain text in some
  paths and rendered as the human chatting; it folds as a local command now,
  and a bare /compact joins the one compaction event.
- "queued" says WHY when the desk is waiting on a prompt in its own terminal
  (the CLI's live status), because a message stuck behind a permission
  prompt looks like a bug until the board explains it.

## 0.7.24

- THE CLI'S OWN LIVE STATE, adopted: ~/.claude/sessions/<pid>.json carries
  status busy|idle|waiting, cwd, version, name. Liveness is the pid, not the
  timestamp (updatedAt only moves on status changes). "waiting" is the CLI
  itself saying a human is needed — a permission prompt or a question — so
  the amber badge now lights from the source even though the prompt's
  content is not recorded anywhere on disk. The 45s mtime heuristic remains
  only for sessions older than the file.
- The Context element in the header: how full the window is (88% ctx),
  tokens and cost on hover. The 1M window is inferred from evidence (a
  prompt over 200k) because the record's model id drops the [1m] tag.
- Pending questions and plan approvals ride the Confirmation element;
  WebSearch/WebFetch results list their URLs on the Sources element.
- A failed tool count is a red badge, not a glyph. Subagents wear a nested
  arrow, not the AI sparkle, and their row says what task spawned them,
  read from the head of their transcript.
- The agents tab lists the office's root .claude/agents alone (owner's
  ruling); the toast belongs to the desk that earned it and clears on switch.
- A failed UI build no longer blanks the live board: Vite emptied dist
  before building, and one bad import served an empty page to every
  self-healing tab for a minute ("page crashed"). emptyOutDir is off;
  index.html is written last, so the previous build keeps serving.

## 0.7.23

- The rail is workspace · agents · skills · plugins · hooks. Agents and
  skills show ONLY what the desk's .claude loads (desk, office, user);
  installed plugins get their own tab from the cache Claude Code loads
  them from: name, version, description, and what each brings, counted
  (agents · skills · commands · hooks), never claimed.
- copy path works everywhere a page does: the Clipboard API only exists in
  a secure context and the old button swallowed its failure silently. A
  hidden-textarea fallback, and the button says copied ✓ or copy failed.
  Proven by a real click reading the path back off the clipboard.
- Markdown lists got their bullets back. Tailwind's preflight strips
  list-style, so "- item" rendered as a bare line with no marker to color.

## 0.7.22

The owner's second burst, every item a read of something Claude Code already writes.

- The EXACT permission mode in the header (⇧⇥ bypass / auto / plan …),
  from the permissionMode the CLI stamps on every entry it records. The
  button's note stopped saying "watch the terminal".
- The rail is workspace · agents · skills · hooks: the desk's .claude,
  displayed. Agents with model · effort and description from frontmatter
  (folded YAML scalars included); skills and commands from the desk, the
  office, the user and every plugin, click to type. Scratchpad and checks
  left the rail; the checks stay in `checks/run.mjs` and CI.
- An office heartbeat: the root desk.json may declare "heartbeat": a
  command; the board runs it every 20s and shows the last line at the
  sidebar's foot, green or red. Wiring it found the fault behind "I don't
  see things running": 8 of 12 keeper loops were DOWN. All up now.
- The update FAB, bottom-right, folded until wanted: update Claude Code,
  update the office plugin. Neither touches a running session, both say so.
- Subagent and job rows got air and honest icons (Sparkles, Users, Clock);
  the default robot is gone. Teammate sessions stop reading as a session
  slug like "…-v2-40" and say what the human first asked, or "another
  session at this desk".
- Tool folds wear a wrench, not the registry's search icon; the office
  wears Building2, not an emoji. "Open full size" opens a lightbox: a data:
  URL cannot open top-level, so the link did nothing. The outbox echo
  dissolves on a normalized prefix, since terminals re-wrap what they type.

## 0.7.21

- A new README hero: a product shot of the actual board (assets/board-hero.svg)
  with the colored blob avatars, a message from support in its own color
  routed to pricing and answered, the working line, and the mirrored browser.
  The old three-desk schematic retired to bk. The board section rewritten to
  say what the page actually is now, component by component.


## 0.7.20

- Every desk wears a shape, not a bar. A colored blob avatar with the
  desk's initial, both colour AND organic form hashed from the name, so a
  desk is known at a glance in the sidebar, the header, and any message
  from it. The green status dot is gone: status rides the NAME now, which
  grays out when the desk is offline and SHIMMERS (the registry Shimmer)
  while it is handling something. Two things to read, not three.

## 0.7.19

- Every desk has a COLOR, hashed from its name so it is the same across
  sessions, machines and reloads with nothing to configure. One hue,
  everywhere the desk appears: an identity bar by its sidebar dot (which
  keeps meaning live/busy — two signals, never conflated), a bar in the
  header, the border and label of a message FROM it, so "from
  manufacturing" wears manufacturing's color.
- A /compact turn is ONE "context compacted" event now, not the giant
  summary rendered as a chat bubble plus three empty "local command"
  folds. The owner watched exactly that pile up and called it confusing.
- The hire dialog's kind dropdown says the generic thing (customer-facing
  / internal), because the plugin is a general office and customer service
  is only how WE use it; the dialog is roomier so neither clips.

## 0.7.18

- "running for 4,000 minutes" is gone. The turn timer anchored on the last
  role:user message only, so once desk-to-desk peers and system events
  stopped counting as the turn's start, it measured from something days
  old. It now anchors on whatever last SPOKE TO the desk (human, peer, or
  system) and clamps anything over 4 hours to no-counter rather than a
  fantasy number. Verified end to end: a live send read 2s, not thousands.

## 0.7.17

- Desk-to-desk messages read as CONVERSATION: an attributed left bubble,
  "from manufacturing: ACK", sky-edged. The envelope and the harness's
  security boilerplate are display plumbing and stay out of the chat -
  same native record, seen from the owner's seat. Outgoing folds name
  their recipient: "SendMessage → manufacturing".

## 0.7.16

- The tab heals itself. no-store protects the NEXT load, not the one
  already running, so a tab left open across ships kept yesterday's UI
  while looking current (the owner caught it as "seems outdated"). The
  client now compares /api/version's build stamp to the one it booted
  with and reloads on change — unless the human is mid-sentence, in
  which case it says so and waits.

## 0.7.15

- API errors are the HARNESS speaking, not the desk: a synthetic turn or
  "API Error..." text renders as a red ⛔ event, never as the desk's words.
- Attachments got their chips back: a dropped or picked file landed in
  context with NOTHING on screen, so the composer looked like it swallowed
  the image. The chips ride the component's own attachments hook; drop and
  the photo button were working all along, invisibly.
- The ⇧⇥ mode key lives in the composer next to / commands, where input
  belongs, not in the header.

## 0.7.14

- SEND WAS 8-12 SECONDS and it was ours: orca types at human speed and the
  server waited for it SYNCHRONOUSLY, freezing every other request too.
  Dispatch is async with a 700ms early reply, the terminal roster is kept
  warm from the background, and the transcript (over SSE) is the delivery
  confirmation the outbox already visualizes. Measured: 1.2s, echo instant.
- A Skill's injected instruction body folds as "skill loaded · <name>"; it
  had rendered as the owner pasting a manual into chat.
- The mode key: ⇧⇥ in the header sends a real Shift-Tab into the desk's
  pty, which is how the CLI cycles permission modes. The record does not
  carry the resulting mode, so the button says to watch the terminal, not
  a made-up badge.
- The upgrade button: `claude update` from the sidebar, versions before
  and after, and the honest note that running sessions keep their version
  until restarted.
- The scrollbar belongs to the room: thin, muted, no bright track.

## 0.7.13

- A checks tab on the registry's TestResults element: the plugin's own
  structural checks run live against the office, pass/fail/unknown with
  the why on the row. Its FIRST render caught a real fault: the office's
  backup robot commits as "auto:" with no conventional type, failing the
  commit-convention check the office itself adopted.
- Background jobs carry their NAME: the tool result that spawned a job
  names the id, that call's own input carries the human description, and
  the two are joined. "b48q6efs9 · 4m ago" reads as what it is instead.

## 0.7.12

- A hooks tab in the rail: every hook that can actually fire on the desk,
  from the three places Claude Code reads them (project settings, user
  settings, each installed plugin), grouped by event with matcher and
  source. Gates stop being invisible.
- The workspace tree reaches depth 5 and 1500 entries; at depth 3 an
  expanded .claude/skills/<name>/ folder showed NOTHING. bk/ is the attic
  and left the tree.
- The outbox rides the registry's Queue element instead of hand-rolled
  bubbles.

## 0.7.11

- PUSH, NOT POLL. /api/events watches the transcript directory and ticks
  over SSE the moment Claude writes; the client refetches on the tick and
  keeps a slow 4s poll only as the net for a dropped stream. Receiving
  latency fell from a polling beat to roughly the debounce (~150ms).
- Sending got faster too: the orca terminal list that every send paid a
  few hundred ms for is cached 3s for the real runner only — a cached
  mock would poison the next test's world, so injected runners bypass it.
- Both command surfaces read like the CLI: two left-aligned columns, the
  name never hidden, the description truncating with a hover title. The
  outbox caption is one word.

Every entry below is a fault found by **using** this plugin, not by reading it. Four of the
first five needed a desk to exist and a second action taken against it.

## 0.7.10

The owner ran the office from a phone for an evening; this is that list.

- A sent message ECHOES instantly, marked "delivering…", or "queued — the
  desk is mid-turn, it reads this next" when busy; the echo dissolves the
  moment the transcript shows the real turn. Typing into a terminal takes
  seconds to surface, and a silent gap reads as a swallowed message.
- "working…" ends when the turn ends: a finished turn closes with plain
  assistant text, mid-turn entries end with a tool call. The shimmer had
  outlived every turn by the whole mtime window.
- The Computer is the WHOLE browser: a tab strip lists every open page,
  click picks which one the mirror shows. The "display only · ~1 fps"
  caption went away.
- Desk browsers start on an identity page (/hello?desk=) instead of
  about:blank, so a row of open Chromes says whose they are.
- The / suggest now carries the full surface: this repo, the user, EVERY
  installed plugin's commands and skills, and the CLI built-ins. 145 on
  this machine, was 10.
- Sidebar and rail collapse by drag. Hiring reads as a person joining a
  division. Background jobs show under their desk AND below the mirror,
  from tasks/*.output, amber while running. The tree's cap says plainly
  what it is. The duplicate media button is one per screen size,
  everywhere this time.
- The / list is vertical with each command's own description, Tab
  completes the top match, and the menu closes on send. The from-top
  scroll on switch is actually dead now: the first fix sat ABOVE the
  original resize="smooth" as a duplicate JSX prop, and the last one wins.
- working… reads like the CLI status line: elapsed and tokens for THIS
  turn, from a per-turn counter the tail reader keeps.
- A folder click toggles the folder; it had been opening the file dialog
  on the folder's path. Chat images click open full size in their own tab.
- Polls tightened (chat 1.2s, roster 5s) — the unchanged-payload
  short-circuit makes the extra beat nearly free.
- The rig learned about WINDOW focus: with another Chrome holding macOS
  focus, Base UI's focus trap never engages and Escape/outside dismissal
  silently die. Three checks went red the moment five desk browsers were
  relaunched. The rig now activates its tab and clicks once before
  measuring — the failure was real, the subject was the environment.

## 0.7.9

- Messaging the LEAD works. Its tab is titled with the task summary, never
  "team-lead", so the title matcher could not find it and send refused.
  Fallback: exact worktreePath equality from orca's own listing, newest
  output wins a tie - which also makes the v1 repo's terminal, at a
  different path, unreachable by construction. Proven by typing into the
  lead's own live terminal through the board.

## 0.7.8

- Tool calls show their RESULTS. Each tool_result attaches its output text
  and error flag to the call it answers, paired by tool_use_id through an
  index the incremental reader carries across chunks, so a result landing
  in a later read still finds its call. A failed call turns its row red
  and the fold says "⛔ n failed". The registry's ToolOutput and
  output-error state existed all along, unused.
- Edit and Write render as diffs: what left in red, what arrived in green,
  the file path on top. Raw JSON was the CLI's job to avoid, and now the
  board's too.
- The suite caught the tool-shape change and the stated-count ratchet
  caught its own README badge going stale, twice. Both synced by count,
  not by hand-waving.

## 0.7.7

- Markdown for the WHOLE tail. The last-15 cutoff predated the memoized
  blocks it was protecting against; every older turn read as raw
  asterisks. Each message parses once now, so the cutoff protected
  nothing.
- Screenshots a TOOL returned finally render. They live one level down,
  inside the tool_result block, and the extractor never walked that level;
  tool results stay plumbing except their pictures.
- Tool-call and system rows read left-aligned: a native button centers
  wrapped text, which put "2 tool calls" in the middle of the row.
- One attach affordance per screen: the photo button is the phone's, the
  action menu is the desktop's; both showed on mobile and shoved each
  other.
- The Computer pane says "currently off" when a desk has no browser, in
  those words. The mirror only polls while open, per viewer, so off costs
  nothing.
- local command events name their command in the fold and drop the ANSI
  color codes that rode /compact stdout onto the screen.

## 0.7.6

A phone-in-hand pass by the owner, every item found by using the board.

- A literal 0 haunted the chat: `text || images?.length` leaks the NUMBER
  zero into JSX for every empty-text turn. Boolean now.
- WORKING is a signal: a desk whose transcript grew in the last 45s pulses
  sky in the sidebar and shows a shimmer at the chat tail. The tab glyph
  looked like a spinner and is a permanent marker; mtime is the honest
  pulse.
- Typing / suggests commands INLINE above the composer, filtered as you
  type, like the CLI. The dropdown button remains for discovery.
- Switching desks: skeletons while loading (never the last desk's words,
  never a blank flash), the mirror clears to "connecting", and the chat
  lands at the BOTTOM instantly instead of animating down from the top.
- The phone drawer dismisses on choice (desk, file, hire): a drawer that
  stays over the thing you chose is a wall.
- One-tap photo button in the composer; the action menu was a second hop
  phones kept fumbling.
- copy path button on an open file, for mentioning it in chat.
- The hire dialog speaks plainly, and its kind dropdown no longer clips
  mid-word over its own trigger.
- iOS: 16px inputs (no focus zoom), safe-area bottom, viewport-fit=cover.
- The rig's image check is honest about data-dependence: none-in-view
  passes with a note; present-but-unloaded still fails.

## 0.7.5

- Markdown stopped whispering. Rendered markdown rode muted grays and got
  lost on the dark ground; body text is full foreground now, and structure
  (headings, links, inline code, list markers, quote bars) uses the same
  blue family as the workspace folder icons, so chat and rail read as one
  surface.

## 0.7.4

- The phone got the screen back. A hidden ResizablePanel still OWNS its
  percent of the row, so two invisible side panes were eating a third of a
  390px screen and the chat lived in the leftover middle. Below md the
  panels are now not rendered at all. Found by using the board on an
  actual phone, minutes after it went up behind auth.
- The drawer is the whole office now: desks on top, the same
  workspace/scratchpad rail below, one Tabs tree shared with the desktop
  panel rather than a second copy.
- Computer stacks vertically on a phone, same pair, still resizable; its
  header button is icon-only below sm.

## 0.7.3

- The board survives a subpath. Every API call and asset reference is now
  relative (`api/...`, vite `base: './'`), so a reverse proxy can mount the
  board at `https://host/office-board/` behind its own auth and strip the
  prefix. Nothing changes when served at `/`. First deployment: the board
  published behind an existing app's login via nginx `auth_request`.

## 0.7.2

- The sidebar shows each desk's EXACT folder name. It had been trimming
  `-customer-service` for width, which meant the name on the board was not
  the name on disk, in the roster, or in a hire refusal. Owner's ruling:
  the folder is the name.
- The hire dialog got its + button back. The dialog and `/api/hire` were
  live, but the trigger was dropped in a layout refactor, so the only way
  to hire from the UI was a dialog nothing could open. Now in the sidebar
  header and the mobile drawer.

## 0.7.1

- ONLINE means a live terminal, not "spoke recently": the whole office read
  as absent while sitting at its desks. Terminal truth from the orca CLI,
  cached 5s, honest null without it. Found immediately: the spinner glyph
  cycles while a desk works, and stripping one literal star called the
  BUSIEST desks offline and made send miss them — the normalizer now strips
  any leading glyph run, pinned for every spinner variant.
- Subagents and teammate SESSIONS are told apart in the sidebar: Bot for
  sdk-spawned sidechains, Users for full peer sessions, from the transcript
  head's own entrypoint.

## 0.7.0

Rollup of the 0.6.x local deliveries plus the blocked-on-you feature.

- ⛔ A DESK WAITING ON A HUMAN NOW SAYS SO. A pending AskUserQuestion or plan
  approval flips the desk to an amber "waiting" badge, and the question
  renders with its options as buttons — a click types the answer into the
  desk's real terminal. Found while building it: trimmed desk toolsets do not
  carry AskUserQuestion, so today this mostly serves the lead and full-toolset
  sessions; documented, not implied away. The release decision you are
  reading was answered through this exact feature.
- Live subagents under their desk in the sidebar (sidechain transcripts,
  labeled by task, pulsing while fresh).
- The usage menu: tokens AND dollars per line, cache read 0.1x and write
  1.25x input rate, as-of date on every figure, unknown model = tokens only.
  One owner for the arithmetic, tested to the cent.
- The Computer opens BESIDE the chat, resizable. System traffic renders as
  events, not as the owner speaking XML. Pasted-image markers become chips.
  The + button hires through hire() with the two-reader refusal on screen.
  Lucide icons, slim sidebar, mobile header fixed.

## 0.6.3

- Live SUBAGENTS in the sidebar: recently-active sidechain transcripts under
  their desk, labeled by their task, pulsing while fresh. The Grok Build idea,
  built as a read of what Claude Code already writes.
- A usage menu on the model badge: tokens and dollars per line (input, output,
  cache read at 0.1x, cache write at 1.25x), rates carrying their as-of date,
  and an unknown model gets tokens only, never a guessed dollar. One owner for
  the arithmetic, tested to the cent.
- Lucide icons replace the emoji; the sidebar slimmed to names and signals
  with the numbers on hover; the send/upload path proven end to end against a
  live desk, which replied.

## 0.6.2

- A ＋ button hires a desk from the board, through hire() and nothing else:
  the human picks the kind as reader one, the contract's own reading is
  reader two, and a disagreement comes back 409 with the refusal shown
  verbatim, because the refusals are the product.

## 0.6.1

- The Computer opens BESIDE the chat, resizable, never instead of it.
- System traffic (task notifications, hooks, cross-session envelopes, local
  commands) renders as muted collapsible events, not as the owner speaking
  XML. Pasted-image markers whose bytes never reached the transcript show as
  a clean chip instead of bracket prose. The mobile header truncates.

## 0.6.0

The board grew up. Everything below shipped as 0.5.x local deliveries and is
rolled into one public release, per the release policy.

- THE CHAT IS THE PRODUCT: real AI Elements end to end (Conversation,
  Message with markdown, Reasoning, Tool with parameters, FileTree, Image,
  PromptInput with attachments and shell-style history), resizable tone-
  separated panes, a session-folder rail, files opening in place.
- THE COMPUTER TAB MIRRORS a desk's headed browser, display only, through a
  zero-dependency CDP client with a unit-tested frame codec. Port 9222 is
  refused by name.
- THE SERVER READS INCREMENTALLY: 30ms warm where whole 62 MB transcripts
  were re-read synchronously per poll. Equal-to-full-parse is pinned by tests.
- THE LEAD HAS A HOME: leadDesk() reads a root desk.json (kind lead), so the
  desk that runs an office is finally visible to checks and mirrorable.
- THE RIG: board/ui/e2e.mjs walks nine functions with hit-tested input and
  thresholds. It found most of the bugs above, plus a Chrome quirk (input
  dies after CDP-driven reload) it now documents and sidesteps.
- UI unit tests via vitest (the folding logic), wired into CI.

## 0.5.13

- The board walked end to end by its own rig: nine functions, hit-tested
  input, thresholds, three clean runs. What the walk found and fixed: the
  server re-read whole transcripts on every poll (now incremental: 30ms warm,
  was seconds, unit-tested against the full parse) · WebPreviewBody is an
  iframe and had swallowed the mirror · the Computer tab now MIRRORS a desk's
  headed browser, display only · a file dialog that outlived its welcome ·
  the rail rebuilt whenever the chat moved. Plus a zero-dep CDP client with a
  tested frame codec, and markdown restored minus the heavy plugins.

## 0.5.12

- html/body/#root carry height 100%; the panes fill the viewport instead of
  ending at their content.

## 0.5.11

- react-resizable-panels v4 reads bare numbers as PIXELS: the desk rail was
  an 18px sliver. Sizes are percent strings now.

## 0.5.10

- The white page: PromptInputActionAddAttachments is a MENU ITEM and was
  placed outside its ActionMenu; Base UI threw invariant 36 and React
  unmounted everything. Found with the real browser over CDP, fixed to the
  element's own contract. Also: the Base UI render pattern where asChild was
  assumed, orientation instead of direction on the panel group, favicon
  served, and the headline token count no longer re-counts cache reads every
  turn (4295.9M was a lie; fresh input is the honest number).

## 0.5.9

- All nine of the owner's orders: /board removed (the chat is the only page,
  404 elsewhere) · panes told apart by tone, not gray lines · three resizable
  panes with min/max · the rail is a tabs menu (workspace / scratchpad) · runs
  of tool calls fold into one Task, expandable · the prompt is the full
  element (image attachments upload into the desk's scratchpad and the PATH
  is typed into the terminal, a /commands menu lists the desk's real slash
  commands) · a Computer tab shows the desk's HEADED browser through its own
  CDP DevTools page (9222, the live account browser, is refused by name) ·
  images in transcripts render, base64 and pasted-path both.

## 0.5.8

- The workspace tree walks breadth-first with a per-directory cap: one fat
  directory (bk/ holds every retired desk) was eating the whole entry budget
  and starving its siblings out of the tree.
- Conversation gap 8 -> 2; a transcript is a dialogue, not a gallery.

## 0.5.7

- Messages render markdown through the registry renderer, minus its two heavy
  plugins (code highlighting and mermaid): markdown yes, 400 grammars no.
- The rail shows the session's WORKING folder as a FileTree above the
  scratchpad: the desk's own tree, and the repo root for the lead, whose desk
  IS the root. Bounded in depth and entries on purpose.

## 0.5.6

- Every AI Element with corresponding data is on the page: thinking blocks
  render with Reasoning, tool calls with their parameters render with Tool,
  and the session folder is a real FileTree. index.html ships no-store so an
  open tab cannot keep yesterday's UI.

## 0.5.5

- The chat is the REAL components now: shadcn/ui plus AI Elements
  (Conversation, Message, PromptInput) from their registries, composed in one
  App.tsx that only wires our /api data. Built once by the maintainer, shipped
  as 440 KB of static files; users still build nothing. The registry's
  markdown pipeline (streamdown/shiki, 400 grammars, 14 MB) was trimmed out
  with the reason written in the component.

## 0.5.4

- The folder rail is tied to the SAME session as the conversation, by session
  id. Newest-tmp-dir repeated the robot bug on the tmp side: an SDK run's
  empty scratchpad out-mtimed the lead's working one.

## 0.5.3

- The chat answers at /, the table at /board; sidebar rows carry turns and
  tokens; the session picker prefers a human (cli) session over subagent and
  SDK transcripts sharing the project directory.
- A right rail shows the selected session’s folder — its native scratchpad —
  live, with sizes and ages.

## 0.5.1

- `/desk-board` is now one word to a working dashboard: it reuses a board
  that is already up, starts one detached if not, and opens the chat view in
  the browser itself instead of printing a URL to copy.

## 0.5.0

- **The chat view.** `/chat` on the board: every desk in a sidebar, the lead
  included, with its live transcript rendered as a conversation and refreshed
  as it moves. A send box types straight into the desk's real terminal through
  the orca CLI where that host has it; anywhere else the board says read-only
  in plain words instead of pretending.
- **The README speaks guidance now.** Install is two lines and a friendly
  note; the war stories moved to where they belong (CLAUDE.md, the changelog,
  the code). Owner's ruling: positive and guiding, warnings only where they
  change what you do.
- **CI caught a real flake on its first week.** The worktop fixture created
  two directories in the same millisecond and trusted mtime to order them:
  green locally by luck, red on ubuntu by the same luck. The fixture rigs its
  clocks now.
- 110 → 116 tests.

## 0.4.0

- **The board.** `/desk-board` serves the office on one read-only localhost
  page: every desk's kind, live status, model, turns, token usage, last
  activity and worktop (the session's native Claude Code scratchpad), plus the
  full checks board. Owner's ruling overturned "no UI, no server"; what
  survives is that doctrine's reason, now stated on the page itself: the board
  cannot know something `checks/run.mjs` does not. Loopback only, stateless,
  no dollars — a hand-synced price table would be wrong by the next model.
- **The command guard refused the new kind of command, and the guard was
  fixed, not dodged.** Its pattern hardcoded `hire()|fire()` as the only
  guarded entries — the third occurrence of "a hand-written list does not
  cover the member added after it". The registry of acceptable entries is now
  stated once: a guarded lib call, or a shipped entry script.
- **CONTRIBUTING gains the rule for where a test belongs**: delete the
  business nouns — if the rule still means something it is the plugin's, if
  not it stays home.
- 103 → 110 tests.

## 0.3.0

Found by the first production repo to adopt the contract: seven desks, 2,500 tests,
five live customer channels. Every item below is a fault that deployment surfaced.

- ⛔ **The CLI audited whatever directory you were standing in.** `collect(root)`
  always took a root; the CLI never passed one, so `node checks/run.mjs <repo>`
  printed a clean board about your cwd. A bad path now refuses with exit 7 instead
  of answering about the wrong repo.
- **New check, `desk-literals`.** The adopting repo measured 67 of 145 root test
  files naming a live desk as a code literal; every desk it retired turned some of
  those into rot. A ratchet: pinned counts must EQUAL measured counts, both
  directions, so the number only moves down and improvements must be banked.
- **New check, `commit-convention`.** Conventional Commits (`feat:`, `fix:`,
  `chore:`, ...) audited from the commit that adds `conventions.json`, forward.
  One grammar, used twice: the history check and a `.githooks/commit-msg` gate.
  This repo adopted it in the same commit, so the gate covers its author.
- **The meta files a stranger looks for:** CONTRIBUTING.md (the convention and the
  release drill), SECURITY.md (no network, no secrets read, findings name locations
  never values), and CI that runs the suite and the checks on every push, because a
  green badge that only ran on the maintainer's machine is a stated number nobody
  measured.
- 87 → 103 tests.

## 0.2.4

- **A check could exist and never run.** `checks/run.mjs` registers each check by hand, so a
  file landing in `checks/` without a line there was silently inert while its own tests kept
  passing. Registration is now pinned in both directions.
- Audited every hardcoded list in the codebase after three faults turned out to be the same
  shape: a hand-written list does not cover the member added after it.
- Retired the superseded `the-wall.svg` diagram.

## 0.2.3

- **`/desk-try` pointed at no function.** It said "hire a desk for it" in prose, so a model
  following it assembled a desk by hand and skipped the name rules, the port check, the
  one-lead rule and the second-reader agreement about who may talk to a customer.
- The guard meant to catch that named two commands explicitly and could not see the third.
  It walks `commands/` now.

## 0.2.2

- Firing your last desk left the board reading "nothing was examined" — an alarm at somebody
  who had just followed the tool's own instructions. The verdict is unchanged (an empty walk
  is still UNKNOWN); the message now says when `bk/` shows it was deliberate.

## 0.2.1

- **`stated-numbers` applied to every project that used the plugin.** `hire()` creates
  `tests/desks/`, so a user got a permanent amber row about a test count they had never
  stated and could not state. A check the reader cannot satisfy teaches them to ignore amber.

## 0.2.0

⛔ **If you installed 0.1.0, you had none of the fixes below.** The plugin cache is keyed by
version and `plugin.json` still said 0.1.0, so `claude plugin update` answered "already at
the latest version" and delivered nothing.

- **Two readers must agree on a desk's kind.** The model reads the description; a keyword
  reader forms its own view; `hire` refuses when they differ or the description is ambiguous.
  That call decides who may talk to a customer.
- **Firing the same name twice in a day could destroy the first archive.** It threw
  `ENOTEMPTY` here, which was luck: on a filesystem where rename onto an existing directory
  succeeds, the earlier archive would have gone silently.
- **One malformed `desk.json` blinded every check** — three UNKNOWNs while healthy desks went
  unexamined.
- **One fault produced six findings** across three checks. `desk-readable` owns that question
  now and the others stay quiet.
- `desk.json` and its folder must agree on the name.
- Desk names are capped at 40 characters. A 200-character one was accepted.
- Added `/desk-try`, `stray-writes`, `desk-readable`, `stated-numbers`.

## 0.1.0

First release. The desk contract with declared ports, the send wall checked in both
directions, `hire` and `fire`, and a `PreToolUse` gate that blocks rather than reports.

⚠️ **Hooks do not arm until Claude Code restarts.** Nothing in the install output says so,
and the obvious way to try a new plugin is to use it immediately.
