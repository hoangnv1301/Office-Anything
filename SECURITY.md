# Security

## What this plugin touches

- **Reads**: `desks/*/desk.json`, test files, and git history of the repo it
  is pointed at. Nothing outside the audited repo.
- **Writes**: `hire` and `fire` write inside the target repo's `desks/` and
  `bk/`. Checks write nothing.
- **Secrets**: `hooks/no-secrets.mjs` exists to keep credentials OUT of
  commits. No check reads a credential, and there are none in this repo to
  read. Findings about a leak report the location, never the value.
- **The board's send**: to deliver a message to a desk the way SendMessage
  does, the board reads that session's messaging key from
  `~/.claude/sessions/<pid>.<hash>.key` and presents it on the session's own
  local socket. The key never leaves the machine, is never logged, and is
  never sent to the page. Loopback only, as the whole board is.
  Writing requests are accepted only from the board's own host and origin,
  as `application/json`, so another site's page cannot drive a desk.
- **Network**: none. No telemetry, no calls out.

## Reporting

Open a GitHub security advisory on this repository, or an issue if the report
is not sensitive. Include the class of problem and where to look, not a
working exploit. Fixes ship as a patch release; the CHANGELOG says what was
wrong in plain language once users have had a chance to update.
