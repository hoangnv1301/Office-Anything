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
3. `degraded` and `foreign` are reported, never fixed by a plain start. Use `--restart` to fix one.
4. To restart desks that are already running, for example after a Claude Code update, run
   `node lib/start.mjs <name|all|lead|everything> --restart [--wait <sec>]`. A desk is stopped by
   its pid only once it is idle, so never mid-turn. Its tab is closed and it resumes the
   conversation it was running, by id. The rows read `restarted`, `deferred` (still busy after the
   wait; run it again later) or `failed` with the reason. `node lib/start.mjs outdated` lists the
   desks and leads on an older Claude Code than the installed one, and `outdated --restart`
   restarts them one at a time.

⛔ Do not work around it by typing `claude --continue` in a desk's folder or opening a terminal by
hand. `--continue` resumes the NEWEST conversation there, and a desk's case sessions write in the
same folder: after one crash the parent desk woke up as a case. `lib/start.mjs` resumes only the
desk's own conversation, by id, and refuses to open a second session under a live name.
