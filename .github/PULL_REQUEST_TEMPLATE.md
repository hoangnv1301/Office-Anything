## What and why

<!-- The subject says what kind of change it is (feat/fix/docs/...); this says WHY, in full sentences. -->

## Checklist

- [ ] Commits follow the typed convention in [CONTRIBUTING.md](../CONTRIBUTING.md) (`git config core.hooksPath .githooks` enforces it)
- [ ] `node --test "tests/**/*.test.mjs"` passes (the glob form, not `node --test tests/`)
- [ ] `node checks/run.mjs` exits 0
- [ ] A new guarantee has a test that was seen to fail when the guarantee was broken
- [ ] A new claim in the README has a test that pins it
- [ ] Changed `commands/`, `hooks/` or `lib/`: version bumped in `plugin.json` **and** `marketplace.json`, with a note in `docs/releases.json`
