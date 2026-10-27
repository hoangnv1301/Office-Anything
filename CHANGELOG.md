# Changelog

## 0.20.5

- ⛔ THE CASE SWEEP DIED ON A GONE SESSION (2026-10-27). The names change removed `staleChild`
  but left one call in the release check for an opened case whose session is gone, so every sweep
  that met one threw `staleChild is not defined` and no per-case session opened (design cases sat
  waiting from 2026-10-25). The check asks only for the case's own child name now. Pinned in
  `tests/cases.test.mjs`; the queue filter test no longer goes red on its own when a fixed date passes.

## 0.20.4

- ⛔ THE TEAMMATE GUARD (the owner, 2026-10-24). A desk's teammates are
  `<its session>-<who>` (`aics-alibaba-<Buyer>`), and buyer names can be all lower
  case, so a desk `alibaba-x` would be session `aics-alibaba-x`: buyer x's
  teammate. `hire` refuses a new desk whose name starts with another desk's id,
  desk.json name or `formerly` id plus `-`. Pinned in `tests/hire-fire.test.mjs`.

## 0.20.3

- ⛔ NO GATE RUNS ANYTHING (security review of 0.20.1). `needs.command` ran a
  shell string from `.office/schedule.json` in whoever typed `/office-job run`:
  one person's line in another's session, often a more trusted role than the one
  that wrote it. A gate is data now. `needs.file` (`--needs-file`) is a path inside
  the office that must exist, realpath-checked so a link out of the office is no
  gate. `needs.command` is refused at add, and a job written with one before this
  is held with the reason, its command never run. Pinned in
  `tests/parked-jobs.test.mjs`.

## 0.20.2

- ⛔ A STALE WATCHDOG SHIM SKIPPED A LIVE OFFICE FOR FOUR HOURS. The LaunchAgent's
  shim is written once, at --install-watchdog, and local-cabinets-ops' was written
  before desks could live in departments/: it ran health only when
  `<root>/desks` existed. The departments cleanup retired desks/ (2026-10-23),
  and from about 09:30Z every pass logged "office not found (disk not mounted,
  or moved)" and exited, with the disk mounted. No dead-desk restart, bell kick,
  limit resume or compact ran, and a scheduled job due at 10:17Z was never handed.
  The 0.16.0 template had fixed the test, and nothing ever rewrote a shim already
  installed.
  - The shim now decides nothing but "does the folder exist": it finds the newest
    install and runs its `lib/watchdog-pass.mjs`, where the office test lives
    (an office.json, or any desk folder) and moves with every update.
  - `lib/watchdog.mjs` `refreshShim` rewrites an installed shim that is not the one
    this version writes (the file only; launchd is not touched). Every session
    start (hooks/desk-boot.mjs), `health` and `ensureWatchdog` ask it.
  - Both of the shim's messages are said once an hour.

## 0.20.1

