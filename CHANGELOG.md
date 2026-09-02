# Changelog

Every entry below is a fault found by **using** this plugin, not by reading it. Four of the
first five needed a desk to exist and a second action taken against it.

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
