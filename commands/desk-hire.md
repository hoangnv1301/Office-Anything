---
description: Hire a desk from a one-line description of the role
---

Hire a new desk. The user's description of the role is: $ARGUMENTS

⛔ **Call `hire()` from `lib/hire.mjs`. Do not assemble a desk by hand.** Picking a port
yourself and writing `desk.json` directly skips every guard: the name rules, the port
already being claimed, the second-reader agreement, and the rule that only one lead exists.
Those live inside `hire()` and nowhere else.

1. **Read the description and decide the kind.** Say which you picked and why.
   - `channel` — it talks to people outside the company
   - `knowledge` — it answers other desks, and never a customer
   - `lead` — it organizes the team. There is only ever one.

2. **Call `hire(root, { name, kind, description })`.** Pass the description through: it is
   what the second reader checks your decision against.

   ⛔ **If it refuses, do not retry with a different kind to get past it.** A refusal means
   your reading and the words disagree, or the description is genuinely ambiguous, and that
   question is about who may talk to a customer. Show the user both readings and ask.

3. **Tell the user what was issued and what was withheld**, from the return value. A
   knowledge desk gets no browser and no sender, and that is the point rather than a
   limitation.

4. **Run `node checks/run.mjs` and show them the red.**

   ⛔ **The new desk will fail, and that is correct.** It has real files with real headings
   and no content. Explain that this is what an empty desk looks like, and what they need to
   write to turn it green. Do not fill the stubs in yourself to make the board look clean.