- ⭐ PARKED JOBS. The owner: prepared work starts with one easy command, by
  whoever opens a session, coworkers included. `schedule.mjs add --parked`
  takes no time; `/office-job run <id>` (`runJob`) makes it due now, and the
  watchdog's next pass hands it as it hands any job, so it is never handed
  twice. `hooks/desk-boot.mjs` names parked jobs at session start: a role its
  own, the lead and the root every one here, a desk none. `needs.plugin`
  (">=0.20.0", re-checked at hand-over) and `needs.command` (exits 0; run only by
  the caller's `run`, printed first, never by the watchdog) hold it back.
- ⛔ THE COMMIT REVIEW OF 0.20.0, two fixes. With office.json unreadable the wall
  could not learn the prefixes, so an `aics-x` session no longer claimed a desk:
  the hook now remembers the last good list in `.office/session-prefixes.json`.
  The board stripped a prefix off a tab title to find its desk, so `erp-web` was
  desk web: a title is a desk now only by `deskOfSession`, its current name wins,
  and two tabs that tie are not guessed between.

## 0.20.0

- ⭐ SESSIONS CARRY THEIR DEPARTMENT. The owner, 2026-10-23: a desk's session is
  `<dept prefix>-<id>` (aics-web-design, erp-inventory), its cases
  `<session>--<key>`, buyer teammates `aics-alibaba-<Buyer>`. `office.json`
  `departments.<id>.prefix`; a desk in no prefixed department stays `desk-<name>`.
  Every `<prefix>-*` name is its department's for usage and alert routing.
- ⛔ ONE OWNER FOR NAME -> DESK. About 25 sites built `'desk-' + x` or tested
  `/^desk-/`. `lib/desk.mjs` now gives each desk `d.names`, every name it answers to,
  and `deskOfSession` matches them exactly: `aics-web-design` is desk web-design,
  never web's teammate. `tests/session-names.test.mjs` walks lib/, hooks/, board/,
  checks/ and scripts/ and fails on a hand-built name or a shape test.
- ⛔ THE WALL ASKS TWO QUESTIONS. A `<prefix>-<x>` that resolves to no desk is
  refused (fail-closed), as an unknown `desk-<x>` always was. A declared
  `wall.aliasNames` pattern may still map it, so a teammate is its desk and is
  walled as that desk.
- RENAMED FOLDERS. desk.json `"formerly": [old ids]` keeps the desk's old
  sessions its own, and `start` finds its conversation under the old folder
  (in its department's folder or desks/) and carries it over. An old id that is
  another desk's makes both broken. A desk name or folder may not hold `--`.
- A prefix is lowercase letters and digits, unique, not desk/cs/lead, and not a
  lead's or a builder's name. Two departments claiming one prefix: neither gets it.
- LEADS' OWN MODEL. `departments.<id>.model`, else `launch.lead.model`, for every
  lead launch; `launch.model` stays the desks'. A watchdog restart brought the
  leads back on Sonnet.

## 0.19.7

- SKIPPED, NOT OWED. The release forum's cap is 10 posts a day, and
  `release-post.mjs --missing` would have spent three days on the 25 notes from
  before the forum existed (0.10.0 to 0.18.8) before reaching 0.19. The lead,
  2026-10-23: nobody needs them. `docs/releases.json` `"_skipped": { "through":
  "0.18.8", why, decided }` retires them; `--missing` owes only what comes after,
  and one version named on the command line still posts. Pinned in
  `tests/releases.test.mjs`.

## 0.19.6

- ⭐ A LEAD COMPACTS AT A TASK BOUNDARY. The owner, 2026-10-23: the lead should
  compact itself "like when switching to another job", not only at the size
  limit. `compact.lead` may be its own `{ aboveK, idleMin, everyMin, focus }`
  (local-cabinets-ops: 200K, 10 minutes), so heal types `/compact <focus>` into a
  lead that sits idle over its size, at most once per its `everyMin`. The window
  Claude Code compacts at by itself was already on every lead launch (start, the
  watchdog's restart, `/role`) from `context.lead`; `tests/context.test.mjs` now
  drives a department lead through start and `/role` to pin it.
- ⛔ NEVER OVER SOMEBODY'S TYPING. Idle in the registry says nothing about text
  in the input box, and the compact typed into the tab without looking. It now
  needs the empty `❯` on screen (as the limit resume and the bell kick do); an
  unreadable screen is not empty. Pinned in `tests/compact.test.mjs`.

## 0.19.5

- ⛔ THE WALL-HOOK CHECK WAS EASIER TO PASS THAN THE WALL (commit security
  review of 0.19.4). `disableAllHooks` in a desk's settings.json or
  settings.local.json turns every hook off, the wall's included, and the check
  read only the hooks list: it fails the desk now. The matcher must cover every
  tool that writes (MultiEdit and NotebookEdit too), and the refusal is judged
  by an allowlist instead of three swallow patterns: after the node call only
  `|| exit 2` may follow (`; exit 0` and `| cat` passed before).

## 0.19.4

- ⛔ EVERY DESK CARRIES THE OFFICE'S OWN WALL HOOK, AND HEALTH SAYS WHEN ONE
  DOES NOT. local-cabinets-ops audited it in `desks/checks/write-wall.mjs`,
  which ran only when somebody ran it, and its rfq desk had no settings at all.
  `office.json` `wall.deskHook` names the hook (`office/hooks/write-wall.mjs`);
  `lib/desk-hook.mjs` passes a desk only when one PreToolUse entry of its
  `.claude/settings.json` runs a script resolving to that file through any link
  (or to this plugin's `hooks/desk-wall.mjs`), matches Bash, Write and Edit, and
  does not swallow its refusal (`|| true`). A copy inside the desk's own folder
  is not the office's hook. No `deskHook`, nothing asked. The other half of that
  audit, database commands in desk transcripts, was already `wall.audit` in the
  `desk-wall` check. Pinned in `tests/desk-hook.test.mjs`.

## 0.19.3

- ⛔ A BARE NAME BUILDS AN OFFICE TOO (commit security review of 0.19.2). Only
  operands with a slash were write targets, so `mkdir office && mv hooks office`
  planted office/hooks in a desk's folder unseen. Every non-option operand of
  the plain writers (rm excepted: it takes one away) is now judged for the
  office shape; after a cd, the name's shape alone decides.
- ⛔ AND WHAT THE WALL CANNOT READ, HEALTH SEES. tar, unzip or a script can
  write anything; the wall reads common shell shapes. Health is now red for a
  desk whose folder holds desks/, departments/, office/ or office.json at its
  top level, where an office's hook fallback would look. Both pinned in
  `tests/department-folders.test.mjs`.

## 0.19.2

- ⛔ NOR AN office/ FOLDER. local-cabinets-ops' desks/ cleanup moved the office's
  hooks to `office/hooks`, so a desk planting `<desk>/office/hooks/*.mjs` is the
  same road 0.18.6 closed for `desks/`, `departments/` and `office.json`: a hook
  command that fell back to the session's folder would run it. The hook's root
  check already blocks that fallback; this is the second layer. Write, Edit and
  Bash share one rule now (`lib/wall.mjs` `officeShape`), so the next folder
  is one word, not two copies. Pinned in `tests/department-folders.test.mjs`.

## 0.19.1

- ⛔ AN UPDATE DOES NOT MAKE A RUNNING BELL "UNARMED". ERP (2026-10-23) armed
  0.18.7's lead-bell; with 0.19.0 installed, the watchdog's health looked only
  for 0.19.0's, said "ERP doorbell unarmed", and heal typed ERP a kickoff
  naming the 0.19.0 folder, which ERP's 0.18.7 wall had never heard of. Health
  now counts a lead's bell from any version folder of this plugin in the cache
  (`lib/wall.mjs` `bellRoots`: a real folder there with this plugin's name; from
  a checkout, the cache Claude Code recorded), notes `version` when it is not
  the current one, and says so in the tail: "ERP doorbell runs 0.18.7's bell
  (this is 0.19.0): restart it when idle". The wall is unchanged: since 0.18.8
  it already accepts the newer recorded install, and never an older one. A
  session started before 0.18.8 keeps its old wall until it restarts.
  `tests/plugin-versions.test.mjs` drives the 0.18.7 → 0.19.0 upgrade.

## 0.19.0

- ⛔ A SCHEDULED JOB RUNS WHETHER OR NOT ITS SESSION IS THERE. The owner,
  2026-10-23: "if a scheduled run's session isn't there, it must init itself."
  The desk move at 05:07Z was a session-only cron in one builder's memory;
  had that session closed, nothing would have run and nobody would have known.
  `lib/schedule.mjs` keeps jobs in `.office/schedule.json` (briefs in
  `.office/schedule/<id>.md`), and the watchdog's heal hands each due job to
  its role: typed into the running role's tab when it is idle at an empty
  prompt, else the role is opened (lib/role.mjs openRole, new `prompt`) with
  the job line as its first message. A window that passes marks the job
  MISSED, with a SCHEDULE alert for the lead and a health warning. A job is
  handed once, a desk cannot schedule a role, a cancel needs a reason, and
  nothing real opens under a test.

## 0.18.8

- ⛔ A PLUGIN UPDATE DOES NOT STRAND A RUNNING LEAD. A session keeps the hooks
  it started with: ERP, started on 0.18.4, was told to run its 0.18.7 doorbell,
  and its wall refused the new folder, so it ran the old bell until restarted.
  `{plugin}` (in wall.lead.bash, wall.lead.monitor and a session's own wake) now
  also matches a newer version that Claude Code RECORDED installing
  (installed_plugins.json, under this plugin's name), beside this one in the
  plugin cache: a version name, the same plugin.json name, a real folder there
  and not a link. A folder that merely appeared in the cache is not an install
  (commit security review). Never an older one. Where {plugin} is now comes only
  from the gate, never from office.json's wall block, which could set
  `pluginRoot` before. Helps sessions started on 0.18.8 or later; one already
  running on an older wall still needs a restart.
- ⛔ THE KICKOFF GOES AFTER `--`. `--remote-control` takes an optional [name],
  so a lead launched with it got its kickoff as its Remote Control name, sat
  deaf, and start still said "given its first message". The first message now
  follows `--`, and start says it was given only once it saw the session work
  on it (15 seconds' grace), else it warns. Pinned by a stub that parses the
  command as the CLI does.

## 0.18.7

- ⛔ BUYER LINES ARE CUSTOMER SERVICE'S. ERP's doorbell rang the buyers log
  (STALL, HELD, first-reply, cs-* USAGE-LIMIT: a customer-service desk's
  lead-alerts.log) and held buyer drafts, and it pushed the owner on them.
  0.18.0 routed alert-log lines by subject but left the bell's files and asks
  office-wide. Now a `lead.bell.files` entry is the department of the desk whose
  folder holds it (in `desks/` or a department's folder), and a file or ask may
  name one with `"department"`. Only that department's lead hears it; an
  undeclared department is the office's, heard by all, never lost. No
  departments: one bell hears everything, as before.
  - ⛔ judged where the file REALLY is (commit security review). A log that is
    a link into another desk is refused, and ownership is read from the real
    path every poll. A moved desk's old desks/<id> link lands in the same desk
    and is allowed.

## 0.18.6

- ⛔ NO OFFICE INSIDE A DESK (security review of local-cabinets-ops' desk
  move). An office hook command written as `${CLAUDE_PROJECT_DIR%%/departments/*}/desks/hooks/…`
  strips nothing for a desk started through its old desks/<id> link, so it ran
  `<desk>/desks/hooks/…`: a file the desk itself could write. The plugin's wall
  now refuses, by Write and by Bash, a desks/ or departments/ folder or an
  office.json inside a desk's own folder. The office's own hooks are fixed in
  local-cabinets-ops: the root is taken from either layout, an unknown one runs
  nothing, and write-wall refuses the same shapes and checks where it runs from.

## 0.18.5

- ⛔ A SESSION WITH A DOORBELL ARMS IT WITHOUT ANYBODY TYPING. The watchdog
  started ERP (2026-10-23) with no first message; it sat idle with its bell
  unarmed, deaf to 71 open messages, until the lead messaged it.
  - start gives a lead or desk with a `wake` its kickoff as the first message:
    "Start your doorbell now: Monitor (timeout_ms 1800000) running `<wake>` …".
    Busy on it counts as up.
  - heal types the same line into a LEAD found unarmed, by the limit resume's
    rules: a fresh look (same pid, idle, no question open), its own tab, an
    empty prompt on screen. At most once per 30 minutes per lead.
  - health stays red ("doorbell unarmed") until the bell runs, pinned for a
    lead that has been up 10 minutes.

## 0.18.4

- ⛔ A ROLE IS RUNNING UNDER ANY OF ITS NAMES. `office aics` / `/role aics` looked
  for a session named AICS only; the live lead runs as "lead", an alias of AICS,
  so a second lead would have opened beside it. A department lead running under
  any of its names, in any folder, is that role running: it is brought forward.

## 0.18.3

- The lead's Bash list rewrite resolves the cwd through the disk first (security
  review of 0.18.2). A session standing in a moved desk's link (`desks/x`) climbs
  `../` from where the link points, as the kernel does.
- scripts/release-post.mjs (release tooling): an ops.mjs answer of "rejected"
  (exit 0) is a refused post, not a posted one, and no idempotency key is used,
  so a rejection is never handed back after the forum is configured.

## 0.18.2

- READY FOR THE DESK MOVE (the lead, 10-23: local-cabinets-ops moves its desks
  into department folders today).
- A move's 7-day symlink `desks/x -> departments/<dept>/x` is one desk: the
  department's. `deskDir` prefers the real folder. Through the old link path,
  another desk's runtime/ is still not read.
- The lead's Bash list is matched by what a command RUNS, from any depth: a lead
  in departments/aics may run `node ../../scripts/x` against `^node scripts/x`,
  while a bare `node scripts/x` typed there is departments/aics/scripts/x and
  matches nothing. `wall.deny` is also tested root-relative, so a desk one level
  deeper meets the same anchored refusals. A word with `..` after a real folder
  name is never rewritten, because the shell follows a link before it walks `..`
  (security review).
- Boot text placeholders: `{up}` is the path from the session to the office root
  (`../../` in desks/, `../../../` in a department), and `{lead}` is its own lead's
  name (a desk's department lead; a lead's own name in `boot.lead`).
- ⛔ A ROLE BELOW THE ROOT KEEPS THE ROOT'S WALLS. A session in departments/aics
  does not load the root .claude/settings.json, so its profile's generated
  --settings now carries:
  - the root's hooks, run with CLAUDE_PROJECT_DIR set to the office root;
  - its permissions, with `/x` rules written absolute;
  - its enabledPlugins.

  `"rootSettings": false` opts out.

## 0.18.1

- RELEASE NOTES ARE POSTED BY THE RELEASE STEP (the owner, 2026-10-23: none had
  been posted since 0.9.0). The "Discord text" in each release report only ever
  went to the lead. Now:
  - `docs/releases.json` holds one note per version;
  - `scripts/release-post.mjs <version>` checks it against the forum verb's
    rules, makes sure the GitHub release exists, and posts it with ops verb
    发版本日志 (product office-anything) through ops.mjs as the lead;
  - a refusal exits non-zero; `--missing` posts the backlog and stops at the
    forum's daily cap.
  A test fails when the version being shipped has no note.
- Health: office.json `releases.posted` (a read-only command that prints posted
  versions) puts `⚠ no release note posted for office-anything <version>` in
  health's line while the loaded version has none. It is a warning, not red;
  the answer is cached 30 minutes.

## 0.18.0

- EACH LEAD HEARS ITS OWN. An alert belongs to its subject's department: a
  desk, a desk's case session, a lead's name or alias, a department's
  `sessions`, or `<subject>@<department>` said outright (`writeAlert({ department })`).
  Each department lead's bell rings for its own department's alerts and the
  office's, never another department's. With no departments, one bell hears all.
- Health's roll-call counts per department: `5/7 desks up (AICS 3/3, ERP 2/4)`.
  Each health row carries its department.
- The board labels each desk with its department.
- Usage-limit alerts carry the stuck session's department.
- Fix (0.17.0): `node lib/role.mjs install` threw EACCES on a /usr/local/bin it
  could not write. It now falls back to ~/.local/bin, prints the PATH line to
  add, and never needs sudo.

## 0.17.0

- ROLES (the owner, 10-22: "open a session at root, then choose who to become").
  A role is a NEW session with its own folder, `--name` and `--settings`. It is
  never a switch in place: CLAUDE.md, the deny list, claudeMdExcludes and the
  name are fixed at start.
- Roles come from office.json `"profiles"`:
  - a department's role is its lead in its folder (aics is AICS in
    departments/aics), shown only where .office/local.json names that department;
  - a builder's role takes its `construction` entry's name, model and root;
  - `.office/local.json` `"role"` is this machine's default.
- The settings file is generated at `~/.office/profiles/<office>/<role>.json`,
  never in the repo, and is rewritten from office.json on every launch. Rules use
  globs, not machine paths: `/x`, `//x` and `~/x` are refused, because a rule's
  `/x` is relative to that generated file.
- `office [role]` in a shell (`node lib/role.mjs install` puts it on PATH) starts
  the role in this terminal; with no role, the default, else a menu. `/role`
  inside a session asks which and opens it in a new Orca tab titled with the
  session name, else a tmux window, else a Terminal window.
- Never two sessions under one name: a running role (registry name and folder)
  is brought forward, and one running elsewhere is refused. A desk may not open
  a role.
- ⛔ No real window under a test: under node --test (or OFFICE_NO_LAUNCH=1) the
  real openers (an Orca tab, tmux, Terminal, `office` starting claude) refuse.
  The role tests also put recording stubs first on PATH. Found the hard way: a
  mutation run of an unreleased build opened Terminal windows on the owner's
  desktop.
- Orca first: when Orca is running but cannot open the tab there, /role says so
  and refuses. Terminal or tmux are used only when Orca is not running.
- The boot hook tells a root session with no role "dev/construction session;
  /role to switch", and a role session which role it is, plus its note. Only with
  "profiles"; every other boot is unchanged.

## 0.16.0

- DEPARTMENT FOLDERS (the owner, 10-22: "push the department restructure"). A
  department's desks may live in `departments/<dept>/<desk>/`, declared by
  office.json `departments.<id>.dir` (default `departments/<id>`).
- ONE OWNER FOR WHERE A DESK IS. lib/desk.mjs `deskRoots`, `officeRoster`,
  `deskDir`, `deskAt`, `hasDesks`. 87 sites built `desks/<id>` by hand; every one
  now goes through these, and a test fails on a new one.
- No desk moved = the roster is exactly `desks/` alone, pinned. An office with no
  `desks/` at all is still found, checked and healed.
- One id, one folder: a desk in two folders breaks both. A desk in the wrong
  department's folder is red in the `departments` check.
- The walls follow the desk:
  - the desk wall's runtime/ rules ask every desk root;
  - the send-wall gate judges the folder holding `runtime/send`;
  - an unreadable office.json still refuses a session standing in a department desk;
  - doorbell orphan proof and sandbox paths read the desk's real folder.
- A moved desk keeps its conversation: start finds it under the old
  `desks/<id>` project dir, copies it (never moves it) and resumes it.
- One schema, approved by the lead: `departments.<id>` gains `label`, `dir` and
  `sessions`, plus `construction: [{name, root, model, label, sessions}]` and
  `usage: {order, default}`. `usageGroupOf(cfg, {name, cwd})` is for the token
  page. A builder is not a lead.

## 0.15.1

- ⛔ A "departments" BLOCK THAT NAMES NO LEAD IS NO DEPARTMENTS. local-cabinets-ops
  #1472 put the token benchmark's `{order, default, groups}` under office.json
  "departments". 0.12–0.15 read that as departments on with none declared. This
  machine then ran no lead, the watchdog would not restart it, its doorbell went
  unwatched, and `wall.lead.open` stopped applying to it. Now a block where no
  entry names a "lead" reads as no block; health's tail and the departments check
  say why. Keys starting with "_" are notes and are skipped.

## 0.15.0

- USAGE-LIMIT RESUME (the owner, 10-22: "can you even push that to avoid this
  stuck again"). alibaba-98 hit its weekly limit at 2026-10-21 20:41Z ("resets
  Oct 27 at 1pm"); the account worked again at 22:57Z after a /login, and the
  session sat with 17 messages queued until it was clicked by hand at 13:57Z
  the next day. With `"limits"` in office.json, heal resumes a stuck session:
  - stuck = its transcript's last entry is the CLI's rate-limit banner (the
    registry says "busy"); the CLI's own "limit has reset, continue" is left alone
  - lifted = the reset passed (the CLI's epoch, else the banner text in its zone),
    or another session of the account answered for real after the banner
  - resumed at that moment plus a per-session jitter, by typing one line into its
    own tab (by name, a pinned title, or the only agent tab in its folder; a tmux
    pane only when it provably holds that claude). One try, one retry, per banner
  - the lead is rung once (USAGE-LIMIT): who, since, until, queued messages, what
    it was on, open tasks; again with "needs a person" after two tries; health red
  - the limit's own menu is answered only on "Stop and wait"; any other is refused;
    nothing is typed unless the screen reads and shows an empty prompt
  - a model's own limit on a desk switches it to `fallback` (sonnet) at once and
    back after the reset. Moving work to another session is not built: a session
    or weekly limit stops every session on the account.
- Health: `usage-limited: …` on the tail; `h.limits` for the board.
- `lib/start.mjs` orcaTerminal gains `all()` (every tab, any workspace) and `enter()`.

## 0.14.0

- WHAT COMPACTION KEEPS, manual or automatic, on the two documented paths (the
  owner: use the custom compact well). The docs were checked first:
  - A CLAUDE.md "Compact Instructions" section steers compaction. Its scope
    (manual, auto, both) is not stated.
  - A PreCompact hook can only block compaction, never add to it.
  - SessionStart "compact" output is added to the compacted context.
- `node lib/compact.mjs instructions <desk-id|lead>` prints the `## Compact
  Instructions` section to paste into CLAUDE.md. It is built from `compact.keep` /
  `compact.drop` (defaults: keep open buyers and promises, owner decisions, the
  current job and pointers; drop tool output, dumps and old diffs), plus the
  desk's `compactKeep` and the lead's `compact.leadKeep`.
- `compact.after: { lead, desk }`: a read-only command whose output (at most 40
  lines, 20 s) the boot hook prints only when a session restarts from a
  compaction. For the lead: the owed list, today's decisions, merged-but-not-
  deployed PRs and running workers. A failure prints a line saying "UNKNOWN".
  A desk id is never shell text. Every other boot is exactly as before.
- New check `compact-instructions`: a session the office compacts whose
  CLAUDE.md has no such section.

## 0.13.0

- IDLE COMPACT (the owner 2026-10-22: the 20x plan used up in days). With
  `"compact"` in office.json, heal types `/compact <focus>` into a desk or lead
  that is idle at its prompt for `idleMin` (30) with a context above `aboveK`
  (150K), at most once per `everyMin` (120). Per desk: `compactIdleMin`,
  `compactAboveK`, `compactFocus`, `"compact": false`. `compact.lead: false`
  leaves the lead out. **Off unless office.json says "compact".**
- Never mid-turn and never into a dialog. The registry must say idle, and no
  tool call can be waiting for an answer. Heal looks again just before it types:
  same pid, same status stamp, exactly one tab with that title.
- The focus is at most 300 characters and holds pointers: the office's line, the
  desk's line and the open task ids. orca types at human speed.
- Health: `fat contexts: <session> <K>, …` names every live office session at or
  above `aboveK`, fattest first, including case sessions and buyer teammates
  (shown only; only desks and leads are compacted).
- Not done, on purpose: compacting "before a new request" from a hook. A hook
  cannot run /compact; it could only refuse the message.
- The compact window itself is office.json `context.capTokens` / `lead`
  (unchanged). It applies when a session restarts.

## 0.12.1

- `desks.mjs departments set <id> …` WORKS BEFORE office.json HAS A BLOCK. The
  cutover is set every machine, then add the block, and 0.12.0 refused the first
  step ("declares no departments: there is nothing to set"; the lead, at the
  cutover). Without a block the ids are written as asked (department-id shaped)
  and nothing changes; once the block arrives, an id it does not declare is an
  error and starts are refused until it is fixed.
- `desks.mjs department <id>` answers from an explicit setting before the block
  exists too, so the owner's buyer machinery keeps starting through the cutover.

## 0.12.0

> ## ⛔ BEFORE YOU ADD A `departments` BLOCK TO office.json
> ## run this on the owner's Mac FIRST:
> ## `node lib/desks.mjs departments set local-ops customer-service`
> A machine with a block and no setting starts and heals **no department lead**
> (health says so in red). The office's own buyer machinery is meant to check
> `node lib/desks.mjs department customer-service` before it starts (ops' side),
> so it too needs the setting. Set every machine, then add the block.

- DEPARTMENTS, A LEAD PER DEPARTMENT (the owner 2026-10-21; spec
  docs/superpowers/specs/2026-10-21-departments-design.md in the office repo).
  office.json `departments.<id>` gives `lead`, `aliases`, `desks` (ids),
  `instructions`, `wake`, `start`, `open`, `bash`, `sweepsLease` and `services`.
  Each machine names its own in `.office/local.json` `"departments"`.
  **No block: nothing changes.**
- Two resolvers. Identity (who is a lead) asks every lead the office declares.
  Lifecycle (start, heal, health's lead rows) asks only the departments this
  machine runs, so AICS is never started on a Local Ops machine, even by name.
- A desk of a department this machine does not run is OUTSIDE, not off: not
  started, watched, swept, alerted on, listed on the board or messaged here.
  `desks.mjs on|off` refuses it. A desk in no department is everyone's.
- The wall: a desk reaches its own department's lead (any lead, in none), and
  leads reach each other. Desks on one machine still talk across departments.
  `wall.lead.open` lifts only a department with `"open": true`. ERP stays walled.
- Heal restarts each lead on its own key and budget (`lead:<name>`), by its own
  name. A department lead never inherits `lead.start` (it starts the session "lead").
- The lead bell keeps one state file per lead with departments, so ERP and AICS
  on one machine do not consume each other's lines. Both still hear every alert:
  routing alerts by department is not in 0.12.0.
- A half-written block does not weaken the wall: a department with a bad id is
  still read, and the old `lead.session` stays a (walled) lead by name.
- The board's lead row is the `open` department's lead (the owner's own) on a
  machine that runs one, else this machine's first lead.
- Boot tells a department lead who it is, its desks and its instructions file,
  and lists to a desk only the desks this machine runs.
- Health: red for a machine naming no department, a broken setting, a
  department's `services` running where it is not named, and a sweeps lease held
  elsewhere. UNKNOWN when the lease command cannot answer.
- CLI: `desks.mjs departments [set <id> … | sweeps on|off]`, and
  `desks.mjs department <id>`, which exits 0 only on an explicit setting.
- New check `departments`: a desk in two departments, a lead name in two, a
  missing desk, a missing instructions file or a pattern that does not compile.

## 0.11.0

- A DESK'S ID IS ITS FOLDER, ITS NAME IS ONE FIELD (the owner 2026-10-21: config in
  one place, nothing hard-codes a name). Renaming a desk is one edit to `"name"` in
  `desks/<id>/desk.json`. Before, it took ten minutes and "a ton of testing" and
  still did not work, because the name had been copied into every place below.
- Keyed by the id, so a rename touches none of them: `office.json`
  `closeWhenIdle`, `.office/local.json`, case claims and briefs, idle, heal and
  alert state, and the desk's own conversation (keyed by its folder).
- The session is `desk-<name>`. start, the case sweep (`desk-<name>--<key>`),
  health, heal, desk-watch, the board and the wall all read the name from
  desk.json when they run. `/desk-start`, `desks.mjs on|off` and `cases.mjs`
  take either the id or the name.
- RENAMED WHILE RUNNING: a session still under the old name (the id) is alive and
  "renamed", never dead, so no second desk opens beside it. Heal closes it once it
  is idle, never mid-work, and starts it under the new name, resuming its own
  conversation. A message to the old name is refused with the new one.
- Boot prints the other desks under their names now (`boot.text.roster`; `""`
  turns it off), so a desk learns who to message from boot, not from copied text.
- desk.json may carry `"id"`: if it does, it must equal the folder. A name equal to
  another desk's name or id makes both unreadable (`desk-readable` names them):
  `desk-<x>` must name one folder. hire refuses such a name.
- RETIRED: "desk.json and its folder must agree on the name". It is now "agree on
  the id" (tests/robustness.test.mjs). tests/desk-id.test.mjs drives every path
  through a desk whose folder is not its name.

## 0.10.11

- The lead audit log also redacts QUOTED credential values (`--password "a b"`,
  `--token='x'`, `-u 'user:pw'`) and `-p<password>` (database CLIs). Found by the
  security review of 0.10.10.

## 0.10.10

- `wall.lead.open: true` LIFTS THE LEAD'S WALL (#58, the owner 2026-10-20: "the lead
  should be able to do everything when needed, like me"). Every lead tool call is
  allowed, by the core and by the office's module, and is written to
  `.office/lead-audit.log` (one JSON line: time, tool, command or path). Desks keep
  their walls. Only the literal `true` opens it, and only for the lead named in
  `lead.session` / `lead.aliases`: a desk folder whose desk.json says `kind: "lead"` is
  not the lead, and a desk can no longer rewrite its own desk.json (#59). The audit
  log redacts credential-shaped values (headers, flags, JSON fields, URL passwords,
  known token prefixes), and desks cannot read it.
- A SECRETS FLOOR NO OFFICE CAN UNLIST, matched on the command as typed and as the
  shell reads it (quotes removed): `.env`, `.dev.vars`, `.ssh`, `.netrc`, `.pem`,
  `id_*` keys, `.token`, `credentials.json`, `.claude.json`, `.claude/channels`,
  `/etc/lco`. For a walled lead the floor also covers `~/.claude` (except plugins,
  uploads and memory), `..` after `.claude/`, and token files.
- A WALLED LEAD'S CHAINED PARTS ARE JUDGED AS THE SHELL READS THEM (alibaba-98's W30).
  These are never run, whatever the list says: git `--no-index`, `--upload-pack`,
  `--output`, `--exec` and their abbreviations (`--upl`), `ext::` and `fd::`
  remotes; grep recursion (`-r`, `'-r'`, `-d recurse`) and `-f`; `gh --web`; jq
  `-f`, `-L`, `--rawfile` and env; `git -c`/`-C` anywhere; a `VAR=` in front of a
  command; and unquoted globs (`* ? [ {`) except for `ls`. `2>&1` must stand alone.

## 0.10.9

- THE LEAD CHAINS LISTED COMMANDS (#56, the owner 2026-10-20: "let the lead do things
  as needed"). The lead's Bash may join commands with `&&`, `;` and `|`, and add
  `2>&1`, when every part is itself a `wall.lead.bash` command. Still refused: `>` and
  `>>` (writes), backticks, `$(` and `<(`, `<<`, a lone `&`, `||`, newlines, and `"…"`
  that expands. Secret files, the locked token and role variables, and starting
  claude or orca from Bash stay walled.
- A case reopened after a close no longer carries its old close reason in
  `.office/cases.json`.

## 0.10.8

- THE LEAD BELL'S FILES, HARDENED (alibaba-98's review of local-cabinets-ops #1257).
  - A `lead.bell.files` match that repeats a repeating group (`(a+)+$` hung node on 31
    characters) is refused at load.
  - Only a line's first 2,000 characters are tested.
  - The path's REAL location must be a `.log` under `desks/`, through no hidden name, so a
    symlink called x.log cannot tail another file.
  - A refused entry is said once and not watched.

## 0.10.7

- THE LEAD'S DOORBELL (the lead, 2026-10-20). In bypass mode the lead held outside messages, so
  escalations came back "nudged:false" and a buyer waited an hour. `lib/lead-bell.mjs`, armed by
  `lead.wake: "node {plugin}/lib/lead-bell.mjs"`, prints one line per new item:
  - listed alert types;
  - matching lines in office-named logs (`lead.bell.files`);
  - open items from office-named read-only asks (`lead.bell.asks`).

  It de-duplicates, repeats while an item is open, is rate-limited and restart-safe. `{plugin}`
  works in `lead.wake` (boot text and health).
- ⛔ MONITOR WAS OUTSIDE THE WALL: a Monitor command ran unjudged for desks and the lead. It is in
  the hook's matcher now. A session's own doorbell runs; anything else is judged as Bash, plus
  `wall.lead.monitor` for the lead. Install note: a lead whose Monitors are not its `lead.wake`, its
  `lead.bash` or `wall.lead.monitor` will see them refused.

## 0.10.6

- A CASE SESSION THAT REGISTERED AND IS BUSY IS UP (#50, found on the live rfq test,
  2026-10-19). A case session starts with its brief as its prompt, so it is usually
  working before `launch.waitSec` runs out. `openCase` read that "busy" as "did not
  come up", released the claim and left the session running. The next heartbeat
  would then have reported the claim lost and closed the session mid-draft. Busy now
  counts as up: the claim is kept and `openedAt` is recorded.
- `desks.mjs on <desk>` for a per-case desk says its cases open on the next case
  sweep. It used to say "start it with /desk-start", which is the wrong action for a
  per-case desk.

## 0.10.5

- A DESK TAKEN OUT OF `closeWhenIdle` WHILE IDLED IS WOKEN (#48, the lead, 2026-10-19).
  inventory was removed from the list while closed, nothing named it, and it stayed
  closed until a person started it. Heal now wakes it on its next run.
- Note from the first live hour of 0.10.4: a woken desk starts with
  `office.json` `launch.model` (or its desk.json `model`). Without one it runs on the
  account default, so set `"launch": { "model": "sonnet" }` if your desks run Sonnet.

## 0.10.4

- STANDING DESKS CLOSE WHEN IDLE AND WAKE ON WORK (#46, the lead's ruling 2026-10-19).
  `office.json` `"closeWhenIdle": { "<desk>": minutes | true }` (true = 30). An unlisted
  desk is never closed. A listed desk is closed when it is idle (or parked in its own
  doorbell) past its minutes, has made no tool call in 5 min, and nothing is waiting:
  no `openWork` line names `desk-<name>` and it has no open task assigned to it. Heal
  re-proves it fresh, stops that pid, closes its tab and marks `.office/idled.json`.
  Health then shows it as `idled`, not dead: the office is not red, desk-watch does not
  report it, and `start all` and `--recover` leave it closed. Name it to start it.
  When work names it, heal's restart wakes it on its own budget: no heal spent, no
  "down" alert.
  - ⛔ A closed desk hears only `openWork`. With no `openWork`, or an `openWork` that
    fails, nothing is closed, and a closed desk is woken.
  - ⛔ The mark never hides a crash: once the desk's own conversation writes after it,
    a dead desk is a crash again.
  - Upgrade: add `"openWork"` (local-cabinets-ops: `node scripts/desk/desk-work.mjs
    --all --dry`, timeoutSec 60) and `"closeWhenIdle"` to `office.json`.
- A TAB WHOSE CLAUDE EXITED IS NOT A RUNNING DESK (#45). Every idle-closed case left
  its orca tab behind at a shell prompt, and `start` read such a tab as "already open"
  and started nothing. That made a restart of any desk whose tab lingered a silent
  no-op. `start` now closes a tab with no agent and opens afresh, and closing a case
  closes its tab.

## 0.10.3

- A DESK READS A PDF THE OWNER UPLOADED (#41, owner 2026-10-19). `~/.claude/uploads`
  opens for `.pdf` as it does for images. It is read-only and widened by file type
  only: nothing there is written, edited or searched, no other file type opens, and
  a `.pdf` elsewhere in `~/.claude` stays closed. A local patch to `lib/wall.mjs`
  for this can be dropped.
- ONE CASE, ONE SESSION, ENFORCED (#39). When two live sessions carry one case name,
  the `/desk-case` sweep keeps the most recently active and stops the others by their
  own registered pid, never by name. The claim stays. Act: `duplicate-close`.
- `SESSION-DUPLICATE` (#40). Health flags every name the office owns that two live
  sessions carry: `desk-<name>`, `desk-<name>--<key>`, or a `wall.aliasNames` match
  such as `cs-…`. It names the pid to keep and the pid to close, and the office goes
  red. It reads only. The lead's names stay `LEAD-DUPLICATE`'s.
- A DOORBELL IS IDLE (#42). A case session parked in a foreground doorbell reads
  `shell` in the registry, never `idle`, so it was never idle-closed. It counts as
  idle now when the process tree proves the shell is the desk's own `wake`. Its clock
  is the transcript's last work (a prompt, or a tool call that is not the doorbell).
  Any other command in the shell is work.
- CLOCK A, THE BOOK'S (#43). The per-case adapter's heartbeat answer may carry
  `idle: [{ key, since }]` (optional, backward compatible). `since` is ISO, or
  `null` when something is owed, which keeps the session open. Core closes by the
  later of the book's clock and its own. local-cabinets-ops sends it since #1168.
- TESTS (#38): the heal lock race and health ARMED waited a fixed time and went red
  on a loaded machine. They wait for the event now.
- Not in this release: the lead operator mode (office-anything-dd's work) is
  separate. Standing desks that close when idle and wake on work are next.

## 0.10.2

- THE QUEUE ON THE BOARD: a read-only Tasks panel (`/api/tasks`, `/api/task-evidence`)
  from the same fold as the lead's list: by assignee, with state counts, age, due,
  OVERDUE and quiet marks, the owner's words, notes and evidence. Evidence is read only
  from what a task recorded; a file must be inside the office and not a secret. The
  built UI (`board/ui/dist`) is rebuilt; not exercised in a browser here beyond the
  server tests.

## 0.10.1

- THE OFFICE-WIDE QUEUE (owner, 2026-10-18: "I do not know which of the things
  we are doing are being worked on and which are not"). Builds on the lead's
  task list (0.10.0).
  - `list --assigned <name> | --overdue | --owner`, combinable with `--all`/`--json`.
  - The SessionStart hook shows a desk or a dev session only the tasks
    assigned to its name (and the commands it may use); nothing when it has
    none. A session identified by its registry name can update its own tasks
    and add one for the lead, never verify or drop.
  - `.office/digest.md`, once a day from 08:00, written by the watchdog's
    heal; the first section is plain text under 1,800 characters.
  - A NUDGE line in the lead's alerts, once a day, for an assignee quiet 24 h.
  - Not yet: the board panel (next release).
  - Upgrade: nothing to add. A `wall.lead.bash` entry for `tasks.mjs` should
    include `digest` in its verb list.

## 0.10.0

- THE LEAD'S PERSISTENT TASK LIST (owner request, 2026-10-18; two buyers had
  been found unanswered by the owner himself after a context summary dropped
  the lead's list).
  - `.office/tasks.jsonl`, append-only events folded on read, and
    `node lib/tasks.mjs add|update|verify|drop|list [--json]`. `verify` needs
    evidence and a one-line proof; `drop` needs a reason; verified and
    dropped are final. A desk adds tasks and works its own, never verifies.
  - `hooks/tasks-boot.mjs` (SessionStart: start, resume, clear, compact)
    prints the lead's open tasks into its context; `/desk-recover` shows them.
  - Health is red for a task open 24 h with no update or done-not-verified 6 h;
    `health --heal` writes it to the lead's alerts.
  - `wall.lead.bash` entries may use `{plugin}`: this plugin's own folder,
    once, right after `node`, one real file in it. A daily snapshot of the
    file is kept in `.office/tasks-snapshots/` (14 days).
  - Upgrade: new keys none; the feature is inert until something is added.
    Add the one anchored `wall.lead.bash` entry (README) so the lead can use it.

## 0.9.9

- SELF-HEALING IN THE CORE (lead's request, owner approved 2026-10-18).
  - `office.json` `"watchdog": true` (or `watchdog.install: true`): `/desk-start
    lead`, `everything`, `/desk-recover` and `health --heal` install the
    LaunchAgent or verify it is loaded, idempotently. Plain `health` reports
    `watchdog not installed` as a red finding with the one command (paths
    quoted). The object form `{ maxHealsPerHour, notify }` alone still installs
    nothing.
  - The watchdog restarts the lead when no session answers to `lead.session` or
    `lead.aliases`, through `lead.start` or the plugin's own start, 3 an hour,
    never while one is still registering, and never when the lead runs under
    another name, its registry entry is unreadable or two are alive.
    `watchdog.restartLead: false` opts out. Acts go to `heal.log`, failures and
    the cap to the lead's `alerts.log`.
  - A desk that stays down: health says how long (`down 7m`) from
    `.office/heal-state.json`, and after 5 minutes the lead is told whatever the
    restart did. (A dead desk was already red at once; what was silent was
    nobody being told.)
  - Upgrade: every new key is optional and defaults to today's behaviour.
    Without `"watchdog": true` nothing is installed or checked.

## 0.9.8

- THE LEAD, TIGHTER (the lead's audit of 0.9.7, 2026-10-18).
  - `LEAD-DUPLICATE` (#28): two live sessions under `lead.session` and
    `lead.aliases` are one finding naming both pids, the one to keep (most
    recently active) and the one to close. Health shows it as "duplicate
    lead" and the office goes red; `/desk-start lead` and `/desk-recover`
    report `clash` with the same advice and open nothing.
  - `wall.lead.bash` entries must be anchored (#31). An entry that does not
    start with `^` (or has a top-level `|` alternative that does not) also
    matched inside a longer command, so `node scripts/dev/x\.mjs add` let the
    lead run `rm -rf y node scripts/dev/x.mjs add`. Such an entry is dropped
    (a throw would switch the wall off in an office that does not fail
    closed), named in the lead's refusal and reported by
    `checks/desk-wall.mjs`. An entry that names a script (`node|python3|bash|sh
    <path>`) must write the whole path, relative to the office root, with no
    `..`, to a real file inside the root. A closing `$` is advised, not
    required, so existing entries keep working.
  - README (#32): what `Held peer message … crossSessionInbound` means (a
    session holds a message from a session in another permission mode until
    its own user approves it; an unapproved hold expires, undelivered and not
    retried), and that the lead is launched with every flag the desks get.
- PINNED (#29): `? * [` inside quotes in a draft's JSON is text, not a glob
  across the other desks. Fixed since 0.9.2; an office still on 0.9.0 is
  refused for it.
- FIXED (#28): `.githooks/pre-commit` unsets `GIT_DIR`, `GIT_INDEX_FILE`,
  `GIT_WORK_TREE` and `GIT_PREFIX` before the suite. A hook run from a linked
  worktree carries them, so the suite's fixture `git` calls ran in the real
  repo: junk commits, and `core.bare=true` plus `user.name=x` written to the
  shared `.git/config`.
- UPGRADE FROM 0.9.0 / 0.9.7: every new key defaults to today's behaviour, and
  nothing needs adding to `office.json`. Restart every session (hooks are read
  at session start). A `wall.lead.bash` entry that is not start-anchored stops
  matching; `node checks/run.mjs` names it. An office on 0.9.0 gains
  `wall.lead.devSessions`, `lead.aliases` and the quote-aware lead Bash only
  from 0.9.7; a lead that is not in the desks' permission mode has its peer
  messages held (set `launch.flags`, restart the lead).

## 0.9.7

- THE LEAD AND DEVELOPERS (owner's request, 2026-10-18).
  - `wall.lead.devSessions`: the lead (only) may message those developer
    sessions, by name or glob. Nothing else is widened.
  - `lead.aliases` in `/desk-start lead` and `--recover`: a live session
    under any lead name is the lead, so a second one is never opened (a
    duplicate lead was opened on 10-18); two of them are a clash.
  - `wall.lead.bash`: quoted text no longer reads as chaining, so one
    listed command (e.g. a decision log) takes free text. Expansions,
    backslashes and unclosed quotes are still refused.
  - Pinned: a lead started by the office carries every desk launch flag,
    so a bypass desk does not hold its messages.

- THE LEAD, REACHABLE (the lead's findings of 2026-10-16). `lib/lead-reach.mjs`:
  desk-watch and health flag LEAD-UNREACHABLE when the lead runs under a name
  office.json does not give it, its registry entry froze while it kept
  working, or the entry is not valid JSON (the 2026-10-16 cause: a stray
  `}`; Claude Code skips such an entry, so no peer listed the lead), with the exact command to resume it under its office name. The
  registry is only read.
  - `desk-watch.mjs seen <desk> "<text>"`: not seen / delivered / read / answered.
  - `office.json` `lead.wake`: the lead's doorbell, armed by its boot text,
    reported by health when unarmed.
  - The wall: `wall.messageFallback` is printed with a refused SendMessage;
    a socket address gets its own refusal; a Bash write outside the desk
    names the desk's folder and the refused path.

## 0.9.6

- WHICH DESKS RUN ON THIS MACHINE: `lib/desks.mjs` and `/desk-onoff`.
  `.office/local.json` `{ "desks": { "default", "enabled": {name: bool} } }`,
  never committed. Start (all, everything, by name), health (off, not
  dead, so no watchdog restart), the boot hook (no doorbell), desk-watch and
  the case sweep (no new claims) all ask one function. Off closes and
  releases nothing; an off desk that still holds or is owed cases raises
  DESK-OFF for the lead; `office.json` `"openWork"` (a read-only command)
  adds the office's own promises, one per line naming `desk-<name>`. An
  unreadable file stops starts. No file: all on.

- The context cap: `office.json` `context` (`capTokens`, `lead`, `teammates`,
  `perDesk`). Each session the office starts is launched with
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW=<cap>`, so it compacts there, not at the
  model's 1M. Verified on 2.1.289: `/context` reads `/ 700k`; a project
  settings file asking for more did not override it. Rollback: remove the
  key, restart the desk. DESK-CONTEXT now warns at 75% of a session's cap.
- `lib/desk-watch.mjs`: are the desks working, and not troublesome? From the
  session registry, transcripts, desk.json and the alert log, with no model,
  it flags DESK-DEAD, DESK-STUCK (dialog open, busy but silent, unanswered
  message), DESK-LOOP (repeated call, error/refusal streak), DESK-NOISY,
  DESK-CONTEXT and DESK-TROUBLE (the office's own checks). It prints nothing
  when healthy. `--alert` writes typed lines once per cause, every 30 min,
  then DESK-RESOLVED. It never kills or sends; it prints nudges for the lead.

## 0.9.5

- THE NATIVE BASH SANDBOX, PER DESK: the guarantee under the string wall.
  `desk.json` `"sandbox": true` opts a desk in. `lib/start.mjs` (and a case
  session of that desk) then launches it with
  `--settings .office/sandbox/<desk>.json`, generated by `lib/sandbox.mjs`.
  The desk's own `.claude/settings.json` is never edited.
  - Settings: `allowUnsandboxedCommands: false`, `failIfUnavailable: true`,
    and `network.strictAllowlist: true`.
  - Writes: only the desk's folder and `/tmp`.
  - Reads: denied for every other desk's `runtime/`, a shared
    `desks/runtime/`, the office's `.env` / `.dev.vars` and Claude Code's own
    folder, except the desk's own `projects/<folder>/` tree and `skills/`.
  - Hosts: `localhost`, `127.0.0.1`, plus `office.json` `sandbox.hosts` and
    `desk.json` `hosts`.
  - Native primitive: Claude Code's sandbox (Seatbelt on macOS) for Bash,
    Monitor and every process they start. The Read, Write and Edit tools are
    outside it; the desk wall still judges those.
  - Rollback, one desk: `node lib/sandbox.mjs off <desk>`, then close its
    tab and `/desk-start <desk>`. `show <desk>` prints the settings.
  - A sandboxed desk's boot text says what "Operation not permitted" means,
    so it does not retry.
- VERIFIED IN A SCRATCH OFFICE on Claude Code 2.1.289:
  - The escape hatch is real by default: a blocked command was retried with
    `dangerouslyDisableSandbox` and wrote outside the desk. Passed false on
    the command line, the retry is blocked, and a desk's own settings file
    could not turn it back on.
  - Child processes are blocked: `node -e` and `python -c` writing out, or
    reading another desk's token.
  - With `allowedDomains` alone, `curl https://example.com` got through the
    proxy (200) while `node fetch` was blocked. `strictAllowlist` closes it,
    and it is always on.
- ⛔ AN OFFICE MUST NOT LIVE UNDER THE SESSION'S TEMP FOLDER. A sandboxed
  session may always write its own TMPDIR, so an office inside it would be
  writable by every sandboxed desk. Generating a sandbox for such an office
  is refused.
- `lib/usage.mjs`: where the tokens went, from Claude Code's own transcripts,
  with no model. Each call is counted once (message.id + requestId). It
  reports by session folder (lead / desk / subagent), by model and by day,
  including the average context per call. It warns about a still-working
  session over 300K context per call, and about Opus subagents over 20% of
  calls (`office.json` `usage`).
- `lib/sweep.mjs`: the lead's periodic check, with no model. It runs the
  `office.json` `sweep.checks` commands (`parse`: lines / json / exit) and
  prints only items that are new, or still there after `repeatHours` (3 h).
  It prints nothing when quiet. A check that cannot run is reported, not
  silent. State: `.office/sweep-state.json`.

## 0.9.4

- ⛔ HEREDOCS ARE FOUND IN THE WHOLE COMMAND, NOT LINE BY LINE (security
  review of 0.9.3). Reading one line at a time lost a quote opened on the
  line before, so `echo "a` / `<<X"` / `cat ../other/runtime/token.json` / `X`
  hid the `cat` from the wall; so did a `<<` in a comment, after a `\`
  continuation, or inside `$(( ))`. One scanner now carries quotes, `$( )`,
  backticks, `(( ))` and comments across newlines, and a `<<` counts only in
  plain command context. When anything is unclear (a continuation, a newline
  inside a quote while a heredoc waits, a body never closed, an unclosed
  context) nothing is stripped and the whole text is judged.

## 0.9.3

These are what still stood between the wall and replacing local-cabinets-ops'
own, from its replay of 7,353 real desk calls. Each has a test that was red
first (`tests/wall-adopt2.test.mjs`).

- `/dev/null`, `/dev/stdout`, `/dev/stderr`, `/dev/tty` and `/dev/fd/N` are
  not writes outside the desk. `2>/dev/null` refused 45 real commands, about
  0.9% of desk Bash.
- REDIRECTIONS ARE READ FROM SHELL WORDS, so quoted code is never one.
  `node -e "x.filter(a => a >/^SC-/.test(a))"` was refused as a write to
  `/^SC-/…`.
  - The tokenizer keeps `2>&1`, `>&2`, `&>`, `>|` and `<>` whole, and splits
    `x>file` as bash does.
  - Glued operators (`2>&1>file`) are separate redirections.
  - `<>` (read and write) is a write.
- A recursive command may name another desk's existing FILE (its
  `facts.md`). Its folder, its `runtime/`, or anything holding one, is still
  refused.
- zsh's `${(e)…}` and `${(P)…}` evaluate, so they are refused like `eval` and
  `${!x}`.
- CLAUDE CODE'S OWN FOLDER (`~/.claude`, the account's home's `.claude`,
  and `CLAUDE_CONFIG_DIR`, all three) is closed to a desk: session keys,
  settings, channels, other sessions' transcripts. Read, Grep, Glob and Bash
  all respect it.
  - The desk's OWN `projects/<its folder>/` tree stays readable (Claude Code
    saves big tool output there and tells the session to Read it, alongside
    its memory and transcript). So does `skills/`.
  - Every spelling is judged: `~`, `~user` (from the user database), `$HOME`,
    `${HOME}`, a variable set in the same command (`H=$HOME; cat $H/…`), and
    a literal `~` in a Read path. An unknown variable leading into a
    `.claude` folder cannot be judged, so it is refused.
- A write or read inside `$(…)` or backticks is judged like any other
  command. The first 0.9.3 commits missed `echo $(echo x > ../../lib/x)`.
- A `)` inside quoted code inside `$(…)` no longer ends the substitution:
  67 false refusals (about 1.3% of desk Bash).
- The Grep tool may read another desk's single facts file, as Bash may.
- `sed -i` is parsed as sed reads its options: its script (`'/^import/d'`,
  `'s#/a#/b#'`, `-e…` attached, `--expression=…`, `-f`, `--file`) is a
  script, and every other plain word is a file it writes, `--in-place`
  included.
- A write target given as an option is judged: `cp -t../../lib`,
  `mv --target-directory=…`.
- A WRAPPER DOES NOT CHANGE WHAT RUNS. Only the first word of a command was
  looked at, so these were never judged as writes: `nohup cp`,
  `timeout 5 tee`, `xargs cp -t`, `env FOO=1 cp`, `/bin/cp`, `\cp` and
  `"cp"`. One parser now strips assignments and wrappers, with their own
  option arguments: env, nohup, command, builtin, exec, time, nice, timeout,
  stdbuf, sudo, doas, xargs and busybox. The write checks and the read scan
  both use it. `env -C` and `sudo -D` (which run the command in another
  folder) count as a cd.
- HIDDEN COMMANDS ARE JUDGED, OR REFUSED.
  - The script in `sh -c '…'` (and `bash -lc`, `xargs sh -c`) is judged as a
    command line, like `$(…)`.
  - The command `find` runs with `-exec`, `-execdir`, `-ok` or `-okdir` is
    judged as its own segment.
  - A shell that reads its script from a pipe or a heredoc (`bash <<EOF`,
    `… | sh`, `bash -s`) is refused, because the wall cannot see the script.
- An input redirection is a read: `cat <../other/runtime/token.json` and
  `$(<file)` are judged like `cat file`.
- Heredoc bodies are data for the read scan too: `python3 - <<'EOF'` with a
  helper named `sh(…)`, or a file written whose first line is `#!/bin/sh`,
  is not a shell reading a hidden script. `bash <<'EOF'` still is.
- `~/.claude/uploads/` is readable for an image file only (the photos the
  owner sends a desk); any other file there, and a search of the folder,
  stay closed.
- ⛔ A heredoc is what the shell calls one: a quoted `"<<X"` no longer hides
  the lines after it from the wall (the tokenizer finds `<<`, not a regex).
- A root Glob whose pattern climbs back (`..`, a brace) is judged as a search
  of the root.
- A Glob anchored above `desks/` whose fixed prefix stays out of it
  (`lib/**/*.ts` from the repo root) is allowed.
- A command line holding more nested commands than the wall reads (256) is
  refused. Past the cap, a text used to be kept while its own substitutions
  were never opened.
- Writers the list never knew are judged too: `dd of=`, `truncate`,
  `install`, and `perl`/`ruby -i`. A program that opens a file itself
  (`python -c`, `node -e`, `awk -i inplace`) is still beyond a string wall;
  the native sandbox is the guarantee for it.
- A command nested more than 64 levels deep (or over 200,000 characters) is
  refused before it is parsed. 30,000 nested `${` took 6.6 s.

## 0.9.2

- AN OFFICE HOLDS ITS PLUGIN VERSION, ALERT FIRST. On 2026-10-10 Claude Code's
  background auto-update installed a new wall onto a live office five minutes
  after a merge, and nothing said so.
  - `office.json` `"plugin": { "approved": [...], "enforce": false }`.
  - A session that loads an unapproved version is told so at start (the
    SessionStart hook). The lead gets one typed line per version per 6 h in
    the office's alert log: `<ISO> VERSION - office-anything loaded X,
    approved Y`.
  - `enforce: true` also refuses desk sessions on an unapproved version. It
    is opt-in: with background updates, a fail-closed default would stop
    every desk silently.
- TYPED ALERT LINES (`lib/alerts.mjs`): `<ISO> <TYPE> <case|-> <subject>
  <text>`, written to `office.json` `alerts.file` (inside the office;
  default `.office/alerts.log`), rotated at 512 KB, with a quiet key so one
  condition does not write a line on every session start. VERSION is the
  first type.
- `/desk-status` (`lib/status.mjs`): loaded vs approved vs the latest GitHub
  release. A release that cannot be fetched is "unknown", never "up to
  date". Exit 4 when the loaded version is not approved.
## 0.9.1

Five false refusals were found by replaying 5,000 real desk commands from
local-cabinets-ops: 7 commands their own wall allowed and this one refused.
Each shape is pinned as allowed in `tests/wall-replay.test.mjs`, red before
the fix, beside the attack it must still refuse.

- `IFS='|' read a b <<< "$x"`: a redirection ends the variable names, so the
  here-string is data, not a name built at run time.
- After a `cd`, a path is resolved from where the shell stands. It used to be
  resolved from every folder the command passed through, so `../from-buyer`
  read from the desk folder looked like another desk.
- A quoted grep pattern is a pattern, never a glob: `cd ../.. && grep -rn
  "price.*total" lib` was a glob over every desk. Bash words are now split
  as bash splits them, quotes included. A recursive command's operands are
  all checked as paths, so a bare `desks` is caught too; grep's and rg's
  pattern is skipped.
- A symlink inside a desk's own folder (a shared skill folder) is the desk's
  own to search. It is refused only when its real target is, or holds, a
  `runtime/`: another desk's whole folder still is.
- The new tokenizer was attacked before release, and these all still
  refuse:
  - a partly quoted glob (`"../other"/run*/*`), because the shell expands its
    unquoted part;
  - brace expansion (`../other/{runtime,x}/…`);
  - `$'…'` quoting, decoded as bash decodes it (`$'..\x2fother/runtime/t'`);
  - `$(…)`, backticks and `$VAR` inside a path, even within double quotes;
    their fixed prefix may not point at another desk;
  - `popd`, `cd -` and a bare `cd`: the shell's folder can't be followed,
    so every folder seen so far counts.
  `cat "$f"` in a loop over the desk's own files, and `cat "$HOME/…"`, still
  pass.
- The office module's deadline is 5 s by default (2 s missed about 1 call in
  1,000 at load 25 to 30). An office may set `wall.moduleTimeoutMs`, capped
  at 8 s, under the hook's own timeout.

## 0.9.0

- ONE SESSION PER CASE, UNDER ITS PARENT DESK: `/desk-case` (`lib/cases.mjs`).
  One design desk carried five jobs in one conversation and mirrored one
  kitchen from another job's line. A desk that declares `perCase` in its
  `desk.json` now gets one session per case, named `desk-<desk>--<key>`.
  Contract: `docs/specs/2026-10-10-per-case-sessions.md`.
  - `open <desk> <key>`:
    - The case is claimed first, through the desk's adapter. A 409 names the
      holder; an adapter that fails is UNKNOWN, never a grant.
    - The brief is written to `.office/cases/<desk>--<key>.md`.
    - The session starts in the parent's folder under the parent's role
      (same wall, token and CLAUDE.md), resuming that case's own earlier
      conversation by id.
    - A session that never comes up gives its claim back.
  - The duplicate guard is per (parent, key). The cap is per desk (`max`):
    over it, a case waits with the parent.
  - `sweep`:
    - heartbeats every live case session's claim, and closes one whose claim
      was lost;
    - closes a session idle past `idleCloseMinutes`;
    - releases claims of sessions that are gone;
    - opens waiting cases, oldest first, up to the cap.
  - `route "<text>"` sends a message that names a case to its live session,
    or else to the parent. `close` stops a session and releases its claim.
    `release` forces a claim free only with the human's words (`--said`).
  - Boot: a case session's SessionStart text names its case and its brief.
    It is told apart from its parent by its own session name, because it
    runs under the parent's role.
  - `perCase` without an `adapter` means naming only. The office runs those
    sessions itself (its own launcher); core uses the key for the session's
    name and its wall, and leaves the desk out of `open` and `sweep`.
  - Native primitives: the session registry, `claude --name` /
    `--resume <id>`, SendMessage, the SessionStart hook. Custom code only
    for what has no primitive: the claim calls and the cap.
- `launchAndWait()` is shared by desks, the lead and case sessions. A launch
  may carry a one-line first prompt.

## 0.7.44

These are gaps local-cabinets-ops found while adopting the wall. Each has a test that was red first (`tests/wall-adoption.test.mjs`).

- `wall.messageTo`: names a desk may SendMessage that are NOT session
  identities. A desk can message `lead` without a session named `lead` (a
  developer at the repo root) being walled as THE lead.
- FAIL-OPEN CLOSED: with its office module missing, a desk session resumed
  at the repo root without its role variable got through. Its name was
  read only after the module loaded. The name is now read first, and a
  desk-shaped session is refused while the module is broken.
- `wall.aliasNames`: regexes for the names the office module maps to desks
  (e.g. `^cs-`). They count as desk-shaped when the module fails.
- A BROKEN MODULE STOPS DESKS, NOT THE PEOPLE WHO REPAIR IT. When `alias()`
  throws or passes its 2 s deadline, only a desk-shaped session (or one
  standing in a desk's folder) is refused. The lead and a developer go on
  under the plugin's own rules. Before, every named session at the root
  was refused.
- A name the office reserves for desks (`aliasNames`) that the module maps to
  no desk is refused. An unrecorded `cs-<x>` used to fall through as a
  developer.
- The lead falls back to the core rules only when the module is broken as a
  whole (unloadable, or `alias()` failed). A `judge()` that throws on one
  call denies that call.
- A `wall.aliasNames` pattern that does not compile is no longer silently
  dropped. Only the lead goes on until it is fixed, and the `desk-wall`
  check names the pattern.
- The module's worker starts only for a session it concerns: an aliased
  name, a desk or the lead. With `aliasNames` declared, a developer session
  starts none (measured about 100 to 200 ms less per tool call, at load 15
  to 25).

## 0.7.43

Full real integration is PENDING: it runs on the first real desk restart of
the live office. A scratch-office run found the two launcher bugs fixed below,
but could not finish without switching the owner's Orca window, which was
ruled out. Its scratch tabs opened in the background and sat at a
folder-trust dialog.

- START AND RECOVER ARE IN THE PLUGIN: `/desk-start <name|all|lead|everything>`
  and `/desk-recover` (`lib/start.mjs`). Native primitives: the session
  registry (`~/.claude/sessions`) for "is it up", `claude --resume <id>` and
  `--name`, and the office's terminal adapter (orca).
  - "Up" is the registry saying the session is idle, never a prompt on
    screen. The first launcher waited for "? for shortcuts", which bypass
    mode never shows, and reported every desk failed while all of them came
    up.
  - ⛔ A desk resumes its OWN last conversation, by id (`lib/conversation.mjs`):
    the newest whose every recorded session name is the desk's, and that no
    live session has open. Never `--continue`: after a disk disconnect,
    `--continue` resumed the newest conversation in a desk's folder, which
    was a case session's, and the parent desk woke up as that case.
  - A start never opens a second session under a live name (the duplicate
    guard). A desk that is alive but restored outside its folder, or running
    another session's conversation, is reported, never killed.
  - `/desk-recover` starts the lead first, then every autostart desk.
  - `office.json` `launch`: terminal, flags, model, lead flags,
    `lead.resume`, waitSec. Flags, models and session ids are checked to be
    plain words, never shell.
- Found by the first real run: Orca opens tabs only inside a workspace it
  knows, and the office root need not be one. The launcher now uses the
  Orca workspace that contains the office, and `cd`s to each target's
  absolute folder.
- A claude that started but never registered (it sits at a dialog nobody
  can see: an untrusted folder, or a tab opened in the background with no
  screen) is reported as exactly that, not as "never started".
- Heal restarts a dead desk through core start when `office.json` says
  `"start": "office:start"`, so an office keeps no versioned plugin path.
  Without a `start`, heal still invents no restart.
## 0.7.42

These follow a third security review of the wall. Each has a test that was red first (`tests/wall-hardening.test.mjs`).

- REDIRECTS AS BASH READS THEM. `>|path` was parsed as a file called
  "|path", which resolved inside the desk while bash wrote outside it, and
  `>&path` was skipped entirely. Both are judged as writes now. `>&2`,
  `2>&1` and `>&-` write no file and still pass.
- GREP AND GLOB ARE READS. Only Read was judged, so a desk could grep
  another desk's `runtime/` (its token) or a `.env`. The hook's matcher now
  includes Grep and Glob.
  - Secrets are checked on their path fields; a search for the text
    ".env" in code is fine.
  - A search may not cover any desk's `runtime/` but the desk's own. A desk
    searches its own folder or outside `desks/`; the repo root is refused
    because it contains every desk. The lead may search anywhere that holds
    no `runtime/`.
  - A Glob pattern may not climb out with `..`.
- BASH DOES NOT READ ANOTHER DESK'S `runtime/` EITHER. Only the Read tool
  was judged for it, so `cat ../other/runtime/token.json`, a glob over
  `desks/*/runtime` and `grep -r` from the repo root all passed. Each path
  word in a desk's command is now resolved against the cwd and every `cd`
  in the command. Refused:
  - a path into another desk's `runtime/`;
  - a glob whose fixed part is at or above `desks/`, or inside another desk;
  - a recursive command (`grep -r`, `rg`, `find`, `tar`, `zip`, `rsync`,
    `cp -r`, `ls -R`) aimed at or above `desks/`, or at another desk.
  Reading another desk's facts and searching `lib/` still pass.

## 0.7.41

These are the follow-ups to a second security review of the 0.7.40 wall. Each has a test that was red first (`tests/wall-hardening.test.mjs`).

- THE HOOK JUDGES UNLESS IT WAS IMPORTED. Started by a wrapper (`node -e`, a
  loader), argv[1] was not the hook's own file, so the hook "was not main",
  did nothing and exited 0: an allow. It now runs unless another script
  imported it.
- MCP: THE DEFAULT IS "READS ONLY". 0.7.40's list of bad words (send, share,
  delete, reply, forward) missed create_draft, post, upload, invite, trash,
  and a browser's computer / form_input, which can submit anything to
  anyone. A tool now passes only when its name leads with a reading verb
  (search, list, get, read, query, fetch, find, view, …) and no sending word
  follows (get_and_send). `wall.mcp.allow` and `wall.mcp.deny` still decide
  when an office sets them.
- The office module's worker and its deadline no longer `unref()`. A
  hanging module was denied in practice, but only because something else
  happened to keep the process alive.

## 0.7.40

- THE DESK WALL TAKES AN OFFICE'S OWN RULES. One office kept its own wall
  beside the plugin's, and its suite passed 16 of 28 against the plugin wall.
  New, each off until office.json sets it (native primitive: PreToolUse hook):
  - `wall.messages`: a desk or the lead may SendMessage only the lead
    (`lead.session` or `lead.aliases`), a real desk, or a real case session of
    one. The hook's matcher now includes SendMessage.
  - `wall.noDelegation`: no Agent, Task, Workflow, RemoteTrigger or worktree
    for a desk or the lead.
  - `wall.module`: an ES module inside the office adds `judge()` rules and
    `alias()` names. It runs after the plugin's rules, so it can refuse more
    and never allow more. It is told the session's own name.
  - desk.json `perCase.key`: `desk-<name>--<key>` is a case session of that
    desk, behind the same wall. A key that does not match in full, or that
    carries `--`, a slash or whitespace, is refused.
- A LOCKED VARIABLE IS READ-ONLY IN EVERY SPELLING. `NAME=` alone missed `+=`,
  `export`, `unset`, `env -u`, `declare`, `printf -v`, `read`, `${NAME:=…}`,
  `${NAME#…}`, quote splicing, `eval` and `${!…}`.
  A name built at run time is refused wherever the shell takes a variable name
  (`declare "OPS_$(echo TOKEN)=x"`, `unset $N`, `printf -v "$N"`, `env
  "X_$(…)=v"`), and `eval` is refused as a word anywhere outside quotes
  (`builtin eval`, `command eval`, `exec eval`). Values may still use
  substitutions (`export PATH=$PATH:…`).
- With `wall.noDelegation`, starting `claude` or `orca` from Bash is refused
  as well: another session or terminal is another pair of hands.
- Known limit, unchanged: a string wall cannot see inside a script, so a desk
  that writes `NAME=x` into a file of its own and sources it is not caught.
  A sandbox is the upgrade path.
- Core stays generic: a test refuses any project word in core code. Comments
  may still tell the history of a fault.
- THE WALL HOLDS UNDER REVIEW. These are the six fixes from the local-cabinets-ops
  lead's security review, each with a test that was red first
  (`tests/wall-hardening.test.mjs`):
  1. A hook started through a symlinked path (macOS `/tmp` → `/private/tmp`,
     a linked plugin root) judged nothing and allowed. `isMain` now compares
     real paths.
  2. An office.json that exists but cannot be read was read as `{}`, which
     meant no wall. Now a session that claims a desk is refused until the
     file is fixed, and a developer at the root can still fix it. A payload
     the hook cannot read is refused in a walled office.
  3. `failClosed` is the default once an office has a wall; an office opts
     out with `false`. The office module runs in a worker with a 2 s
     deadline, so a missing, throwing or hanging module refuses a desk.
     The hook keeps its own deadline rather than relying on what Claude Code
     does when a hook times out; the hooks.json entry also carries a
     `timeout` of 10 s.
  4. MCP tools were never checked. Now the matcher includes `mcp__.*`, and
     `wall.mcp` holds `allow` or `deny` patterns. The default denies a desk
     every tool that sends, shares, deletes, replies or forwards.
  5. A case-blind disk let a desk write its own `.CLAUDE/` and read another
     desk's `RUNTIME/`, and a symlink in its folder counted as inside it.
     Paths are now compared as real paths (symlinks, `..` and `//`
     resolved), case-folded on macOS and Windows; the secrets pattern is
     case-blind.
  6. `wall.messages` and `wall.noDelegation` are on once a wall exists; an
     office opts out with `false`.
## 0.7.39

- A FOURTH DESK KIND: `liaison`. It is for a desk that talks to the team on a
  channel (coworkers, partners), never to customers. Like `channel`, it is
  given a sender only once it is live. Before this, desk.json refused the kind,
  so desk health reported a working team-channel desk as "unreadable" and
  stopped watching it.
- The send-wall gate now reads the issue table instead of a list of kind
  names. A `lead` desk, which is never issued a sender, used to pass the gate,
  and so would any kind added later.

## 0.7.38

- ALIVE AND IDLE IS NOT LISTENING. After a Mac restart every desk came back
  resumed with no doorbell running (a resumed session does not restore its
  Monitors), and the registry still said idle. lib/health.mjs asks the process
  tree instead: a desk with `wake` is armed only when that command runs under
  its own session's pid. It also reports each desk's session, permission
  mode, status and last activity, office.json `health` checks, and orphan
  doorbells whose session is gone. `/desk-health`; the `desk-health` check
  puts it on the board. Exit 0 / 4 / 7 like every check.
- `--heal` acts only within the powers the office granted: kill a proven
  orphan (re-proven the moment before), restart a dead desk through
  office.json `start` (3 per hour per desk), run a check's own `heal`, and
  leave alerts for the lead in .office/alerts.log, one per subject per 15
  minutes. It never types into a desk. Every act is logged.
- `--install-watchdog` runs `--heal` every 120 s from a LaunchAgent, through
  a shim on the home disk (~/Library/Application Support/office-anything/)
  that finds the plugin's CURRENT install, so a version bump does not strand
  it.
- New desk.json fields: `wakeMatch`, `wakeGraceSec`, `wakeOwner: "launchd"`,
  `watch: true` (a desk with autostart:false that must still be running).
  New office.json keys: `start`, `health`, `watchdog`.
- After review: a doorbell is the interpreter `wake` names running the
  script (a pager, editor or grep naming it is not); an orphan has only
  shells and node above it up to launchd and its script inside this office;
  a session file whose pid was reused is not a live session; every kill
  re-reads the process table and requires the same command, parent and an
  age no younger; one heal at a time (lock), the budget spent before the
  act; logs rotate and .office/ ignores itself; the LaunchAgent carries
  PATH, runs node through env, is ProcessType Standard, keeps its shim and
  log on the home disk, says once an hour when the office disk is missing,
  and refuses temp folders and git worktrees.
- An orphan whose script cannot be placed in this office (a relative path,
  a cwd nobody can read) is listed as unproven, never dropped and never
  killed. Seen live: five buyer-wake processes, 1 to 30 hours old.
- After the second review: an orphan is PROVEN only by an exact form, never
  a parse: after node, the raw command is the desk's own wake script run from
  the desk's folder, or that script's exact absolute path (a path with a space
  is compared as written). A linter given the file, --require, a worktree
  under the office, or a sibling folder sharing its prefix is not ours. A
  shell is never the doorbell, even under wakeMatch. The heal lock belongs to
  a live pid (never taken by age), is taken over atomically and released only
  while it is ours; the budget is re-read before every spend; a desk
  restarted in the last 5 minutes is left to register. The shim honours
  CLAUDE_CONFIG_DIR and runs the newest install that exists.
- After the third review: `node lib/health.mjs --heal` HUNG (exit 13, an
  unsettled top-level await): heal.mjs imported health.mjs while the CLI was
  still evaluating it, and the unit tests, calling heal() directly, could not
  see it. The process primitives live in lib/procs.mjs now; a test runs the
  CLI. The heal lock is held only by a live pid that touched it within twice
  the longest act (a reused pid, like pid 1, no longer blocks healing
  forever); a stale lock is taken over by the one contender that creates
  heal.lock.takeover, never by moving a lock that might be live (six
  contenders over a crashed lock had produced two holders); a skipped heal
  says why. A doorbell under a path with a space is recognised by the same
  exact forms as the orphan proof.
- The boot hook's doorbell line now asks for Monitor timeout_ms 1800000 and
  to re-arm on every expiry notice: a Monitor dies at 30 minutes at most,
  and "persistent" is not a setting it has.

## 0.7.37

- THE DESK WALL AND DESK BOOT MOVE INTO THE PLUGIN. Every office that ran
  desks for long wrote the same two hooks: a gate that keeps each desk inside
  its own folder (no writes elsewhere, no secrets, no other desk's keys, no
  walking into another desk, a lead that only runs the commands it is given),
  and a start-up note that tells a restarted desk who it is and where its
  memory is. They are `hooks/desk-wall.mjs` and `hooks/desk-boot.mjs` now,
  with the rules in `lib/wall.mjs` and identity in `lib/office.mjs`, and every
  business-specific part (refused commands and their reasons, the lead's
  commands, which files are memory, the words used) in `office.json`.
- ⛔ OFF UNTIL ASKED. A plugin hook runs in every project it is installed in;
  both do nothing without the `wall` / `boot` sections in `office.json`.
- IDENTITY FOLLOWS THE SESSION: the declared role variable, then the session
  name from the CLI's registry (it survives `--resume` at the repo root,
  which drops both the folder and the variable), then the folder. A session
  claiming a desk the office does not have is refused.
- FAILS OPEN BY DEFAULT, as every gate here does; `wall.failClosed` lets an
  office whose wall is its only door refuse a desk call it cannot judge.
- GIT IS READ-ONLY FOR A DESK BY ALLOWLIST (status, log, diff, show, …).
  The source office listed the writing subcommands and missed `branch -D`,
  `clean -fdx`, `config`, `tag`, `worktree`; review caught it.
- THE WALL FOLLOWS THE SESSION OUT OF THE REPO (review). It found the
  office only from the payload's cwd, so a desk that cd'd to /tmp had no
  wall. It now asks CLAUDE_PROJECT_DIR first (the session's own folder,
  which cd does not move), then the cwd, and the role variable from
  `office.json`. With `failClosed`, a wall that breaks while judging refuses
  (the `|| exit 2` the source office had), including an uncaught crash.
- A NEW CHECK, `desk-wall`: a rule that does not compile (the gate cannot
  apply it), and any desk record running a command the office audits for.
- MIGRATING an office that has its own copies: add the sections, install
  this version, restart the desks; the two walls agree while both run. Then
  remove the old hook lines from each desk's settings and retire the scripts.

## 0.7.36

- BETWEEN DESKS: an office-wide timeline of every desk-to-desk message, read
  from both ends (a desk's SendMessage calls and the peer messages it
  received), one line per message, with the asks nobody has answered marked
  and counted beside the desks. A closing "done, thanks" is not an ask.
- EACH DESK SAYS WHAT IT IS DOING in the CLI's own words (working, running a
  command, waiting on you and on what), and a desk running Remote Control
  gets an "open in the Claude app" button.
- THE COMPOSER SAYS ITS ROAD before you type: the desk's inbox, its
  terminal, or why it cannot be reached. A question's option is answered in
  the desk's own dialog; multi-select, multi-question and plan approval point
  to the Claude app instead of typing words into a dialog.
- THE EXTENSION POINT: `panels` in `office.json`. A project lists a read-only
  command per panel and the board shows its items beside the desks; the
  board itself stays free of any one business's nouns.
- ⛔ ONLY THE BOARD PAGE MAY WRITE (review). Each board process mints a
  token and hands it only to the page it serves; every writing request
  carries it back, on top of the Host/Origin/JSON guard. A panel command runs
  only on that guarded POST, never on a GET a link or image tag could fire.
  An answer sends the id of the question it answers.
- /model offers the aliases and today's ids (claude-opus-5-5,
  claude-fable-5-1, claude-sonnet-5, claude-haiku-4-5-20251001).
- RATES RECHECKED against the reference (as of 2026-06-24): Opus 5.5 is
  $4/$20 with $0.20 cache reads, and had been billed as Opus 5 because
  `claude-opus-5` is a prefix of its id; Fable 5.1 reads cache at $0.25. The
  rates' date now shows beside every estimate instead of in a hidden card.

## 0.7.35

- BROWSERS START WHEN A DESK BROWSES, NOT WHEN THE OFFICE STARTS. The owner's
  first complaint about the office was a screen full of Chrome windows every
  time it came up, one per desk, most of them for desks that never opened a
  page. `/desk-board` no longer opens a browser at all: it hands over the
  link and opens it only when asked.
- A NEW CHECK, `browser-on-demand`, reads every hook Claude Code fires by
  itself (SessionStart, Setup, UserPromptSubmit) in the office's and each
  desk's settings, and the local script each one runs, for the shapes that
  launch a browser. A browser MCP that starts its browser on its first tool
  call is the rule working, and passes. What it cannot see, it says: a launchd
  job or keeper loop outside the repo is the other place to look.

## 0.7.34

- THE BOARD TALKS THROUGH THE SESSION'S OWN INBOX. Every interactive Claude
  Code session registers a messaging socket and a key beside its session
  record; that is where SendMessage delivers. The board now sends there first
  (one auth line, one message line in the CLI's own envelope, "from office
  board"), so a message reaches a busy desk without typing into its terminal.
  The orca keystrokes stay as the fallback.
- ⛔ IT NEVER CLAIMS A PERMISSION MODE. A session running with permissions
  bypassed holds a message that asserts no mode, for approval at its own
  screen. Forging the mode would launder the owner's permission decision, so
  for such a desk the board types into the terminal instead, or says plainly
  why it cannot.
- KEYSTROKES INTO AN OPEN DIALOG ARE ANSWERS. Typing a message while a desk
  showed a question put the text into the dialog, where a leading digit picks
  an option. The terminal road now refuses while a dialog is open.
- ANSWERING A QUESTION IS ITS OWN ACT: `POST /api/answer` presses the chosen
  option's number, which the CLI's choice list takes and submits (verified on
  a live dialog). A plan approval, several questions on tabs and multi-select
  are refused with where to answer them instead of being approximated.
- REVIEW FIXES, before release:
  - Delivered means the desk's own record shows the words queued (its
    enqueue entry); a socket that merely closed is not delivery, and the
    terminal fallback runs instead.
  - The session, its transcript and its terminal tab are resolved together;
    the tab is the one named for that session, never just one at its folder.
    A named lead that is not running gets nothing.
  - An answer carries the id of the question it answers, and is refused
    unless the live session says it is waiting on that very question.
  - Every writing request must come from this board: its own Host (or one
    `office.json` lists under `board.hosts`), a same-host Origin when the
    browser sends one, and `application/json`. A page on another site could
    otherwise POST text/plain to 127.0.0.1 and type into a desk.

## 0.7.33

- MESSAGES THAT ARRIVE MID-TURN ARE CHAT. Claude Code records a message that
  reaches a busy session as an attachment (`queued_command`), not a user
  entry, and the board read only user entries: one desk's session was missing
  75 messages, another 41, the owner's own mid-turn corrections among them.
  They are parsed by origin now (the owner, a peer by its envelope, a
  background task as an event), through the same classifier as a user entry,
  and de-duplicated by the command's own id across incremental reads.
- EVERY LIVE STATUS, NOT TWO. The roster tested `busy` and `waiting` only, so
  a desk in `shell` (a command running in the foreground) read as idle. Every
  status the CLI writes now has a state, `waiting` says what it waits on, and
  an unknown status is shown as-is rather than guessed.
- THE REMOTE CONTROL LINK rides each row: a session the owner can drive from
  the Claude app carries its link, built from the id the CLI registers.
- THE LEAD IS A NAME. Several live sessions share the repo root, and the most
  recent status change picked the lead's row. An optional root `office.json`
  names the lead session; without it the remote-controlled session leads and
  recency only breaks ties. The lead's chat reads that session's own
  transcript, and a `desk-<name>` sender is named by its desk even after its
  session ended.
- ⛔ A NAMED ROW IS THAT NAME OR NOTHING (review). Ranking by the expected
  name still gave the lead's row to a developer session at the root when the
  lead was not running, and the owner's message would have gone there. A
  named lead now matches exactly or reads "not running", and its chat is the
  newest transcript that records that name. A desk's folder never takes a
  session named for another desk.

## 0.7.32

- THE BOARD SHIPS ITS PAGE. board/ui/dist sat in board/ui/.gitignore, and an
  install from GitHub copies only what git tracks: the first 0.7.31 install
  had a board with no UI. The directory-sourced marketplace had hidden this
  by copying the maintainer's untracked build. dist is tracked now, rebuilt
  clean (1.6 MB, down from 16 MB of stale chunks), and a test pins it.
- A route that throws after its headers went out no longer kills the board.
  The catch-all called writeHead a second time, threw ERR_HTTP_HEADERS_SENT
  outside any handler and took the server down with every open page. It
  logs the real error now and ends the response.

## 0.7.31

- THE LEAD'S CHAT FOLLOWS THE LIVE TURN AGAIN. A transcript larger than the
  64 MB read window was parsed from its FIRST byte to the cap and then marked
  as read, so a 74.5 MB lead session showed a turn from hours earlier and
  never moved past it. The reader now takes the newest window, starting at a
  whole line.
- A live session beats a newer transcript. With two live CLI sessions at one
  repo root, newest-mtime flipped the lead's view between them; the session
  registry decides now, and the remote-controlled session leads.
- Tabs titled `desk-<name>` in lower case are recognised: such desks read as
  offline and could not be sent to. The lead's folder fallback never picks a
  tab that names itself a desk, and a desk restored at the repo root never
  takes the lead's live row.
- A subagent hand-back (`Another Claude session sent a message: <agent-message>`)
  renders as a system event, not as the owner typing.

## 0.7.30

- README gains an Updating section: this is a community marketplace, so
  installs do not auto-update. Users run /plugin marketplace update then
  /plugin update to pull a new version, and /reload-plugins to apply it in the
  session. Only official Anthropic marketplaces update in the background.

## 0.7.29

- A SCREENSHOT A TOOL RETURNED NO LONGER RENDERS AS THE OWNER'S MESSAGE.
  The harness records a tool-read image as a user-typed echo, so every
  picture the desk itself took sat right-aligned as if the human had sent
  it. Both shapes (the tool_result image and its marker echo) now render on
  the desk's side. Images the human actually attached still render as theirs.
- Cross-desk peer bubbles name the sender by DESK (team-lead, design), not
  by the harness's raw session handle.

## 0.7.28

- MODE AND CONTEXT LIVE AT THE PROMPT, like the CLI status line: the
  permission mode badge and the model · ctx % badge moved out of the header
  to the top right of the composer, and now show on the phone too. Asked
  for twice; the rig check now asserts the header does NOT carry them.
- A refused bare picker command (/model with no argument) hands the text
  back synchronously. The component resets the form before calling us, so
  a deferred restore raced any reader; the rig caught it one run in four.
- On the phone the update FAB sat on top of the send button; it now floats
  above the composer. The heartbeat rig check waits for the page's own
  fetch instead of probing once, which was red on every cold start.

## 0.7.27

- THE / FLOW BEHAVES LIKE THE CLI: ↑↓ move a highlight, Enter or Tab
  complete the highlighted entry and never submit a partial, Escape closes
  the menu and keeps the text. Tested key by key with real key events; seven
  new rig checks, 28 in all.
- Built-ins that open a PICKER in the terminal (/model, /effort, /config,
  /permissions, /resume, …) are handled honestly: the transcript never
  records a TUI menu, so a bare one sent from the board opened a menu
  nobody watched and parked the desk on "waiting". The board now shows the
  ARGUMENT list inline (/model → the model ids, /effort → the levels),
  completes it, and refuses to send the bare form, handing the text back
  with the inline example.
- README rewritten to what the board is now: live session state, the
  .claude rail, the heartbeat, the phone mount, the 21-then-28 check rig.

## 0.7.26

- THE RIG GREW FROM 9 TO 21 CHECKS, one per thing the owner caught by hand
  this week: the recorded mode and ctx % in the header, the heartbeat pill,
  every rail tab rendering, hooks in lifecycle order, copy path writing the
  clipboard (read back, not assumed), the lightbox, and the phone drawer
  opening and closing on a desk tap. A human found each once; a machine
  finds them now.
- copy path works on iOS: Safari copies only from an editable, explicitly
  ranged selection made inside the gesture; the path is also select-all
  for a long-press.
- What the CLI never renders, the board never renders: system-reminders
  and local-command caveats are context for the model, not for the human.
- The office board runs as a KEPT loop in the runbook (respawned on exit);
  a hand-started process typed from the wrong directory left the site dark
  for seven minutes. The wrapper forwards SIGTERM to its server so a stop
  never leaves an orphan on 7719.

## 0.7.25

- A hook row names its SCRIPT (guard-bash.sh, no-secrets.mjs), not a
  path fragment with a stray quote from splitting a shell command on /.

- Hooks list in LIFECYCLE order, SessionStart to SessionEnd; alphabetical
  had put Stop before UserPromptSubmit.
- The heartbeat is a pill: "12/12 loops up" with the pulse icon, the full
  line on hover, red and "attention" when not.

- A bare slash command typed at a prompt is recorded as plain text in some
  paths and rendered as the human chatting; it folds as a local command now,
  and a bare /compact joins the one compaction event.
- "queued" says WHY when the desk is waiting on a prompt in its own terminal
  (the CLI's live status), because a message stuck behind a permission
  prompt looks like a bug until the board explains it.

## 0.7.24

- THE CLI'S OWN LIVE STATE, adopted: ~/.claude/sessions/<pid>.json carries
  status busy|idle|waiting, cwd, version, name. Liveness is the pid, not the
  timestamp (updatedAt only moves on status changes). "waiting" is the CLI
  itself saying a human is needed — a permission prompt or a question — so
  the amber badge now lights from the source even though the prompt's
  content is not recorded anywhere on disk. The 45s mtime heuristic remains
  only for sessions older than the file.
- The Context element in the header: how full the window is (88% ctx),
  tokens and cost on hover. The 1M window is inferred from evidence (a
  prompt over 200k) because the record's model id drops the [1m] tag.
- Pending questions and plan approvals ride the Confirmation element;
  WebSearch/WebFetch results list their URLs on the Sources element.
- A failed tool count is a red badge, not a glyph. Subagents wear a nested
  arrow, not the AI sparkle, and their row says what task spawned them,
  read from the head of their transcript.
- The agents tab lists the office's root .claude/agents alone (owner's
  ruling); the toast belongs to the desk that earned it and clears on switch.
- A failed UI build no longer blanks the live board: Vite emptied dist
  before building, and one bad import served an empty page to every
  self-healing tab for a minute ("page crashed"). emptyOutDir is off;
  index.html is written last, so the previous build keeps serving.

## 0.7.23

- The rail is workspace · agents · skills · plugins · hooks. Agents and
  skills show ONLY what the desk's .claude loads (desk, office, user);
  installed plugins get their own tab from the cache Claude Code loads
  them from: name, version, description, and what each brings, counted
  (agents · skills · commands · hooks), never claimed.
- copy path works everywhere a page does: the Clipboard API only exists in
  a secure context and the old button swallowed its failure silently. A
  hidden-textarea fallback, and the button says copied ✓ or copy failed.
  Proven by a real click reading the path back off the clipboard.
- Markdown lists got their bullets back. Tailwind's preflight strips
  list-style, so "- item" rendered as a bare line with no marker to color.

## 0.7.22

The owner's second burst, every item a read of something Claude Code already writes.

- The EXACT permission mode in the header (⇧⇥ bypass / auto / plan …),
  from the permissionMode the CLI stamps on every entry it records. The
  button's note stopped saying "watch the terminal".
- The rail is workspace · agents · skills · hooks: the desk's .claude,
  displayed. Agents with model · effort and description from frontmatter
  (folded YAML scalars included); skills and commands from the desk, the
  office, the user and every plugin, click to type. Scratchpad and checks
  left the rail; the checks stay in `checks/run.mjs` and CI.
- An office heartbeat: the root desk.json may declare "heartbeat": a
  command; the board runs it every 20s and shows the last line at the
  sidebar's foot, green or red. Wiring it found the fault behind "I don't
  see things running": 8 of 12 keeper loops were DOWN. All up now.
- The update FAB, bottom-right, folded until wanted: update Claude Code,
  update the office plugin. Neither touches a running session, both say so.
- Subagent and job rows got air and honest icons (Sparkles, Users, Clock);
  the default robot is gone. Teammate sessions stop reading as a session
  slug like "…-v2-40" and say what the human first asked, or "another
  session at this desk".
- Tool folds wear a wrench, not the registry's search icon; the office
  wears Building2, not an emoji. "Open full size" opens a lightbox: a data:
  URL cannot open top-level, so the link did nothing. The outbox echo
  dissolves on a normalized prefix, since terminals re-wrap what they type.

## 0.7.21

- A new README hero: a product shot of the actual board (assets/board-hero.svg)
  with the colored blob avatars, a message from support in its own color
  routed to pricing and answered, the working line, and the mirrored browser.
  The old three-desk schematic retired to bk. The board section rewritten to
  say what the page actually is now, component by component.

## 0.7.20

- Every desk wears a shape, not a bar. A colored blob avatar with the
  desk's initial, both colour AND organic form hashed from the name, so a
  desk is known at a glance in the sidebar, the header, and any message
  from it. The green status dot is gone: status rides the NAME now, which
  grays out when the desk is offline and SHIMMERS (the registry Shimmer)
  while it is handling something. Two things to read, not three.

## 0.7.19

- Every desk has a COLOR, hashed from its name so it is the same across
  sessions, machines and reloads with nothing to configure. One hue,
  everywhere the desk appears: an identity bar by its sidebar dot (which
  keeps meaning live/busy — two signals, never conflated), a bar in the
  header, the border and label of a message FROM it, so "from
  manufacturing" wears manufacturing's color.
- A /compact turn is ONE "context compacted" event now, not the giant
  summary rendered as a chat bubble plus three empty "local command"
  folds. The owner watched exactly that pile up and called it confusing.
- The hire dialog's kind dropdown says the generic thing (customer-facing
  / internal), because the plugin is a general office and customer service
  is only how WE use it; the dialog is roomier so neither clips.

## 0.7.18

- "running for 4,000 minutes" is gone. The turn timer anchored on the last
  role:user message only, so once desk-to-desk peers and system events
  stopped counting as the turn's start, it measured from something days
  old. It now anchors on whatever last SPOKE TO the desk (human, peer, or
  system) and clamps anything over 4 hours to no-counter rather than a
  fantasy number. Verified end to end: a live send read 2s, not thousands.

## 0.7.17

- Desk-to-desk messages read as CONVERSATION: an attributed left bubble,
  "from manufacturing: ACK", sky-edged. The envelope and the harness's
  security boilerplate are display plumbing and stay out of the chat -
  same native record, seen from the owner's seat. Outgoing folds name
  their recipient: "SendMessage → manufacturing".

## 0.7.16

- The tab heals itself. no-store protects the NEXT load, not the one
  already running, so a tab left open across ships kept yesterday's UI
  while looking current (the owner caught it as "seems outdated"). The
  client now compares /api/version's build stamp to the one it booted
  with and reloads on change — unless the human is mid-sentence, in
  which case it says so and waits.

## 0.7.15

- API errors are the HARNESS speaking, not the desk: a synthetic turn or
  "API Error..." text renders as a red ⛔ event, never as the desk's words.
- Attachments got their chips back: a dropped or picked file landed in
  context with NOTHING on screen, so the composer looked like it swallowed
  the image. The chips ride the component's own attachments hook; drop and
  the photo button were working all along, invisibly.
- The ⇧⇥ mode key lives in the composer next to / commands, where input
  belongs, not in the header.

## 0.7.14

- SEND WAS 8-12 SECONDS and it was ours: orca types at human speed and the
  server waited for it SYNCHRONOUSLY, freezing every other request too.
  Dispatch is async with a 700ms early reply, the terminal roster is kept
  warm from the background, and the transcript (over SSE) is the delivery
  confirmation the outbox already visualizes. Measured: 1.2s, echo instant.
- A Skill's injected instruction body folds as "skill loaded · <name>"; it
  had rendered as the owner pasting a manual into chat.
- The mode key: ⇧⇥ in the header sends a real Shift-Tab into the desk's
  pty, which is how the CLI cycles permission modes. The record does not
  carry the resulting mode, so the button says to watch the terminal, not
  a made-up badge.
- The upgrade button: `claude update` from the sidebar, versions before
  and after, and the honest note that running sessions keep their version
  until restarted.
- The scrollbar belongs to the room: thin, muted, no bright track.

## 0.7.13

- A checks tab on the registry's TestResults element: the plugin's own
  structural checks run live against the office, pass/fail/unknown with
  the why on the row. Its FIRST render caught a real fault: the office's
  backup robot commits as "auto:" with no conventional type, failing the
  commit-convention check the office itself adopted.
- Background jobs carry their NAME: the tool result that spawned a job
  names the id, that call's own input carries the human description, and
  the two are joined. "b48q6efs9 · 4m ago" reads as what it is instead.

## 0.7.12

- A hooks tab in the rail: every hook that can actually fire on the desk,
  from the three places Claude Code reads them (project settings, user
  settings, each installed plugin), grouped by event with matcher and
  source. Gates stop being invisible.
- The workspace tree reaches depth 5 and 1500 entries; at depth 3 an
  expanded .claude/skills/<name>/ folder showed NOTHING. bk/ is the attic
  and left the tree.
- The outbox rides the registry's Queue element instead of hand-rolled
  bubbles.

## 0.7.11

- PUSH, NOT POLL. /api/events watches the transcript directory and ticks
  over SSE the moment Claude writes; the client refetches on the tick and
  keeps a slow 4s poll only as the net for a dropped stream. Receiving
  latency fell from a polling beat to roughly the debounce (~150ms).
- Sending got faster too: the orca terminal list that every send paid a
  few hundred ms for is cached 3s for the real runner only — a cached
  mock would poison the next test's world, so injected runners bypass it.
- Both command surfaces read like the CLI: two left-aligned columns, the
  name never hidden, the description truncating with a hover title. The
  outbox caption is one word.

Every entry below is a fault found by **using** this plugin, not by reading it. Four of the
first five needed a desk to exist and a second action taken against it.

## 0.7.10

The owner ran the office from a phone for an evening; this is that list.

- A sent message ECHOES instantly, marked "delivering…", or "queued — the
  desk is mid-turn, it reads this next" when busy; the echo dissolves the
  moment the transcript shows the real turn. Typing into a terminal takes
  seconds to surface, and a silent gap reads as a swallowed message.
- "working…" ends when the turn ends: a finished turn closes with plain
  assistant text, mid-turn entries end with a tool call. The shimmer had
  outlived every turn by the whole mtime window.
- The Computer is the WHOLE browser: a tab strip lists every open page,
  click picks which one the mirror shows. The "display only · ~1 fps"
  caption went away.
- Desk browsers start on an identity page (/hello?desk=) instead of
  about:blank, so a row of open Chromes says whose they are.
- The / suggest now carries the full surface: this repo, the user, EVERY
  installed plugin's commands and skills, and the CLI built-ins. 145 on
  this machine, was 10.
- Sidebar and rail collapse by drag. Hiring reads as a person joining a
  division. Background jobs show under their desk AND below the mirror,
  from tasks/*.output, amber while running. The tree's cap says plainly
  what it is. The duplicate media button is one per screen size,
  everywhere this time.
- The / list is vertical with each command's own description, Tab
  completes the top match, and the menu closes on send. The from-top
  scroll on switch is actually dead now: the first fix sat ABOVE the
  original resize="smooth" as a duplicate JSX prop, and the last one wins.
- working… reads like the CLI status line: elapsed and tokens for THIS
  turn, from a per-turn counter the tail reader keeps.
- A folder click toggles the folder; it had been opening the file dialog
  on the folder's path. Chat images click open full size in their own tab.
- Polls tightened (chat 1.2s, roster 5s) — the unchanged-payload
  short-circuit makes the extra beat nearly free.
- The rig learned about WINDOW focus: with another Chrome holding macOS
  focus, Base UI's focus trap never engages and Escape/outside dismissal
  silently die. Three checks went red the moment five desk browsers were
  relaunched. The rig now activates its tab and clicks once before
  measuring — the failure was real, the subject was the environment.

## 0.7.9

- Messaging the LEAD works. Its tab is titled with the task summary, never
  "team-lead", so the title matcher could not find it and send refused.
  Fallback: exact worktreePath equality from orca's own listing, newest
  output wins a tie - which also makes the v1 repo's terminal, at a
  different path, unreachable by construction. Proven by typing into the
  lead's own live terminal through the board.

## 0.7.8

- Tool calls show their RESULTS. Each tool_result attaches its output text
  and error flag to the call it answers, paired by tool_use_id through an
  index the incremental reader carries across chunks, so a result landing
  in a later read still finds its call. A failed call turns its row red
  and the fold says "⛔ n failed". The registry's ToolOutput and
  output-error state existed all along, unused.
- Edit and Write render as diffs: what left in red, what arrived in green,
  the file path on top. Raw JSON was the CLI's job to avoid, and now the
  board's too.
- The suite caught the tool-shape change and the stated-count ratchet
  caught its own README badge going stale, twice. Both synced by count,
  not by hand-waving.

## 0.7.7

- Markdown for the WHOLE tail. The last-15 cutoff predated the memoized
  blocks it was protecting against; every older turn read as raw
  asterisks. Each message parses once now, so the cutoff protected
  nothing.
- Screenshots a TOOL returned finally render. They live one level down,
  inside the tool_result block, and the extractor never walked that level;
  tool results stay plumbing except their pictures.
- Tool-call and system rows read left-aligned: a native button centers
  wrapped text, which put "2 tool calls" in the middle of the row.
- One attach affordance per screen: the photo button is the phone's, the
  action menu is the desktop's; both showed on mobile and shoved each
  other.
- The Computer pane says "currently off" when a desk has no browser, in
  those words. The mirror only polls while open, per viewer, so off costs
  nothing.
- local command events name their command in the fold and drop the ANSI
  color codes that rode /compact stdout onto the screen.

## 0.7.6

A phone-in-hand pass by the owner, every item found by using the board.

- A literal 0 haunted the chat: `text || images?.length` leaks the NUMBER
  zero into JSX for every empty-text turn. Boolean now.
- WORKING is a signal: a desk whose transcript grew in the last 45s pulses
  sky in the sidebar and shows a shimmer at the chat tail. The tab glyph
  looked like a spinner and is a permanent marker; mtime is the honest
  pulse.
- Typing / suggests commands INLINE above the composer, filtered as you
  type, like the CLI. The dropdown button remains for discovery.
- Switching desks: skeletons while loading (never the last desk's words,
  never a blank flash), the mirror clears to "connecting", and the chat
  lands at the BOTTOM instantly instead of animating down from the top.
- The phone drawer dismisses on choice (desk, file, hire): a drawer that
  stays over the thing you chose is a wall.
- One-tap photo button in the composer; the action menu was a second hop
  phones kept fumbling.
- copy path button on an open file, for mentioning it in chat.
- The hire dialog speaks plainly, and its kind dropdown no longer clips
  mid-word over its own trigger.
- iOS: 16px inputs (no focus zoom), safe-area bottom, viewport-fit=cover.
- The rig's image check is honest about data-dependence: none-in-view
  passes with a note; present-but-unloaded still fails.

## 0.7.5

- Markdown stopped whispering. Rendered markdown rode muted grays and got
  lost on the dark ground; body text is full foreground now, and structure
  (headings, links, inline code, list markers, quote bars) uses the same
  blue family as the workspace folder icons, so chat and rail read as one
  surface.

## 0.7.4

- The phone got the screen back. A hidden ResizablePanel still OWNS its
  percent of the row, so two invisible side panes were eating a third of a
  390px screen and the chat lived in the leftover middle. Below md the
  panels are now not rendered at all. Found by using the board on an
  actual phone, minutes after it went up behind auth.
- The drawer is the whole office now: desks on top, the same
  workspace/scratchpad rail below, one Tabs tree shared with the desktop
  panel rather than a second copy.
- Computer stacks vertically on a phone, same pair, still resizable; its
  header button is icon-only below sm.

## 0.7.3

- The board survives a subpath. Every API call and asset reference is now
  relative (`api/...`, vite `base: './'`), so a reverse proxy can mount the
  board at `https://host/office-board/` behind its own auth and strip the
  prefix. Nothing changes when served at `/`. First deployment: the board
  published behind an existing app's login via nginx `auth_request`.

## 0.7.2

- The sidebar shows each desk's EXACT folder name. It had been trimming
  `-customer-service` for width, which meant the name on the board was not
  the name on disk, in the roster, or in a hire refusal. Owner's ruling:
  the folder is the name.
- The hire dialog got its + button back. The dialog and `/api/hire` were
  live, but the trigger was dropped in a layout refactor, so the only way
  to hire from the UI was a dialog nothing could open. Now in the sidebar
  header and the mobile drawer.

## 0.7.1

- ONLINE means a live terminal, not "spoke recently": the whole office read
  as absent while sitting at its desks. Terminal truth from the orca CLI,
  cached 5s, honest null without it. Found immediately: the spinner glyph
  cycles while a desk works, and stripping one literal star called the
  BUSIEST desks offline and made send miss them — the normalizer now strips
  any leading glyph run, pinned for every spinner variant.
- Subagents and teammate SESSIONS are told apart in the sidebar: Bot for
  sdk-spawned sidechains, Users for full peer sessions, from the transcript
  head's own entrypoint.

## 0.7.0

Rollup of the 0.6.x local deliveries plus the blocked-on-you feature.

- ⛔ A DESK WAITING ON A HUMAN NOW SAYS SO. A pending AskUserQuestion or plan
  approval flips the desk to an amber "waiting" badge, and the question
  renders with its options as buttons — a click types the answer into the
  desk's real terminal. Found while building it: trimmed desk toolsets do not
  carry AskUserQuestion, so today this mostly serves the lead and full-toolset
  sessions; documented, not implied away. The release decision you are
  reading was answered through this exact feature.
- Live subagents under their desk in the sidebar (sidechain transcripts,
  labeled by task, pulsing while fresh).
- The usage menu: tokens AND dollars per line, cache read 0.1x and write
  1.25x input rate, as-of date on every figure, unknown model = tokens only.
  One owner for the arithmetic, tested to the cent.
- The Computer opens BESIDE the chat, resizable. System traffic renders as
  events, not as the owner speaking XML. Pasted-image markers become chips.
  The + button hires through hire() with the two-reader refusal on screen.
  Lucide icons, slim sidebar, mobile header fixed.

## 0.6.3

- Live SUBAGENTS in the sidebar: recently-active sidechain transcripts under
  their desk, labeled by their task, pulsing while fresh. The Grok Build idea,
  built as a read of what Claude Code already writes.
- A usage menu on the model badge: tokens and dollars per line (input, output,
  cache read at 0.1x, cache write at 1.25x), rates carrying their as-of date,
  and an unknown model gets tokens only, never a guessed dollar. One owner for
  the arithmetic, tested to the cent.
- Lucide icons replace the emoji; the sidebar slimmed to names and signals
  with the numbers on hover; the send/upload path proven end to end against a
  live desk, which replied.

## 0.6.2

- A ＋ button hires a desk from the board, through hire() and nothing else:
  the human picks the kind as reader one, the contract's own reading is
  reader two, and a disagreement comes back 409 with the refusal shown
  verbatim, because the refusals are the product.

## 0.6.1

- The Computer opens BESIDE the chat, resizable, never instead of it.
- System traffic (task notifications, hooks, cross-session envelopes, local
  commands) renders as muted collapsible events, not as the owner speaking
  XML. Pasted-image markers whose bytes never reached the transcript show as
  a clean chip instead of bracket prose. The mobile header truncates.

## 0.6.0

The board grew up. Everything below shipped as 0.5.x local deliveries and is
rolled into one public release, per the release policy.

- THE CHAT IS THE PRODUCT: real AI Elements end to end (Conversation,
  Message with markdown, Reasoning, Tool with parameters, FileTree, Image,
  PromptInput with attachments and shell-style history), resizable tone-
  separated panes, a session-folder rail, files opening in place.
- THE COMPUTER TAB MIRRORS a desk's headed browser, display only, through a
  zero-dependency CDP client with a unit-tested frame codec. Port 9222 is
  refused by name.
- THE SERVER READS INCREMENTALLY: 30ms warm where whole 62 MB transcripts
  were re-read synchronously per poll. Equal-to-full-parse is pinned by tests.
- THE LEAD HAS A HOME: leadDesk() reads a root desk.json (kind lead), so the
  desk that runs an office is finally visible to checks and mirrorable.
- THE RIG: board/ui/e2e.mjs walks nine functions with hit-tested input and
  thresholds. It found most of the bugs above, plus a Chrome quirk (input
  dies after CDP-driven reload) it now documents and sidesteps.
- UI unit tests via vitest (the folding logic), wired into CI.

## 0.5.13

- The board walked end to end by its own rig: nine functions, hit-tested
  input, thresholds, three clean runs. What the walk found and fixed: the
  server re-read whole transcripts on every poll (now incremental: 30ms warm,
  was seconds, unit-tested against the full parse) · WebPreviewBody is an
  iframe and had swallowed the mirror · the Computer tab now MIRRORS a desk's
  headed browser, display only · a file dialog that outlived its welcome ·
  the rail rebuilt whenever the chat moved. Plus a zero-dep CDP client with a
  tested frame codec, and markdown restored minus the heavy plugins.

## 0.5.12

- html/body/#root carry height 100%; the panes fill the viewport instead of
  ending at their content.

## 0.5.11

- react-resizable-panels v4 reads bare numbers as PIXELS: the desk rail was
  an 18px sliver. Sizes are percent strings now.

## 0.5.10

- The white page: PromptInputActionAddAttachments is a MENU ITEM and was
  placed outside its ActionMenu; Base UI threw invariant 36 and React
  unmounted everything. Found with the real browser over CDP, fixed to the
  element's own contract. Also: the Base UI render pattern where asChild was
  assumed, orientation instead of direction on the panel group, favicon
  served, and the headline token count no longer re-counts cache reads every
  turn (4295.9M was a lie; fresh input is the honest number).

## 0.5.9

- All nine of the owner's orders: /board removed (the chat is the only page,
  404 elsewhere) · panes told apart by tone, not gray lines · three resizable
  panes with min/max · the rail is a tabs menu (workspace / scratchpad) · runs
  of tool calls fold into one Task, expandable · the prompt is the full
  element (image attachments upload into the desk's scratchpad and the PATH
  is typed into the terminal, a /commands menu lists the desk's real slash
  commands) · a Computer tab shows the desk's HEADED browser through its own
  CDP DevTools page (9222, the live account browser, is refused by name) ·
  images in transcripts render, base64 and pasted-path both.

## 0.5.8

- The workspace tree walks breadth-first with a per-directory cap: one fat
  directory (bk/ holds every retired desk) was eating the whole entry budget
  and starving its siblings out of the tree.
- Conversation gap 8 -> 2; a transcript is a dialogue, not a gallery.

## 0.5.7

- Messages render markdown through the registry renderer, minus its two heavy
  plugins (code highlighting and mermaid): markdown yes, 400 grammars no.
- The rail shows the session's WORKING folder as a FileTree above the
  scratchpad: the desk's own tree, and the repo root for the lead, whose desk
  IS the root. Bounded in depth and entries on purpose.

## 0.5.6

- Every AI Element with corresponding data is on the page: thinking blocks
  render with Reasoning, tool calls with their parameters render with Tool,
  and the session folder is a real FileTree. index.html ships no-store so an
  open tab cannot keep yesterday's UI.

## 0.5.5

- The chat is the REAL components now: shadcn/ui plus AI Elements
  (Conversation, Message, PromptInput) from their registries, composed in one
  App.tsx that only wires our /api data. Built once by the maintainer, shipped
  as 440 KB of static files; users still build nothing. The registry's
  markdown pipeline (streamdown/shiki, 400 grammars, 14 MB) was trimmed out
  with the reason written in the component.

## 0.5.4

- The folder rail is tied to the SAME session as the conversation, by session
  id. Newest-tmp-dir repeated the robot bug on the tmp side: an SDK run's
  empty scratchpad out-mtimed the lead's working one.

## 0.5.3

- The chat answers at /, the table at /board; sidebar rows carry turns and
  tokens; the session picker prefers a human (cli) session over subagent and
  SDK transcripts sharing the project directory.
- A right rail shows the selected session’s folder — its native scratchpad —
  live, with sizes and ages.

## 0.5.1

- `/desk-board` is now one word to a working dashboard: it reuses a board
  that is already up, starts one detached if not, and opens the chat view in
  the browser itself instead of printing a URL to copy.

## 0.5.0

- **The chat view.** `/chat` on the board: every desk in a sidebar, the lead
  included, with its live transcript rendered as a conversation and refreshed
  as it moves. A send box types straight into the desk's real terminal through
  the orca CLI where that host has it; anywhere else the board says read-only
  in plain words instead of pretending.
- **The README speaks guidance now.** Install is two lines and a friendly
  note; the war stories moved to where they belong (CLAUDE.md, the changelog,
  the code). Owner's ruling: positive and guiding, warnings only where they
  change what you do.
- **CI caught a real flake on its first week.** The worktop fixture created
  two directories in the same millisecond and trusted mtime to order them:
  green locally by luck, red on ubuntu by the same luck. The fixture rigs its
  clocks now.
- 110 → 116 tests.

## 0.4.0

- **The board.** `/desk-board` serves the office on one read-only localhost
  page: every desk's kind, live status, model, turns, token usage, last
  activity and worktop (the session's native Claude Code scratchpad), plus the
  full checks board. Owner's ruling overturned "no UI, no server"; what
  survives is that doctrine's reason, now stated on the page itself: the board
  cannot know something `checks/run.mjs` does not. Loopback only, stateless,
  no dollars — a hand-synced price table would be wrong by the next model.
- **The command guard refused the new kind of command, and the guard was
  fixed, not dodged.** Its pattern hardcoded `hire()|fire()` as the only
  guarded entries — the third occurrence of "a hand-written list does not
  cover the member added after it". The registry of acceptable entries is now
  stated once: a guarded lib call, or a shipped entry script.
- **CONTRIBUTING gains the rule for where a test belongs**: delete the
  business nouns — if the rule still means something it is the plugin's, if
  not it stays home.
- 103 → 110 tests.

## 0.3.0

Found by the first production repo to adopt the contract: seven desks, 2,500 tests,
five live customer channels. Every item below is a fault that deployment surfaced.

- ⛔ **The CLI audited whatever directory you were standing in.** `collect(root)`
  always took a root; the CLI never passed one, so `node checks/run.mjs <repo>`
  printed a clean board about your cwd. A bad path now refuses with exit 7 instead
  of answering about the wrong repo.
- **New check, `desk-literals`.** The adopting repo measured 67 of 145 root test
  files naming a live desk as a code literal; every desk it retired turned some of
  those into rot. A ratchet: pinned counts must EQUAL measured counts, both
  directions, so the number only moves down and improvements must be banked.
- **New check, `commit-convention`.** Conventional Commits (`feat:`, `fix:`,
  `chore:`, ...) audited from the commit that adds `conventions.json`, forward.
  One grammar, used twice: the history check and a `.githooks/commit-msg` gate.
  This repo adopted it in the same commit, so the gate covers its author.
- **The meta files a stranger looks for:** CONTRIBUTING.md (the convention and the
  release drill), SECURITY.md (no network, no secrets read, findings name locations
  never values), and CI that runs the suite and the checks on every push, because a
  green badge that only ran on the maintainer's machine is a stated number nobody
  measured.
- 87 → 103 tests.

## 0.2.4

- **A check could exist and never run.** `checks/run.mjs` registers each check by hand, so a
  file landing in `checks/` without a line there was silently inert while its own tests kept
  passing. Registration is now pinned in both directions.
- Audited every hardcoded list in the codebase after three faults turned out to be the same
  shape: a hand-written list does not cover the member added after it.
- Retired the superseded `the-wall.svg` diagram.

## 0.2.3

- **`/desk-try` pointed at no function.** It said "hire a desk for it" in prose, so a model
  following it assembled a desk by hand and skipped the name rules, the port check, the
  one-lead rule and the second-reader agreement about who may talk to a customer.
- The guard meant to catch that named two commands explicitly and could not see the third.
  It walks `commands/` now.

## 0.2.2

- Firing your last desk left the board reading "nothing was examined" — an alarm at somebody
  who had just followed the tool's own instructions. The verdict is unchanged (an empty walk
  is still UNKNOWN); the message now says when `bk/` shows it was deliberate.

## 0.2.1

- **`stated-numbers` applied to every project that used the plugin.** `hire()` creates
  `tests/desks/`, so a user got a permanent amber row about a test count they had never
  stated and could not state. A check the reader cannot satisfy teaches them to ignore amber.

## 0.2.0

⛔ **If you installed 0.1.0, you had none of the fixes below.** The plugin cache is keyed by
version and `plugin.json` still said 0.1.0, so `claude plugin update` answered "already at
the latest version" and delivered nothing.

- **Two readers must agree on a desk's kind.** The model reads the description; a keyword
  reader forms its own view; `hire` refuses when they differ or the description is ambiguous.
  That call decides who may talk to a customer.
- **Firing the same name twice in a day could destroy the first archive.** It threw
  `ENOTEMPTY` here, which was luck: on a filesystem where rename onto an existing directory
  succeeds, the earlier archive would have gone silently.
- **One malformed `desk.json` blinded every check** — three UNKNOWNs while healthy desks went
  unexamined.
- **One fault produced six findings** across three checks. `desk-readable` owns that question
  now and the others stay quiet.
- `desk.json` and its folder must agree on the name.
- Desk names are capped at 40 characters. A 200-character one was accepted.
- Added `/desk-try`, `stray-writes`, `desk-readable`, `stated-numbers`.

## 0.1.0

First release. The desk contract with declared ports, the send wall checked in both
directions, `hire` and `fire`, and a `PreToolUse` gate that blocks rather than reports.

⚠️ **Hooks do not arm until Claude Code restarts.** Nothing in the install output says so,
and the obvious way to try a new plugin is to use it immediately.
