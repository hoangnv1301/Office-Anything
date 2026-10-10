---
description: Start a desk (or all of them, or the lead) resuming its own conversation, never another's
---

Start desks the way the office expects, from the CLI's own session registry:

1. Run it from the repo, naming what to start:
   `node lib/start.mjs <name|all|lead|everything>` (from the plugin directory; pass the repo
   path first if you are elsewhere). `all` skips desks whose desk.json says `"autostart": false`;
   `everything` is the lead first, then all. Add `--fresh` to start a desk with a new conversation
   on purpose, for example to repair one that resumed the wrong history.
2. Read each line to the user as it is: `up` (registered and idle, with how long it took and
   whether it resumed its own conversation), `already`, `degraded` (alive but restored outside
   its folder), `foreign` (alive but running another session's conversation), `clash` (two live
   sessions under one name: nothing was opened), `busy` or `failed`. Exit 0 only when every
   target is up or already running.
3. `degraded` and `foreign` are reported, never fixed by this command: closing a live desk is
   the owner's call. Once the owner closes it, start it again.

⛔ Do not work around it by typing `claude --continue` in a desk's folder or opening a terminal by
hand. `--continue` resumes the NEWEST conversation there, and a desk's case sessions write in the
same folder: after one crash the parent desk woke up as a case. `lib/start.mjs` resumes only the
desk's own conversation, by id, and refuses to open a second session under a live name.
