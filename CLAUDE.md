# Office-Anything — working on this repo

A Claude Code plugin. You hire a desk, you fire a desk, and every role has a boundary that
exits non-zero.

```bash
node --test "tests/**/*.test.mjs"    # 72 tests
node checks/run.mjs                  # every check, one exit code
```

⛔ **Quote a pass/fail count only from the glob form.** `node --test tests/` tries to LOAD
the directory and reports one failing test with a buried MODULE_NOT_FOUND.

## Layout, and why each thing is where it is

| path | what it is |
|---|---|
| `lib/` | the contract. `desk.mjs` is the only place a desk's kind, port and live status are read |
| `checks/` | **reads only.** Safe to run when unsure, which is when you want to look |
| `hooks/` | **blocks.** A PreToolUse gate that refuses the tool call outright |
| `commands/` | flat `.md` files. **The filename IS the slash command** |
| `tests/` | one file per thing it tests |

⛔ **`checks/` and `hooks/` are not the same job and must not be merged.** A check reports
after the fact, if somebody runs it. A hook stops the action. The check exists so you can
audit a repo you did not write; the hook exists because the audit is too late.

## The desk contract

```json
{ "name": "billing", "kind": "knowledge", "port": 9231, "live": false }
```

One file per desk. The roster, the port map, the docs table and the tests all read it.

⛔ **Ports are declared, never derived from position in a list.** Deriving them means adding
a desk called `billing` silently moves every desk alphabetically after it to a different
port, and firing one does the same in reverse.

⛔ **Hiring needs TWO readers to agree.** The model decides the kind, because reading intent
from a sentence is a model's job and a keyword list cannot do it. `agreeOnKind` then forms
its own view from the words, and `hire` REFUSES if they differ or if the description is
ambiguous. That call decides who may talk to a customer, which makes it the one place a
second opinion earns its cost.

## The rules that keep this honest

- **A check that reports is not a gate.** If it matters, it exits non-zero.
- **An empty walk is UNKNOWN (7), never clean.** A checker that examined nothing has not passed.
- **`applies()` is a fourth state, not a pass.** No `desks/` directory means "not applicable".
  Reporting that as green is how a board of green rows comes to mean nothing.
- **A test that has never failed has never been checked.** Break the guarantee, watch it go
  red, restore it.
- **An override must cost something.** `fire` needs a 20+ character reason and records it.

## ⛔ The three mistakes this repo has already made

Read these before adding anything. Every one shipped, and every one is now pinned by a test.

1. **`import.meta.url === \`file://${process.argv[1]}\`` is WRONG.** A URL percent-encodes a
   space; a raw path does not. On a disk called `Extreme SSD` they never match, so the CLI
   block never runs and the script **exits 0 having printed nothing**. Use `lib/is-main.mjs`.
2. **The README advertised `/desk hire` with a space.** Commands are flat markdown, so the
   filename is the command: it is `/desk-hire`. A doc claiming a capability the layout does
   not provide is the exact failure this project sells a fix for.
3. **The README's own table promised skills, agents and hooks while none of those
   directories existed.** It described a plugin that did not work as one.

⚠️ **All three were DOCS, not code, and the suite was green through all of them.** A suite
that only tests exports cannot see a README promising the wrong command. When you add a
claim to the README, add the test that pins it.

## ⛔ Verified by installing it, not by reading it

`claude plugin validate .` passes, and `claude plugin install` reports:

```
Skills (2)  desk-fire, desk-hire
Hooks (1)   PreToolUse  (harness-only — no model context cost)
Always-on:  ~67 tok
```

⚠️ **Claude Code counts `commands/*.md` as SKILLS.** The docs call `commands/` "skills as
flat markdown files", so a plugin with no `skills/` directory still reports two skills. Do
not "fix" this by adding a `skills/` directory.

⛔ **HOOKS DO NOT ARM UNTIL THE SESSION RESTARTS**, and this was found by installing the
plugin and then trying to violate the wall. The write went through. The hook was registered
correctly on disk and blocked with exit 2 when run by hand, but the running session had been
started before the plugin existed, so it had no hook to run.

Nothing in the install output says this. A user who installs and immediately tests concludes
the wall does not work. The README now says it at the install step.

