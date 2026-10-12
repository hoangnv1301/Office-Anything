// THE CONTEXT CAP PER SESSION: when Claude Code compacts on its own.
//
// office.json:
//   "context": { "capTokens": 700000, "lead": 700000, "teammates": 400000,
//                "perDesk": { "billing": 500000 } }
//
// A session started by the office gets CLAUDE_CODE_AUTO_COMPACT_WINDOW=<cap>
// on its command line (lib/start.mjs). Verified on Claude Code 2.1.289:
// /context on a 1M model reads "/ 700k" with it set; the autocompact buffer
// (33k) stays, so compaction comes at about cap - 33k. The variable "takes
// precedence" over the autoCompactWindow setting, so a desk's own
// .claude/settings.json can not raise it. Rollback: remove the key, restart
// that desk (/desk-start <desk>).
export const MIN_CAP = 50_000
export const MAX_CAP = 1_000_000

// -> the cap in tokens for one session, or null for none
export function contextCap(cfg, { desk = null, isLead = false, teammate = false } = {}) {
  const C = cfg?.context
  if (!C || typeof C !== 'object') return null
  const pick = isLead ? C.lead : teammate ? (C.teammates ?? C.perDesk?.[desk]) : C.perDesk?.[desk]
  const v = pick ?? C.capTokens
  if (v == null) return null
  if (!Number.isInteger(v) || v < MIN_CAP || v > MAX_CAP) throw new Error(`office.json context cap ${JSON.stringify(v)} is not a whole number of tokens between ${MIN_CAP} and ${MAX_CAP}`)
  return v
}
