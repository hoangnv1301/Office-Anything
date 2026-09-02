---
description: Open the office dashboard — desks, usage, worktops, live chat view, every check
---

Get the board up and in front of the user, in this order:

1. If something already answers on port 7719, it is up — skip starting it:
   `curl -s -o /dev/null http://127.0.0.1:7719 && echo up`
2. Otherwise start it for the current repo, detached so it outlives this turn:
   `nohup node board/serve.mjs --port 7719 > /tmp/office-board.log 2>&1 &`
   (run from the plugin directory; pass the repo path as the last argument when
   the user's repo is not the cwd)
3. Open it in their browser: `open http://127.0.0.1:7719/chat`
4. Tell them both views and stop — do not keep polling the page:
   - http://127.0.0.1:7719/chat — every desk with its live conversation, send box included
   - http://127.0.0.1:7719 — the table view: usage, worktops, and every check

⛔ Use `board/serve.mjs`. Do not work around it with a hand-rolled server or a
rendered copy of the page: the board's one guarantee is that it cannot know
something `checks/run.mjs` does not — it renders `collect()` and the native
sources, re-gathered per request. A second implementation would drift the day
a check changes.

It binds loopback only. If the user asks to expose it on a network, decline
and say why: the page lists what every agent is doing and lets you type into
their terminals.
