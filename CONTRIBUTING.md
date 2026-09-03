# Contributing

## Commits are typed

Subjects follow Conventional Commits, the basic set:

```
feat: a desk-literal ratchet, so removing a desk stops breaking tests
fix: the CLI audited the cwd no matter what repo you pointed it at
chore: the stated test count moved with the new regression tests
```

| type | when |
|---|---|
| `feat` | a new check, gate, command or capability |
| `fix` | behavior was wrong and now is not |
| `chore` | counts, versions, formatting, plumbing |
| `docs` | README, CLAUDE.md, this file |
| `test` | tests alone |
| `refactor` / `perf` / `build` / `ci` / `style` / `revert` | their usual meanings |

- Scope is optional: `feat(checks): ...`. A `!` marks a breaking change.
- **The subject carries the type. The body carries the WHY, in full sentences.**
  This repo's history is written as lessons; the prefix does not change that.
- Enforced twice, one grammar: `.githooks/commit-msg` at commit time, and
  `checks/commit-convention.mjs` over history since `conventions.json` was
  committed. Run `git config core.hooksPath .githooks` once after cloning.

## Adding things

- **A check**: export `applies(root)` and `report(root)` returning
  `{code, applicable, why, findings?}`. Register it in `CHECKS` in
  `checks/run.mjs` (the one-line registration is the point), and write the
  test that fails when the guarantee breaks. Exit 0 clean, 4 finding,
  7 UNKNOWN. An empty walk is UNKNOWN, never clean.
- **A gate**: a script in `hooks/`, registered in `hooks/hooks.json`. Exit 2
  blocks. Exit 0 on any unexpected input: a crashing hook must not block
  every write in the repo.
- **A command**: a flat `.md` in `commands/`. The filename IS the slash
  command. Add it to the README; a test holds both directions.

## Where a test belongs

**Delete the business nouns. If the rule still means something, it is the
plugin's; if not, it stays home.**

| belongs to | the rule is about | example |
|---|---|---|
| the plugin | ANY office: the contract, kinds, walls, ratchets | "a knowledge desk has no way to send" |
| an adopting repo's root | THIS office, across its desks | "the Artisan price workbooks live only in the design desk" |
| one desk | that desk alone | "the closet proposal paginates at 12 rows" |

When a repo test's rule generalizes, it becomes a plugin CHECK and the repo
test retires to its archive. The specific file lists, channel names and
numbers never move into the plugin: a check that knows one business's nouns
fails every other office for existing.

## Before a PR

The pre-commit hook runs the whole suite with its exit code intact — a red
commit reached main twice because a pipe swallowed the runner's status, so
this stopped being a habit and became a gate. `git config core.hooksPath
.githooks` once after cloning arms it.


```
node --test "tests/**/*.test.mjs"    # the count is stated in three places; a test pins them
node checks/run.mjs                  # every check, one exit code
```

A number the docs state about this repo is checked by `stated-numbers`. If you
add a test, the README badge, CLAUDE.md and the landing page move with it, and
the suite fails until they do.

## Releasing

Two different acts, and mixing them up produced four public releases in one
afternoon (0.5.1–0.5.4), two of them one-line fixes:

- **Delivering to a machine** needs only a version bump in BOTH
  `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` (a test
  asserts they agree) plus `claude plugin update`. The cache is keyed by
  version, and an unbumped fix reaches nobody. Patch bumps are cheap and
  local — bump freely, tag nothing.
- **A public release** (git tag + GitHub release page) is a story worth
  telling: a meaningful bundle with a CHANGELOG entry that reads like one.
  Batch the patches; release at minors, or at a patch only when it fixes
  something a stranger is bitten by. A release page per one-line fix teaches
  people to stop reading release pages.
