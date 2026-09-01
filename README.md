# Office-Anything

A Claude Code plugin for hiring and firing AI agents. Each gets a desk, a browser, and
limits that are enforced, not suggested.

<p align="center">
  <img alt="tests" src="https://img.shields.io/badge/tests-80%20passing-3fb950">
  <img alt="dependencies" src="https://img.shields.io/badge/dependencies-0-3fb950">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-blue">
  <img alt="claude code" src="https://img.shields.io/badge/Claude%20Code-plugin-8957e5">
</p>

<p align="center">
  <img src="assets/the-office.svg" width="100%"
       alt="One Claude Code conversation becomes three desks. Each is its own agent with its own context: support gets a browser and can reply, pricing holds margins and has no way to send, the lead organizes and hires.">
</p>

<p align="center">
  <b><a href="https://hoangnv1301.github.io/Office-Anything/">See it work &rarr;</a></b><br>
  <sub>Pick a desk, try to give it a job that isn't its own, and watch it refuse.</sub>
</p>

## Install

```bash
/plugin install office-anything@office-anything
```

Nothing happens. No hooks fire, nothing blocks a commit, no files appear. With no `desks/`
directory there is nothing for it to have an opinion about, and it says "not applicable"
rather than showing you a row of green ticks that mean nothing.

⛔ **Restart Claude Code after installing.** Hooks are read when a session starts, so the
wall is not armed in the session you installed from. Everything else works immediately;
the gate does not. This is worth knowing because the obvious way to test a new plugin is
to try it straight away, and it will look like the wall does nothing.

Then hire someone, and it switches on.

## Hire someone

```
/desk-hire "someone who answers our Instagram DMs"
```

```
  reads it   →  kind: channel
  issues     →  a folder, its own Chrome, a reader, a voice standard
  withholds  →  a sender. It starts dark.

  ⛔ chat: facts.md is still the stub. This desk knows nothing.
```

**It fails on purpose.** A new desk really does know nothing yet, so it says so and tells
you what to write. Anything that hands you a finished-looking agent out of the box is
training you to stop reading its output.

## Try something without letting it in

You have a list of repos you want to try and no appetite for what they do to your setup.

```
/desk-try "that scraping library everyone keeps posting about"
```

It hires a desk for the trial, installs everything **inside that desk**, and writes down
what it brought. You talk to the desk about it, not to your main session, so it has its own
context and its own browser. When you are done, `/desk-fire` it and a check confirms it left
nothing behind:

```
⛔ 1 file(s) a desk brought in are living outside it
   some-scraper installed "cool-lib", which is at config/cool-lib.rc

   Firing that desk will not remove these.
```

⚠️ **What this is not.** A desk isolates a folder, a browser profile and an agent's context,
and it makes removal verifiable. It is not a sandbox and does not stop a determined script
writing where it likes. For genuinely untrusted code, use a container.

## Fire someone

```
/desk-fire chat --reason "the channel is being retired this quarter"
```

Firing is the part most setups skip, so removing an agent quietly breaks three others.
This refuses to do it badly. It will not fire a desk that is still live, or one that
anything else still references, and it archives rather than deletes.

It then hands you the steps no script can do for you: close its session, move any shared
code it owned, rehome its knowledge, reassign its open work, and take it out of your docs.

The reason is required and recorded. An override that costs nothing to type becomes
something you type into everything.

## The wall

Some agents should never be able to talk to a customer, no matter how the conversation
goes. A **knowledge** desk holds prices, margins and contracts. A **channel** desk talks to
people. The wall between them is that a knowledge desk has no way to send anything — the
capability is absent, not switched off.

| gets | channel | knowledge | lead |
|---|---|---|---|
| its own browser, visible on screen | ✅ | — | ✅ |
| a reader for its channel | ✅ | — | — |
| a voice standard it has to pass | ✅ | — | — |
| **a way to send** | only once you make it live | **never** | never |
| the codebase-graph tool | — | — | ✅ |

The wall is enforced by a hook, so it blocks the write instead of reporting it afterwards:

```
⛔ BLOCKED. pricing is a KNOWLEDGE desk and you are giving it a way to send.

If this desk genuinely needs to talk to people, it is the wrong kind. Change its
kind in desks/pricing/desk.json deliberately, where somebody reviews it.
```

It is checked both ways. A live channel desk with **no** way to send fails just as loudly,
because that means someone is being ignored.

And hiring refuses to guess. `"quotes prices to customers"` mentions both customers and
internal figures, so it stops and asks rather than picking one. Counting keywords is not a
way to decide who may talk to a customer.

## This is not another dashboard

No UI, no server, no database, nothing to log into. It is also not another agent framework:
it does not orchestrate, schedule or route. It runs on Claude Code and uses what is already
there.

| Claude Code gives you | used for |
|---|---|
| hooks | the gates that block a write |
| slash commands | `/desk-hire`, `/desk-fire` |
| plugins | how it all arrives, in one install |
| subagents | the desks themselves, written into **your** project |

If you already use Claude Code, this is additive. Nothing here reimplements any of it.

## Star history

<a href="https://star-history.com/#hoangnv1301/Office-Anything&Date">
  <img src="https://api.star-history.com/svg?repos=hoangnv1301/Office-Anything&type=Date" alt="Star history" width="600">
</a>
