# board/ — the office on one page. What each file ANSWERS, one row each.

| file | answers |
|---|---|
| `serve.mjs` | every route. Serves the built UI, `/api/*` for office, transcript, send, hire, upload, screen, commands, files. Loopback only |
| `read.mjs` | who is in the office and what surrounds them: roster rows, transcript stats, worktop, workspace tree, live subagents |
| `transcript.mjs` | a session's jsonl as chat: incremental tail reader (62 MB re-reads froze the board once), message/system/image classification |
| `send.mjs` | the ONE path characters enter a desk terminal from here: the orca CLI, or read-only with the reason said plainly |
| `chat-page.mjs` | RETIRED to bk/ — the hand-rolled page the real component build replaced |
| `ui/` | the React app: shadcn/ui + AI Elements, built by the maintainer, shipped as `ui/dist`. `ui/e2e.mjs` walks it hit-tested |
| `../lib/cdp.mjs` | the zero-dep CDP client behind `/api/screen`: frame codec unit-tested, display only |
| `../lib/rates.mjs` | the ONE owner of price arithmetic; unknown model = no dollars; AS_OF rides every figure |

Rules the board lives by: it may not know anything `checks/run.mjs` does not ·
system traffic renders as events, not as the owner speaking XML · dollars
always carry their as-of date · port 9222 is refused by name.
