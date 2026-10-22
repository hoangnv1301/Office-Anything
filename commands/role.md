---
description: Open a new session as a role (AICS, ERP, construction, full) from office.json profiles, never a second one under a live name
---

A role is a NEW session. Its CLAUDE.md, settings deny list, claudeMdExcludes and name are fixed
when it starts, so this session is never switched in place, and it stays as it is.

1. List the roles this machine may open:
   `node lib/role.mjs list --json` (from the plugin directory; pass the office path first if you
   are elsewhere). A department's role shows only on a machine whose `.office/local.json` names
   that department.
2. Ask the user which one with AskUserQuestion, one option per role (its name and session), the
   machine's `default` first. Offer only what the list returned.
3. Open it: `node lib/role.mjs open <role>`. Read the line to the user as it is:
   - "the new <session> session is open in Orca tab <handle>; you can close this one"
   - "<session> is already open: Orca tab <handle>, brought forward; not opening a second"
   - a refusal, with its reason
   It opens an Orca tab titled with the session name, else a tmux window, else a Terminal window.

⛔ Do not work around it by typing `claude --name <role>` yourself, or by switching this session's
settings. A hand-started session has none of the role's settings (its deny list, its excluded
CLAUDE.md), and a second session under a live name splits every message sent to it. A desk may
not open a role at all: a desk that could open "full" would walk out of its own wall.