⭐ **The failure also demonstrated why both layers exist.** The hook missed it because it was
not loaded; `checks/run.mjs` caught it immediately: "pricing is a knowledge desk and has a
sender". A gate you have not restarted into is exactly the case a check is for.

## ⛔ Five faults found by USING it, not reading it

Ten rounds of hiring, firing and deliberately breaking desks. Every one of these shipped
and every one is now pinned by a test in `tests/robustness.test.mjs`.

1. **A 200-character desk name was accepted.** A name goes into a directory path, a port
   map, a docs table and a test name. 40 is the limit now.
2. **Firing the same name twice in one day threw a raw ENOTEMPTY** — and that was the GOOD
   outcome. On a filesystem where rename onto an existing directory succeeds, the first
   archive would have been destroyed silently. An archive is the only copy of a desk that
   ever existed, so `fire` now suffixes rather than overwriting.
3. **`desk.json` and its folder could disagree about the name.** Two statements of one fact,
   and downstream readers picked different ones: the port map keyed by the file, the paths
   keyed by the folder.
4. **One malformed desk.json blinded every check.** All three returned UNKNOWN and six
   healthy desks went unexamined because of a typo in a seventh. `rosterSafe` reports the
   broken ones and keeps going.
5. ⛔ **One fault produced six findings, and one CONDITION produced four UNKNOWNs.** Every check needs the roster, so every check hit
   the same bad file and said so. `desk-readable` owns that question now and the others skip
   in silence. A board becomes noise not by being wrong but by saying one thing three times.

   ⚠️ **"An empty walk is UNKNOWN, never clean" still holds — it is just said ONCE.** An
   empty `desks/` used to produce four UNKNOWN rows. Now `desk-readable` reports it and the
   other three answer "not applicable", which is a genuinely different statement: *nothing
   here to judge*, versus *I looked and could not tell*.

⚠️ **None of these were visible in the code.** Four of the five needed a desk to exist and a
second action to be taken against it. Read the module and every one looks fine.

## ⛔ The pattern behind most of the faults above

Four of the seven were the same shape: **one question with more than one owner.**

| question | owners before | owner now |
|---|---|---|
| can this desk be read | 3 checks, 6 findings for 2 faults | `desk-readable` |
| is `desks/` empty | 4 checks, 4 UNKNOWNs | `desk-readable` |
| how many tests are there | 4 hand-written copies, 1 covered | `stated-numbers` |
| what kind is this desk | the model AND a keyword list, silently | both, and they must agree |

⚠️ **A number describing the code, stored where the code cannot reach it, drifts the moment
anybody works.** You do not fix that by being careful. You fix it by checking it, or by
keeping one copy. The test count sat in four places and exactly one was watched, so adding a
single test made three of them quietly wrong, and the wrong ones were the two a stranger
sees first.

## Adding things

**A check** — export `applies(root)` and `report(root)`, return `{code, applicable, why}`,
add one line to `CHECKS` in `checks/run.mjs`, write a test that fails when the guarantee is
broken. ⛔ The one-line registration is the point: in the system this came from, a full-tree
credential scan sat unwired for weeks while two tests kept proving it worked.

**A gate** — a script in `hooks/`, registered in `hooks/hooks.json`. Exit 2 blocks and
returns stderr to the model. ⛔ **Exit 0 on any unexpected input.** A hook that crashes must
not block every write in the repo; it guards one narrow thing.

**A command** — a flat `.md` in `commands/`. Then add it to the README, because a test
requires every command file to be documented and every documented command to exist.

## What is deliberately NOT here

- **No `skills/`.** Nothing yet needs a multi-file skill; two commands carry the workflow.
  Do not add an empty directory to look more like a plugin.
- **No `agents/`.** Desks ARE the agents, and `hire` writes them into the USER's project.
  The plugin produces agents; it does not ship any.
- **No UI, no server, no database.** If you are reaching for one, ask what it would tell
  somebody that `node checks/run.mjs` does not.

## Publishing

`.claude-plugin/plugin.json` needs only `name`. `.claude-plugin/marketplace.json` needs
`name`, `owner.name`, and `plugins[]` with `name`/`source`/`description`. Both are pinned by
`tests/description.test.mjs`, including that the two descriptions match word for word: the
description lives in three places, and the two nobody edits are the two a stranger reads first.
