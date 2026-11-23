# Minimal board: every feature of today's board, and where it lives in the new layout

Mock: `board/ui/mock/minimal-board.html` (static, fake data, system fonts, light + dark; `#dark`, `#light`, `#…drawer`, `#…office`, `#…tasks`, `#…between`, `#…computer` open a state for screenshots).
Source of today's features: `board/ui/src/App.tsx` (1,345 lines) and the routes in `board/serve.mjs`.

**Layout:**
- Left: a narrow **sidebar** (desks, the office's own views, a one-line health footer).
- Centre: **one conversation** column (max 680 px) with one message box.
- Right: a **details drawer** that is closed by default and opens on click.
- The desk's **Computer** opens beside the conversation, as today (owner's ruling: side by side, never instead).
- Phone: the sidebar and the drawer become slide-overs, and the Computer stacks under the conversation.

Calm comes from progressive disclosure: anything that is not "who is working / what needs me" is one click away. Nothing is removed.

## Sidebar

| Today | Where it is now | Notes |
|---|---|---|
| "the office" header + **Hire a desk** (+) | Sidebar header, the ＋ button | Same dialog (name, description, kind), refusal shown verbatim |
| Desk list: blob avatar (hue + shape from the name) | Each sidebar row: the blob, larger (34 px) | The memorable element; the hue is still hashed from the name |
| Online / offline (name greyed) | A small dot on the avatar (green / grey) plus a greyed name | |
| Busy (shimmering name) | A spinner on the row's right | |
| LIVE badge | Kept as a small badge on the row | |
| Waiting badge + amber status line | The amber status line ("Waiting on you · plan approval") plus a count on the right | |
| Status line (`deskStatusLine`: waiting / running a command / working / idle / offline) | The row's second line, always shown, as in MausBot ("Writing a reply", the last task) | Today it shows only for some states; now always, as the screenshot does |
| Subagents and teammate sessions (◇ n, nested rows) | A collapsible "2 teammates working" under the desk (open by default when any is active) | |
| Background jobs (clock rows) | A "◷ n" mark on the row; the list is in the Computer side panel and in "Teammates working" | |
| **between desks** (open-asks badge) | Sidebar "Between desks" with an "n open" count | Same view: the open-asks filter, desk links |
| **tasks** | Sidebar "Tasks" with an open count | Same view: totals, per assignee, overdue / quiet, notes, evidence on click, closed recently, owner words |
| Project **panels** (office.json) | Sidebar items under Tasks, one per panel | Same refresh (30 s) |
| Heartbeat footer ("9/9 loops up", red on trouble) | The sidebar footer: "9/9 loops · 41/42 checks", plus **Office** opens the drawer on Loops / Checks / Updates | Checks (`/api/checks`) were fetched-state the old UI never rendered; they get a home here |
| Phone drawer (desks + rail) | The sidebar becomes a slide-over (☰); the details drawer is its own slide-over | Choosing anything closes it, as today |

## Centre: the conversation

