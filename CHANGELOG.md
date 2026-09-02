# Changelog

Every entry below is a fault found by **using** this plugin, not by reading it. Four of the
first five needed a desk to exist and a second action taken against it.

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
