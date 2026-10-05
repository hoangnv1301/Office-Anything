# Desk health: doorbells that stay armed, and one honest answer to "is it working"

Status: BUILT on feat/desk-health (0.7.38), awaiting the lead's review. Requested by local-cabinets-ops on 2026-10-05; the owner allowed core changes on 2026-10-03.

## The incident this answers

At 11:30Z, after a Mac restart, `start.mjs all` brought every desk back as "resumed".
- **No desk had its doorbell.** A resumed session does not restore its background Monitors, so `desk-discord` ignored the owner for more than 4 minutes.
- **The session registry said `idle` the whole time.** "Alive and idle" is not "listening".
- **Stale `buyer-wake.mjs` processes from dead buyer sessions had piled up:** 5 of them, between 1 and 30 hours old.

## What can and cannot be done, and why

- ⛔ **A hook cannot start a Monitor.** Only the model can call the Monitor tool. So arming is two steps: the boot hook *tells* the session to start it, and a check *proves* it is running.
- **Proof is the process tree.** A Monitor's command runs as a descendant of the session's `claude` pid. "Armed" means: a process whose command matches the desk's `wake`, with that session's pid among its ancestors. A matching process whose session pid is dead (reparented to launchd) is an orphan.
- **Nothing re-arms a doorbell from outside the session.** Typing into a desk's terminal impersonates its human, and a bypass desk holds outside messages by design. An unarmed doorbell is reported and the lead is told; the lead re-arms it with SendMessage, session to session (see Decided).

## Fields

### desk.json (new, all optional)

| field | meaning |
|---|---|
| `wake` | The doorbell command, run from the desk's own folder. Already used by the lead's repo, e.g. `"node ../../scripts/discord/team-wake.mjs"`. |
| `wakeMatch` | A regex that identifies the doorbell process. The default is the script path inside `wake`. |
| `wakeGraceSec` | How long after session start an unarmed doorbell is still "arming" rather than RED. Default 90. |
| `wakeOwner` | `"launchd"` for a doorbell a LaunchAgent owns (ppid 1 by design), so it is never taken for an orphan. |

### office.json at the repo root (new keys; existing keys are untouched)

| key | meaning |
|---|---|
| `start` | Command to (re)start one desk. `{desk}` is replaced, e.g. `"node scripts/desk/start.mjs {desk}"`. Required for a dead-desk heal. |
| `health` | `[{ name, cmd, expect, heal, timeoutSec }]`, project checks. `expect` is `"exit0"` (the default) or `"/regex/"` matched against stdout. `heal` is an optional command, run under `--heal`. |
| `watchdog` | `{ maxHealsPerHour: 3, notify: "<session name>" }`. `notify` is the name written on each line of `.office/alerts.log`. |
| `boot` | Unchanged: the core boot hook's text (0.7.37). |

## Pieces

1. **`lib/health.mjs`: one owner for the question "is this desk working".** Per desk it reports:
   - session: alive, pid, permission mode, status
   - doorbell: armed / arming / unarmed / not configured, plus the process age
   - last transcript activity
   - result of each project check

   The whole office is green, red, or UNKNOWN (an empty walk is never clean). It reads only; it never acts.
2. **`node lib/health.mjs [root] [--json] [--heal]`** (`/desk-health`). One human line plus JSON. Exit codes: 0 green, 4 red, 7 unknown. `--heal` (lib/heal.mjs) acts only within the powers in Decided, with every act logged to `<root>/.office/heal.log` and capped per desk per hour.
3. **Boot hook.** Already in the core since 0.7.37 (`hooks/desk-boot.mjs`): it injects the `wake` line on every start and resume. Unchanged here; this feature is the half that checks it happened.
4. **Orphans.** A doorbell process whose owning session is dead is reported always and killed only under `--heal`.
5. **Board.** The `desk-health` check renders `lib/health.mjs` on the board through `collect()`, so the board knows nothing the checks do not.
6. **Watchdog (optional).** `--install-watchdog` / `--uninstall-watchdog` writes or removes `~/Library/LaunchAgents/com.office-anything.health.<folder>.<hash>.plist`, which runs `--heal` every 120 s through the shim `<root>/.office/watchdog.mjs`.

## Tests (each one red first)

- Armed: a fake session pid file plus a real child process matching `wake`.
- Unarmed past grace: RED. Within grace: arming.
- Orphan detection: the owner pid is dead.
- `expect` handling: exit code and regex.
- Heal cap: the 4th heal in an hour is refused, and refusal triggers a notify.
- `--heal` never acts without the flag.

## Decided (the lead, 2026-10-05)

- **`--heal` may:** kill proven orphans; restart a dead desk through `start`, at most 3 per hour per desk; notify the lead.
- **`--heal` may NOT type into a desk terminal.** An unarmed doorbell is reported RED and the lead is told; the lead re-arms it with SendMessage, session to session.
- **The watchdog ships as `--install-watchdog`;** the lead installs it after merge.
- **The interim `scripts/desk/health.mjs` checks move into `office.json` `health`.**

## Changed while building

- **Red is exit 4, not 1:** the checks' own 0 / 4 / 7.
- **Notify is a file:** a line in `.office/alerts.log`, one per subject per 15 minutes, not an inbox message. A script has no permission mode to declare, so a bypass lead would hold every alert for the owner to approve. The lead watches the file with its own Monitor (`tail -n0 -F .office/alerts.log`).
- **Health is also the `desk-health` check,** so the board shows it through `collect()` without a board-specific panel. One unreadable `desk.json` does not blind it to the others.
- **Found on the first real run:**
  - `desks/discord/desk.json` declares `kind: "liaison"`, which the contract does not know (`channel`, `knowledge`, `lead`). The roster cannot read it, so the desk from the incident is not watched until that is settled.
  - 5 orphan `buyer-wake.mjs` processes, 1 to 30 hours old.

## After the lead's review (2026-10-05)

| item | fix |
|---|---|
| 1 snapshot re-proof | each kill re-reads `ps` and the session registry: same command, same parent, age no younger, orphan rule again |
| 2 matching too broad | a doorbell is the interpreter `wake` names running the script; an orphan has only shells/node above it to launchd and its script inside this office; unplaceable = listed as unproven, never killed |
| 3 state and overlap | budget written the moment it is spent; `.office/heal.lock` (stale after 10 min) |
| 4 LaunchAgent | PATH carried, `/usr/bin/env node`, ProcessType Standard, shim and log on the home disk, one line an hour when the office disk is missing, temp folders and worktrees refused |
| 5 autostart:false invisible | "off by design: <desk>" in the line; `watch: true` makes it red when down |
| 6 reused session pid | alive only if the pid is a claude process at least as old as the session |
| 7 unbounded logs | heal.log and alerts.log rotate at 512 KB, the watchdog log at 1 MB; `.office/.gitignore` is `*` |
| 8 tests | zsh wrapper under launchd, pager/editor/grep, pid reuse, fresh re-read, kill injected everywhere; each guard broken and seen red |
| scope: boot line | the default line asks for Monitor `timeout_ms 1800000` and to re-arm on every expiry notice (the Monitor schema: default 5 min, max 30, killed at expiry, session notified). A test pins that the boot hook has no matcher, so it fires on resume |
| scope: verifier | not a detached verifier from the hook: `desk-health` is the verifier, run by the watchdog every 120 s, with a 90 s grace before an unarmed doorbell turns red |
