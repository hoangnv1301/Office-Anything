---
description: Hire a desk from a one-line description of the role
---

Hire a new desk. The user's description of the role is: $ARGUMENTS

1. **Infer the kind** from the description, and say which you picked and why:
   - `channel` — it talks to people outside the company
   - `knowledge` — it answers other desks, and never a customer
   - `lead` — it organizes the team. There is only ever one.

2. **Pick a port** with `nextFreePort` from `lib/desk.mjs`. Write it into `desk.json`.
   ⛔ Never derive a port from position in a list.

3. **Issue only what the kind may hold**, per `ISSUE` in `lib/desk.mjs`.
   ⛔ A knowledge desk is never issued a sender. A channel desk gets one only when it
   is made live, and going live is a reviewed edit the user makes deliberately.

4. **Write real stubs with real headings and no content.**
   ⛔ Do NOT make the new desk pass its checks. It should go red and name what is
   missing. A hire that arrives green teaches the user the gates are decoration.

5. **Run the checks and show the user the red.** Explain that this is correct, and what
   they need to write to turn it green.
