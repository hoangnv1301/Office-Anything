# remit

**You hire a desk. You fire a desk.** An AI workforce where every role is a folder, every
role has a boundary, and the boundaries are enforced by things that exit non-zero.

```
/desk hire "someone who answers our Instagram DMs"

  reads it   ->  kind: channel
  issues     ->  a folder, its own Chrome (headed, on its own declared port),
                 a reader, a voice standard, a voice gate
  withholds  ->  a sender. It starts dark.

  3 checks now name this desk and go red.
```

That last line is not a bug. **A new hire is not green.** It arrives with real files, real
headings and no content, and the checks say exactly what is missing. A generator that emits
a passing desk teaches you on day one that the gates are decoration.

## Why this exists

Plenty of projects give you a team of agents. This one is about the part that comes after:
what each agent is **allowed to hold**, and how you **remove one** without breaking the rest.

Every rule here is in the repo because skipping it broke something real.

## Install

```bash
/plugin install remit@remit
```

**Nothing happens.** No hooks fire, no checks run, nothing blocks a commit. Every check
answers `applies()` before it answers anything else, and with no `desks/` directory there is
nothing to have an opinion about. It reports **not applicable**, which is deliberately not
the same as passing.

Then hire someone, and it all switches on.

## The wall

A knowledge desk holds the things you would never want sent: prices, margins, contracts. A
channel desk talks to people. The wall is that a knowledge desk **has no way to send** — the
capability is absent, not disabled.

| issued | channel | knowledge | lead |
|---|---|---|---|
| its own browser, **headed** | ✅ | ⛔ | ✅ |
| a reader | ✅ | | |
| a voice gate | ✅ | | |
| **a sender** | only when live | ⛔ **never** | ⛔ never |
| the codebase-graph tool | | | ✅ lead only |

⛔ **Headed is about accounts, not about Chrome.** A desk browser holds a signed-in session
on a real site. If it acts where nobody can see it, the first evidence is what it did to a
real account. One incident behind this rule opened 19 threads in 81 seconds and nobody
watched it happen.

⛔ **And the wall is checked in both directions.** A missing sender on a live channel desk
fails just as loudly as a present one on a knowledge desk. The first means a customer is
being ignored; the second means your margins have a route out. A one-directional version of
this check happily passes a team that cannot answer anybody.

## Firing

`/desk fire <name> --reason "..."` — the part nobody else ships. Seven steps, each one
written because skipping it broke something:

1. ⛔ **Close its session first.** A retired desk does not exit when its folder moves. Six
   were once reported up while nine were running; three retired desks were live and invisible.
2. **Move the folder to `bk/`.** Never delete.
3. **Rehome its knowledge**, by name, or it is lost.
4. ⛔ **Move any shared code it owned.** Removing one desk once broke nine test files at
   once, because it was quietly carrying a whole deliverable gate.
5. **Reassign its open work.**
6. **Delete its row from the docs.** Three removed desks stayed listed for a day, telling
   agents to ask a desk that was gone.
7. **Free its port** — and nobody gets renumbered, because ports are declared.

## The contract

```json
{ "name": "billing", "kind": "knowledge", "port": 9231, "live": false }
```

One file. The roster, the port map, the docs table and the tests all read it.

⛔ **Ports are declared, never derived.** The system this came from allocated them by
position in a sorted list, so hiring `billing` silently renumbered every desk sorting after
it, and firing one did the same in reverse. Four separate incidents. Two desks claiming one
port is now a test failure naming both.

## The rules that keep it honest

- **A check that reports is not a gate.** If it matters, it exits non-zero.
- **An override must cost something.** A free-to-type override becomes boilerplate. Ask any
  team that added `--force` and then typed it into everything for a day.
- **An empty walk is UNKNOWN, never clean.** A checker that examined nothing has not passed.
- **A test that has never failed has never been checked.** Break the guarantee, watch it go
  red, restore. Run `node --test "tests/**/*.test.mjs"` and then go sabotage something.

## Status

Early. The contract, the send wall and its tests are real and run. Hire and fire are
specified and landing next.

MIT.