| Today | Where it is now | Notes |
|---|---|---|
| Header: avatar, desk name, live status | Header, unchanged in meaning, calmer type | |
| **Claude app** link (Remote Control URL) | Header action "↗ Claude app" | |
| **Computer** toggle | Header action "▭ Computer" → side-by-side mirror | Tabs strip, URL, mirrored pixels, background jobs list: all unchanged |
| (rail tabs on the right) | Header action "⋯ Details" opens the drawer | See the Drawer section |
| User / assistant messages (markdown) | Plain bubbles; yours right-aligned and tinted | Markdown kept (MessageResponse) |
| Reasoning (collapsible) | A chip "Thought for 12 s ›" that expands | |
| Tool-call runs folded into one Task, failures badged | A chip "4 tool calls — Read, Edit, Bash, SendMessage → design ›"; expands to each tool with its state, Edit/Write diffs red/green, WebSearch sources | A failed run shows a red chip |
| System events (⚑ / ⛔ error) | Small chips; an error chip is red | |
| Peer messages (from another desk) | A hand-off chip "design replied ›" with a one-line preview under it; expands to the full text | MausBot's pattern |
| SendMessage to a desk (inside the tools) | Also surfaced as a chip "Sent to design ›" with "Done when: …" under it (when the message says so) | The tool list still has it |
| Images in messages (lightbox) | Unchanged: thumbnails in the bubble, click opens full size | |
| — | **NEW** divider at the first message since you last looked | New, from MausBot (kept per desk in localStorage) |
| Pending question / plan approval (Confirmation, options answer the desk's own dialog) | The amber "waiting on your answer" card above the box, options as pills | Multi-select / plan: the same "answer it in the Claude app / terminal" fallback |
| Outbox (what you sent, until the transcript shows it: "in its inbox" / "queued" / "delivering…") | A faded right-aligned bubble with the delivery state beside it | |
| Working indicator (✳ working… elapsed · ↓ tokens) | "Teammates working ⌄" with the crew's avatars, elapsed time and tokens; expands to each subagent / teammate / background job | MausBot's pattern, merged with today's subagent and job rows |
| Empty state / skeletons / "board updated, refresh" note | Kept | |
| Scroll-to-bottom button | Kept | |

## The message box

| Today | Where it is now |
|---|---|
| Text box with the route hint ("straight to its session inbox" / "typed into its terminal" / read-only) | Same placeholder, one rounded box |
| Attach (menu on desktop, photo button on phone), attachment chips | The ＋ on the box's left; chips above the text |
| Inline `/` suggestions, Tab / Enter completion, picker-argument completion (`/model`, `/effort`), bare-picker refusal | Unchanged, shown as a small menu above the box |
| "/ commands" dropdown | The "/ commands" link under the box |
| ⇧⇥ (permission mode cycle in the terminal) | Under the box, with the current mode beside it ("⇧⇥ mode · bypass") |
| Mode badge | Same line as ⇧⇥ |
| Model + context % + cost hover (Context card, rates as-of date) | Under the box on the right: "opus · 34% context · $12.40 this session"; click opens Details → Usage with every token row, the cost and the as-of date |
| ArrowUp history per desk | Unchanged |
| Send | The round button on the box's right |

## Details drawer (one drawer, two modes)

| Today | Where it is now |
|---|---|
| Rail tab **workspace** (file tree, first 500, file preview dialog with copy path, images, markdown, text, binary / big) | Drawer → Workspace; the preview dialog unchanged |
| Rail tab **agents** (by source, model, effort) | Drawer → Agents |
| Rail tab **skills** (by source, click types it) | Drawer → Skills |
| Rail tab **plugins** (version, counts, marketplace) | Drawer → Plugins |
| Rail tab **hooks** (in lifecycle order, script name, matcher, source) | Drawer → Hooks |
| Usage / cost breakdown (hover card) | Drawer → Usage (also reached from the context line under the box) |
| Heartbeat detail lines | Drawer (office mode) → Loops |
| `/api/checks` rows (name, code, why, applicable) | Drawer (office mode) → Checks: pass / fail / not applicable |
| Updates FAB (update Claude Code, update the plugin, with confirm) | Drawer (office mode) → Updates; the floating button goes away |

## Unchanged behind the layout

- Every `/api/*` route and its polling or SSE cadence.
- The send path (inbox, terminal, read-only reason), the answer path (by option number, refused if the question changed), upload to the desk's scratchpad, hire.
- Self-healing reload when the build changes, and the per-desk reset on switch (no last-desk pixels).
- Port 9222 refused by name; dollars always with their as-of date; system traffic as events, never as the owner speaking.

## Deliberately new (small)

- The NEW divider.
- Hand-off chips with "Done when".
- The status line always shown.
- Checks given a visible place.
- Updates moved from a floating button into the drawer.
