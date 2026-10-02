# 🏢 Office-Anything

<div align="center">

**Supercharge your Claude Code into a whole office.** Hire and fire AI agents — each
gets a desk, a browser, a live board, and limits that are enforced, not suggested.

<img alt="tests" src="https://img.shields.io/badge/tests-175%20passing-3fb950">
<img alt="ci" src="https://github.com/hoangnv1301/Office-Anything/actions/workflows/test.yml/badge.svg">
<img alt="dependencies" src="https://img.shields.io/badge/dependencies-0-3fb950">
<img alt="license" src="https://img.shields.io/badge/license-MIT-blue">
<img alt="claude code" src="https://img.shields.io/badge/Claude%20Code-plugin-8957e5">

[Install](#install) · [Hire](#hire-someone) · [Try](#try-something-without-letting-it-in) ·
[Fire](#fire-someone) · [The wall](#the-wall) · [The checks](#the-checks) · [The board](#the-board) ·
[Design](#design-philosophy) · [Roadmap](#roadmap)

<img src="assets/board-hero.svg" width="100%"
     alt="The office board: a sidebar of desks each with its own colored shape, the lead's live chat in the middle with a message routed to pricing and its reply, and the desk's own browser mirrored on the right. Built entirely on what Claude Code already writes.">

<sub>Every desk is a real Claude Code session. The board only reads what Claude Code already writes — transcripts, scratchpads, the desk's browser — and makes it one screen you can watch and message from, on your phone too.</sub>

<br><br>
<b><a href="https://hoangnv1301.github.io/Office-Anything/">See it work &rarr;</a></b><br>
<sub>Pick a desk, try to give it a job that isn't its own, and watch it refuse.</sub>

</div>

## Why Office-Anything?

If you run more than one AI agent, you have met these:

- 💸 **One agent does everything** — so the same context that holds your margins is the one
  chatting with a customer, and nothing but its mood keeps the two apart.
- 🔥 **Removing an agent breaks three others** — a name in a config here, a hardcoded port
  there, and the first evidence is a customer nobody answered.
- 🧪 **"Let me just try this library"** — and a week later its files are in your dotfiles,
  your PATH, and two configs you did not know you had.
- 📗 **The docs describe the setup you wished you had** — while what actually runs drifted
  months ago, and no command exists that would tell you.
- 🤝 **A new agent gets pasted rules** — "never quote prices" — that last exactly until the
  conversation gets interesting.

Office-Anything's answer is a **desk**: one folder, one `desk.json` contract, one browser
profile, one agent — with the dangerous capability *absent*, not switched off, and a set of
checks that audit the whole office with one exit code.

## Install

```bash
/plugin install office-anything@office-anything
```

Restart Claude Code once so the hooks arm, and you are set. (In
non-interactive `claude -p` runs, slash commands may not resolve — ask for
the skill by name instead: "use your office-anything desk-hire skill".) The plugin stays
quiet until your repo has a `desks/` directory — hire your first desk and
everything switches on together.

## Updating

This is a community marketplace, so updates are not automatic. To pull a new
version:

```bash
/plugin marketplace update office-anything
/plugin update office-anything@office-anything
```

Then `/reload-plugins` (or restart Claude Code) to run the new version in the
current session. Only official Anthropic marketplaces auto-update in the
background; everything else, including this one, updates on demand.

## Hire someone

```
/desk-hire "someone who answers our Instagram DMs"
```

```
  reads it   →  kind: channel
  issues     →  a folder, its own Chrome, a reader, a voice standard
  withholds  →  a sender. It starts dark.

  ⛔ chat: facts.md is still the stub. This desk knows nothing.
```

A new desk starts as a clean slate and tells you exactly what to teach it
first — write its `facts.md` and it is ready to work. You always know what a
desk knows, because you gave it every fact it has.

<details>
<summary><b>Why hiring needs two readers to agree</b></summary>

The model decides the desk's kind, because reading intent from a sentence is a model's job.
A second, independent reading then forms its own view, and `hire` **refuses** if they
differ or the description is ambiguous. `"quotes prices to customers"` mentions both
customers and internal figures, so it stops and asks rather than picking one. That call
decides who may talk to a customer, which makes it the one place a second opinion earns
its cost.

</details>

## Try something without letting it in

You have a list of repos you want to try and no appetite for what they do to your setup.

```
/desk-try "that scraping library everyone keeps posting about"
```

It hires a desk for the trial, installs everything **inside that desk**, and writes down
what it brought. You talk to the desk about it, not to your main session. When you are
done, `/desk-fire` it — and a check confirms it left nothing behind:

```
⛔ 1 file(s) a desk brought in are living outside it
   some-scraper installed "cool-lib", which is at config/cool-lib.rc

   Firing that desk will not remove these.
```

> 💡 A desk isolates a folder, a browser profile and an agent's context, and makes
> removal verifiable. For genuinely untrusted code, pair it with a container.

## Fire someone

```
/desk-fire chat --reason "the channel is being retired this quarter"
```

Clean offboarding, built in: it checks nothing still depends on the desk,
archives rather than deletes, and walks you through the handover — close its
session, rehome its knowledge, reassign its open work. The reason you give is
recorded, so six months later you still know why.

## The wall

Some agents should never be able to talk to a customer, no matter how the conversation
goes. A **knowledge** desk holds prices, margins and contracts. A **channel** desk talks
to people. The wall between them is that a knowledge desk has **no way to send** — the
capability is absent, not switched off.

| gets | channel | knowledge | lead |
|---|---|---|---|
| its own browser, started when it first browses | ✅ | — | ✅ |
| a reader for its channel | ✅ | — | — |
| a voice standard it has to pass | ✅ | — | — |
| **a way to send** | only once you make it live | **never** | never |
| the codebase-graph tool | — | — | ✅ |

The wall is enforced by a hook, so it blocks the write instead of reporting it afterwards:

```
⛔ BLOCKED. pricing is a KNOWLEDGE desk and you are giving it a way to send.

If this desk genuinely needs to talk to people, it is the wrong kind. Change its
kind in desks/pricing/desk.json deliberately, where somebody reviews it.
```

It is checked both ways: a live channel desk with **no** way to send fails just as loudly,
because that means someone is being ignored.

## The checks

One command audits any repo that carries desks, from anywhere:

```bash
node checks/run.mjs ~/code/some-repo    # every check, one exit code
```

| check | answers |
|---|---|
| `desk-readable` | can every desk be read, and does any port get claimed twice |
| `send-wall` | can a desk that should not reach a customer, reach one |
| `unfinished` | is a desk still wearing the stubs it was hired with |
| `stray-writes` | did a desk leave anything outside its own folder |
| `stated-numbers` | does every number this project states about itself match reality |
| `desk-literals` | can a desk be added or removed without editing a root test |
| `commit-convention` | does every commit since adoption say what kind of change it is |
| `browser-on-demand` | does anything open a browser just because a session started |

Exit 0 clean, 4 finding, 7 UNKNOWN — and **an empty walk is UNKNOWN, never clean**.

The last two are opt-in ratchets, one committed file each, and they start at the adopting
commit: history before it is somebody else's style and is left alone. Pin your counts in
`tests/desk-literals.json`; adopt typed commits (`feat:`, `fix:`, `chore:`, …) by
committing `conventions.json` with `{"commits": "conventional"}`.

## The board

```
/desk-board
```

The office on one page (the shot up top is it), served read-only on
localhost. The front page IS the conversation view, built on real
[shadcn/ui](https://ui.shadcn.com) + [AI Elements](https://elements.ai-sdk.dev)
components, nothing hand-rolled:

- **Every desk in a sidebar**, each with its own colored shape, its name
  grayed when offline and shimmering while it works. Busy, idle and *waiting
  on a human* come from Claude Code's own live session state, never from
  self-report; an amber badge lights the moment a desk needs you.
- **Its live transcript as chat**: markdown, tool calls with their diffs and
  results, images, a message *from* another desk in that desk's own color,
  the working line showing elapsed and tokens like the CLI status bar, and
  the exact permission mode and context-window fill from the record.
  What the CLI never renders, the board never renders.
- **A composer that reaches the desk the way SendMessage does** — the
  session's own messaging inbox first (it never claims a permission mode it
  does not have), keystrokes into the desk's terminal as the fallback, and a
  question's option answered with the one keystroke the CLI's dialog takes.
  Plus `/` commands with descriptions and Tab-complete, image drop with visible chips,
  Shift-Tab for mode, an instant echo while the terminal catches up. Sends
  land in about a second; replies arrive by push the moment Claude writes.
- **The Computer pane mirrors the desk's whole browser**, every tab, display
  only, through a zero-dependency CDP client. A rail reads the desk's
  `.claude`: its workspace tree, its agents, its skills and commands, the
  plugins installed, and every hook that can fire, in lifecycle order.
- **Every live state the CLI writes** — working, running a command, waiting
  (and on what), idle — straight from Claude Code's session registry, plus
  the desk's **Remote Control link** when it has one, so a desk opens in the
  Claude app in one tap. Messages that reach a desk mid-turn (yours, and other
  desks') show up where they landed, not only the ones typed at an idle prompt.
- **Name your lead**: several sessions can share the repo root. An optional
  `office.json` at the root says which one is the lead —
  `{"lead": {"session": "<session name>"}}` — and the board follows that name
  instead of whichever session changed status last.
- **The office's own pulse**: a root `desk.json` may declare a `heartbeat`
  command; the board runs it and shows the answer (`13/13 loops up`), red
  when it is not. Wiring it found eight dead keeper loops nobody had noticed.

**Browsers start on demand.** Opening the board opens nothing: `/desk-board`
hands you the link, and a desk's Chrome starts when one of its tools needs
it, never because the session started. `browser-on-demand` holds that for
every start-up hook in the office; a launchd job or keeper loop outside the
repo is the other place to look if windows still appear on their own.

Loopback only, stateless, re-gathered per request. Mount it behind an
existing app's login (nginx `auth_request`, one location block) and it is
the same office from a phone. It cannot know something `node checks/run.mjs`
does not, which is the rule that let it exist at all.

Every fault the board ever showed a human is now a rig check: `board/ui/e2e.mjs`
walks 21 functions against the live page with hit-tested input — real clicks,
real clipboard reads, a real phone viewport — and names the one that broke.

## Design philosophy

**A check reports after the fact, if somebody runs it. A hook blocks the action.** They
are different jobs and this repo refuses to merge them: the check exists so you can audit
a repo you did not write, the hook exists because the audit is too late.

| rule | why it is a rule |
|---|---|
| a check that only reports is not a gate | if it matters, it exits non-zero |
| an empty walk is UNKNOWN, never clean | a checker that examined nothing has not passed |
| every override costs a recorded reason | `--reason` under 20 characters is refused |
| ports are declared, never derived | deriving them renumbered every desk after an insert — four incidents |
| one question, one owner | two copies of a fact means one is stale and you cannot tell which |
| a test that has never failed has never been checked | break the guarantee, watch red, restore |

Every fault in the [CHANGELOG](CHANGELOG.md) was found by **using** the plugin — hiring,
firing, deliberately breaking desks — not by reading it. Four of the first five needed a
desk to exist and a second action taken against it.

## Security

No network. No telemetry. Checks read the audited repo and write nothing. Credentials are
never read, and a finding about a leak names the location, never the value. The full
statement, including what `hire`/`fire` may write and where: [SECURITY.md](SECURITY.md).

## In production

The contract runs a real customer-service office: seven desks across five channels
(web chat, email, three marketplaces) in front of a 2,500-test suite, with the board
served as a kept loop and reached from a phone behind the company app's own login.
Every release since the first exists because that deployment found faults that reading
never would; the [changelog](CHANGELOG.md) is that list, one entry per fault.

## Roadmap

- **`state-shape`** — state files sorted by lifetime (the FHS names: `run/ lib/ log/
  cache/ spool/`), so "can I delete this" has an answer by construction.
- **A task panel** — each desk's own TaskList, the CLI's todo list, on the board.
- **Session picker** — a desk's older sessions, not only its newest.
- **Restart on latest, resumed** — one button that updates Claude Code and reopens every
  desk exactly where it was, with `--resume`.
- **Other harnesses** — the contract is one JSON file per desk on purpose. Nothing in
  `desk.json` is Claude-specific; adapters for other agent CLIs are a matter of hooks,
  not of contract.

## Contributing

Typed commits, one grammar enforced in two places, and every claim the README makes is
pinned by a test — including this one. Start at [CONTRIBUTING.md](CONTRIBUTING.md).

## Acknowledgments

- Repo structure and release style informed by
  [Agent-Reach](https://github.com/Panniantong/Agent-Reach).
- Built on what [Claude Code](https://claude.com/claude-code) already provides — hooks,
  slash commands, plugins, subagents. Nothing here reimplements any of it.

## Star history

<a href="https://star-history.com/#hoangnv1301/Office-Anything&Date">
  <img src="https://api.star-history.com/svg?repos=hoangnv1301/Office-Anything&type=Date" alt="Star history" width="600">
</a>

---

<div align="center">
<sub>MIT · <a href="CHANGELOG.md">changelog</a> · <a href="CONTRIBUTING.md">contributing</a> ·
<a href="SECURITY.md">security</a> · <a href="https://hoangnv1301.github.io/Office-Anything/">live demo</a></sub>
</div>
