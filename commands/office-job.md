---
description: List, run or cancel the office's prepared jobs (parked work any session can start), with no plugin path to type
---

A prepared job is work somebody wrote down in advance: a brief, a role to do it, and maybe a
gate it waits for. It is the office's, on disk in `.office/schedule.json`. Every session that may
run it is told at its start ("1 prepared job waiting: … /office-job run <id>").

Run everything from the plugin directory, `node lib/schedule.mjs <office path> …`, with the office
path first (the office root: the folder holding `office.json`).

- **No argument, or `list`:** `node lib/schedule.mjs <office> list`. Show the user the parked and
  pending jobs as printed: id, state, role, what each needs.
- **`run <id>`:** `node lib/schedule.mjs <office> run <id>`. This is `runJob` in
  `lib/schedule.mjs`: it checks the job's gate (a plugin version, or a file inside the office that must exist; a gate never runs anything),
  then makes the job due now. The watchdog's next pass, within about two minutes, hands it to its
  role: typed into that role's idle tab, or the role opened with the job as its first message.
  Read the user the line it prints, or its refusal and the reason (held by its gate, not parked,
  another department's role, a desk).
- **`cancel <id>`:** ask the user why, then `node lib/schedule.mjs <office> cancel <id> --why "<reason,
  20+ characters>"`. The reason is recorded on the job.

⛔ Do not work around it: do not edit `.office/schedule.json` by hand, open the role yourself, or type the brief into a
session. `runJob` is the only path that checks the gate and leaves the handing to the watchdog. A
job handed by hand as well as by the watchdog is done twice, and a hand-edited state skips the
gate that kept it waiting. A desk may not run, add or cancel a job: a desk that could start a role
would walk out of its own wall.
