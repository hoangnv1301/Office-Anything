---
description: Is every desk running and listening? Doorbells, sessions, project checks, orphans; optionally heal
---

Answer "is the office really working" from the process tree, not from what the
desks say about themselves:

1. Run it for the current repo (or pass the repo path):
   `node lib/health.mjs` (from the plugin directory) — one line, exit 0 green, 4 red, 7 unknown.
   Add `--json` for every desk's session, permission mode, status, doorbell
   (armed / arming / unarmed) and the office.json `health` checks.
2. Read the line to the user as it is. Red names the desk and the reason.
3. Only if the user asks to heal: `node lib/health.mjs --heal`. Within the
   powers the office granted, it kills proven orphan doorbells, restarts a dead
   desk through office.json `start` (at most 3 times an hour per desk), runs a
   failing check's own `heal`, and writes alerts for the lead to
   `.office/alerts.log`. Every act lands in `.office/heal.log`.
4. Only if the user asks for it to run unattended:
   `node lib/health.mjs --install-watchdog` (a LaunchAgent, every 120 s);
   `--uninstall-watchdog` removes it.

⛔ Do not work around it by checking `ps` or the session list by hand. "The
session is idle" was true for every desk on the morning nobody's doorbell was
running; only `lib/health.mjs` asks whether the doorbell runs UNDER that desk's
own session. And never re-arm a doorbell by typing into a desk's terminal:
tell the lead, who re-arms it with SendMessage.
