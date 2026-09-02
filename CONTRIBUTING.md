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

## Before a PR

```
node --test "tests/**/*.test.mjs"    # the count is stated in three places; a test pins them
node checks/run.mjs                  # every check, one exit code
```

A number the docs state about this repo is checked by `stated-numbers`. If you
add a test, the README badge, CLAUDE.md and the landing page move with it, and
the suite fails until they do.

## Releasing

Bump the version in BOTH `.claude-plugin/plugin.json` and
`.claude-plugin/marketplace.json` (a test asserts they agree), add a
CHANGELOG entry, tag `vX.Y.Z`, publish a GitHub release. **The version bump is
the delivery mechanism**: the plugin cache is keyed by version, and an
unbumped fix reaches nobody.
