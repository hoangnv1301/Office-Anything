# Changelog

Every entry below is a fault found by **using** this plugin, not by reading it. Four of the
first five needed a desk to exist and a second action taken against it.

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
