---
description: One session per case under its parent desk — open, list, close, route, or sweep the case sessions
---

A desk that declares `perCase` in its desk.json gets one Claude session per case, named
`desk-<desk>--<key>`, in the desk's own folder and under the desk's role: same wall, same
token, same CLAUDE.md. The parent desk stays for everything that is not one case.

1. Open one case by hand: `node lib/cases.mjs open <desk> <key>` (from the plugin directory;
   pass the repo path first if you are elsewhere). It claims the case through the desk's
   adapter first, writes the brief to `.office/cases/<desk>--<key>.md`, starts the session
   (resuming that case's own earlier conversation if it has one) and waits until the session
   registry says it is up. Read the answer as it is: `up`, `already`, `clash` (two sessions on
   one case), `cap` (the desk is at its limit; the case stays with the parent), `refused`
   (another session holds it, or the key is not a case key), `unknown` (the adapter failed:
   never a grant), `failed`.
2. `node lib/cases.mjs list` shows each desk's live case sessions against its cap.
3. `node lib/cases.mjs sweep` is the minute loop: heartbeat the claims, close a session whose
   claim was lost or that sat idle past `idleCloseMinutes`, release claims of sessions that are
   gone, then open waiting cases oldest first up to the cap. Schedule it; do not run it by hand
   in a loop.
4. `node lib/cases.mjs route "<message>"` says which session a message about a case goes to:
   its live case session, or the parent desk.
5. `node lib/cases.mjs close <desk> <key> --why "<reason>"` ends one; a stuck claim held by
   someone else is released only with the human's words:
   `node lib/cases.mjs release <desk> <key> --by <name> --said "<what they said>"`.

⛔ Do not work around it by typing `claude --name desk-<desk>--<key>` yourself or by giving the
parent desk a second case to carry. The claim is what keeps two sessions off one case, the cap is
what keeps the machine usable, and a case mixed into another case's conversation is the fault
this exists to stop.
