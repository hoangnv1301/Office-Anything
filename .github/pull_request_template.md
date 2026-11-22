## ELI5

<!-- Simple high-level explanation, in plain language. No jargon. -->

## What Changed

<!-- Describe the change clearly and keep scope tight. Cover the before and after as the user experiences it, and the mechanism you changed — not just the symptom. -->

## Why

<!-- What problem does this solve, and why is this approach better than the alternatives you considered? -->

## Linked Issue

<!-- Link the issue this PR addresses, there should ALWAYS be one -->

Fixes #

## Visual Proof

<!-- REQUIRED for UI / behavior changes (the board, a command's output, a desk's refusal). Please attach a BEFORE and AFTER that can easily be tabbed/switched. Use videos for when appropriate over screenshots -->
<!-- If there is truly no visual or interaction change, write exactly: `N/A` and briefly say why. -->
<!-- For attachments NEVER add directly to the PR files (do not commit to files), use `gh image` extension or drag + drop (works for any attachment) -->

## Testing

<!-- How did you verify this? Steps a reviewer can follow. Which platforms did you actually test (macOS / Linux / Windows), and in which office (this repo's own, an adopting repo)? -->

- [ ] I manually tested these changes in a real office
- [ ] Automated tests added/updated, or explained why not below
- [ ] Every added test fails without this change (a new guarantee was seen to fail when broken)

## Performance

<!-- Required. Does this change make anything run more often, do more work, or use more memory? Consider:
- Hot paths: every hook call (they run on each tool use), doorbells and wakes, the board, polling
- Disk reads and writes, git and other subprocesses
- Scale: many desks, cases, worktrees or files, and very large ones
- How you measured it, or how you reasoned about it
- The trade-off, if any, and why it is worth it
If you find a real performance problem, fix it in this PR rather than only describing it.
Most PRs need one line: finish the sentence below, e.g. "None, because this only runs when /desk-status opens." -->

None, because

## Risk

<!-- What could this break, and for whom? Name the riskiest part of the change and what users would see if it went wrong. Call out anything that crosses a boundary: a hook that could block every write, walls and gates, saved desk state or office.json, adopting offices on older versions, other platforms, or performance. Say how to back it out: a plain revert, or what a revert would not undo. -->

**Level:** <!-- Low, Medium, or High -->

## AI Disclosure

<!-- Which AI model if anyone was used, please state the details -->

## Review

## Notes

Ensure no issues in: Security, Cross-platform support (Linux, Windows, Mac), adopting offices, hooks never blocking on unexpected input, general backwards compatibility, performance

## Checklist

- [ ] This PR is small and focused
- [ ] I explained what changed and why (ELI5, the user-facing before/after, the mechanism, and why over the alternatives)
- [ ] I stated the risk: what could break, for whom, and how to back it out
- [ ] Before/after screenshots or videos attached for UI changes, or `N/A` with reason
- [ ] Self-reviewed for correctness, security, and performance
- [ ] Cross-platform and adopting-office impact considered (or N/A)
- [ ] Commits follow the typed convention in [CONTRIBUTING.md](../CONTRIBUTING.md)
- [ ] `node --test "tests/**/*.test.mjs"`, `node checks/run.mjs` and `cd board/ui && npx vitest run` pass (or CI will cover; local preferred)
- [ ] Changed `commands/`, `hooks/` or `lib/`: version bumped in `plugin.json` **and** `marketplace.json`, with a note in `docs/releases.json`
