---
description: Which desks run on this machine. List them, or switch one on or off here only
---

1. Run `node lib/desks.mjs list` (from the plugin directory; pass the repo path if you are
   elsewhere). The first line says how many desks this machine runs, then one line per desk:
   on or OFF, and where that comes from. A name in the file that is no desk is flagged.
2. To switch: `node lib/desks.mjs on <desk>` or `node lib/desks.mjs off <desk>`. To run only a
   few desks: `node lib/desks.mjs default off`, then `on` for each one wanted.
3. Read the lines to the user as they are. Turning a desk off closes nothing: if it is still
   running, or still holds cases, the lines say so, and the lead is alerted. Ask the lead who
   takes that work over.

The switch lives in `.office/local.json`, which is never committed: it changes this machine
only. A desk that is off is not started (by `/desk-start all` or by name), not restarted by the
watchdog, not told to arm its doorbell, and takes no new cases.

⛔ Do not work around it by editing `office.json`, `desk.json` `autostart`, or the file by hand.
`office.json` is everyone's office; `autostart` turns the desk off on every machine; and a
hand-written file with a typo is refused, so nothing starts until it is fixed.
