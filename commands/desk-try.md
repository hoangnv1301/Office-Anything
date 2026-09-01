---
description: Hire a desk to try something out, so firing it actually removes it
---

Try something without letting it into the rest of your setup. What to try: $ARGUMENTS

The point of a trial desk is that firing it is a real uninstall. That only works if
everything the trial brings in lands inside the desk, and is written down.

1. **Call `hire(root, { name, kind, description })`** from `lib/hire.mjs`. Name the desk
   after the thing, kind `knowledge` unless it genuinely needs to talk to people. A trial
   gets no sender and no route out.

   ⛔ **Do not assemble the desk by hand.** Picking a port yourself and writing `desk.json`
   directly skips the name rules, the port check, the one-lead rule and the second-reader
   agreement about who may talk to a customer. Those live inside `hire()` and nowhere else.

2. **Install into the desk's own folder**, never the project root. Clone, npm install,
   config files: all of it under `desks/<name>/`.

3. **Record what you brought in.** Add an `installed` array to `desks/<name>/desk.json`
   listing each thing by name. `checks/stray-writes.mjs` uses that list to tell you if any
   of it ended up outside the desk, which is the case where firing would leave litter.

4. **Talk to the desk about the trial, not to your main session.** It has its own context
   and its own browser. That is the isolation you are paying for; using it from the main
   session gives it away.

5. **When you are done, `/desk-fire` it.** Run `node checks/run.mjs` afterwards and confirm
   `stray-writes` is clean. If it is not, the trial left something behind and you want to
   know that now rather than in six months.

⚠️ **Say plainly what this does and does not do.** A desk isolates a folder, a browser
profile and an agent's context, and it makes removal verifiable. It is not a sandbox: it
does not stop a determined script writing wherever it likes. If you are trying something
genuinely untrusted, use a container.
