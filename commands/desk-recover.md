---
description: After a crash, bring the office back in order — the lead first, then every desk, each resuming its own conversation
---

When the machine, the terminal app or a disk took every session down:

1. Run `node lib/start.mjs --recover` (from the plugin directory; pass the repo path first if
   you are elsewhere). It starts the lead first (office.json `lead.session`), so it is there to
   hear the desks, then every autostart desk, each resuming its own last conversation by id.
2. Read every line to the user. Desks that were already running are left as they are;
   `degraded`, `foreign` and `clash` are reported for the owner to decide.
3. Then run `/desk-health`: the desks re-arm their doorbells from their boot text, and health
   is what proves each doorbell runs under its own session.

⛔ Do not work around it by restarting desks one by one by hand, or with `--continue`. The order
matters (the lead first), and `--continue` is how a desk once resumed a case session's
conversation and believed it was that case.
