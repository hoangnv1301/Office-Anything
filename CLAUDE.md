# Office-Anything — working on this repo

A Claude Code plugin. You hire a desk, you fire a desk, and every role has a boundary that
exits non-zero.

```bash
node --test "tests/**/*.test.mjs"    # the suite
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
