# Office-Anything

**Plug in and get an office.**

Hire AI staff for Claude Code, each with their own desk, their own browser, and no way to
reach what isn't theirs.

```
/desk-hire "someone who answers our Instagram DMs"

  reads it   →  kind: channel
  issues     →  its own folder, its own Chrome (headed, on its own declared port),
                a reader, a voice standard, a voice gate
  withholds  →  a sender. It starts dark.

  ⛔ chat: facts.md is still the stub. This desk knows nothing.
```

That last line is not a bug. **A new hire is not green.** It arrives with real files, real
headings and no content, and the checks say exactly what is missing. A generator that emits
a passing desk teaches you on day one that the gates are decoration.

---

## This is not another dashboard

It has no UI, no server, no database, and nothing to log into. There is nothing to watch.

It is also not another agent framework. It does not orchestrate, schedule, or route. It
**runs on Claude Code** and uses what is already there:

| Claude Code gives you | Office-Anything uses it for | ships? |
|---|---|---|
| hooks | a gate that BLOCKS the write, rather than asking the model nicely | ✅ |
| slash commands | `/desk-hire`, `/desk-fire` | ✅ |
| plugins | how all of it arrives, in one install | ✅ |
| subagents | the desks themselves. `hire` writes them into YOUR project | produced, not shipped |
| skills | nothing yet needs one. Two commands carry the workflow | ⛔ not yet |

⚠️ **That last column is there because this README lied about it.** It claimed all five and
shipped only commands. If a row ever goes green, it is because the directory exists.

Nothing here reimplements any of that. If you already use Claude Code, this is additive.

## The problem it actually solves

Everyone can spin up ten agents. The trouble starts after:

- the agent that knows your margins is one prompt away from telling a customer
- you cannot remove an agent without breaking three others that quietly depended on it
- your docs say you have six agents and nine are running
- every check is green because most of them never ran

Office-Anything is about **what each agent is allowed to hold**, and **how you remove one**.

## Install

```bash
/plugin install office-anything@office-anything
```

**Nothing happens.** No hooks fire, nothing blocks a commit. Every check answers
`applies()` before it answers anything else, and with no `desks/` directory there is nothing
to have an opinion about. It reports **not applicable** — which is deliberately not the same
as passing.

Then hire someone, and it switches on.

## The wall

A knowledge desk holds prices, margins, contracts. A channel desk talks to people. The wall
is that a knowledge desk **has no way to send** — the capability is absent, not disabled.

| issued | channel | knowledge | lead |
|---|---|---|---|
| its own browser, **headed** | ✅ | ⛔ | ✅ |
| a reader | ✅ | | |
| a voice gate | ✅ | | |
| **a sender** | only when live | ⛔ **never** | ⛔ never |
| the codebase-graph tool | | | ✅ lead only |

⛔ **Headed is about accounts, not about Chrome.** A desk browser holds a signed-in session
on a real site. If it acts where nobody can see it, the first evidence is what it did to a
real account. The incident behind this rule opened 19 threads in 81 seconds, and nobody
watched it happen.

⛔ **The wall is checked in both directions.** A missing sender on a live channel desk fails
as loudly as a present one on a knowledge desk. The first means a customer is being ignored;
the second means your margins have a route out. A one-directional version of this check
happily passes a team that cannot answer anybody.

⛔ **And the hire refuses to guess.** "quotes prices to customers" mentions both customers
and internal figures, so it returns **ambiguous** and asks. Counting keywords is not a basis
for deciding who may talk to a customer.

## Firing

`/desk-fire <name> --reason "..."` — the part nobody else ships. It **refuses** rather than
warns: a live desk, or one anything still references, does not get fired.

1. ⛔ **Close its session first.** A retired desk does not exit when its folder moves. Six
   were once reported up while nine were running — three retired desks were live and invisible.
2. ⛔ **Move any shared code it owned.** Removing one desk once broke nine test files at
   once, because it was quietly carrying a whole deliverable gate.
3. **Rehome its knowledge**, naming the successor, or it is lost.
4. **Reassign its open work**, or the board keeps a promise nobody holds.
5. **Archive to `bk/`.** Never delete.
6. **Delete its row from your docs.** Three removed desks stayed listed for a day, telling
   agents to go ask a desk that no longer existed.

The reason must be 20+ characters and it is recorded. **An override that is free to type
becomes boilerplate** — ask any team that added `--force` and then typed it into everything.

## The contract

```json
{ "name": "billing", "kind": "knowledge", "port": 9231, "live": false }
```

One file. The roster, the port map, the docs table and the tests all read it.

⛔ **Ports are declared, never derived.** The system this came from allocated them by
position in a sorted list, so hiring `billing` silently renumbered every desk sorting after
it — and firing one did the same in reverse. Four separate incidents. Two desks claiming one
port is now a test failure naming both.

## The rules

- **A check that reports is not a gate.** If it matters, it exits non-zero.
- **An empty walk is UNKNOWN, never clean.** A checker that examined nothing has not passed.
- **A test that has never failed has never been checked.**

```bash
node --test "tests/**/*.test.mjs"     # 49 tests
```

Then go break something and watch them go red. They were verified that way, not assumed to
work: sabotaging the send wall to always return 0 turns four of them red.

## Status

Early and honest about it. The contract, hire, fire, the send wall and the unfinished check
are real and run. MIT.
