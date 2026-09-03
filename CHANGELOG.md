# Changelog

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
