---
description: The office on one page — desks, usage, worktops and every check, read-only on localhost
---

Start the office board for the current repo (or a path the user gives):

```
node board/serve.mjs --port 7719
```

Then tell the user the URL it prints (http://127.0.0.1:7719) and STOP — do not
keep polling the page.

⛔ Use `board/serve.mjs`. Do not work around it with a hand-rolled server or a rendered copy of the
page. The board's one guarantee is that it cannot know something
`checks/run.mjs` does not: it renders `collect()` and the same native sources
(desk.json, transcripts, scratchpads), re-gathered per request. A hand-rolled
page would be a second owner of "how is the office", and it would drift the
day a check changes.

It binds loopback only. If the user asks to expose it on a network, decline
and say why: the page lists what every agent is doing.
