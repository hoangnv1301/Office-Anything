---
description: Fire a desk, properly, with the checklist that stops it breaking the rest
---

Fire a desk. Arguments: $ARGUMENTS

⛔ **Firing is not deleting a folder.** Use `fire()` from `lib/fire.mjs`, which REFUSES
rather than warns. Do not work around a refusal.

1. **Run `blockers(root, name)` first and show the user what it says.**
   - `live` — the desk is reaching real people. It must be taken dark deliberately, and
     anyone mid-conversation must be allowed to finish. This is never a formality.
   - `referenced` — something still names this desk. A dangling reference outlives the
     folder: docs telling an agent to go ask a desk that no longer exists.

2. **Get a real reason.** 20+ characters, and it is recorded. If the user gives you
   something thin, ask for the actual reason rather than padding theirs to fit.
   ⛔ Never invent one to get past the check.

3. **Do the manual steps `fire()` hands back, in order.** Each exists because skipping it
   broke something real. `session` is first for a reason: a retired desk does NOT exit when
   its folder moves, and a desk still running after being fired is invisible to everything
   counting desks.

4. **Report what is left.** If you did not do a step, say which and why. A fire reported
   as complete with step 2 skipped is how shared code goes missing.
