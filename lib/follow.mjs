// FOLLOW-THROUGH: a case with a due time that nobody closes is rung again, then
// raised, instead of waiting in silence (Office-Anything #97, 2026-11-06).
//
// What it watches: tasks (lib/tasks.mjs) that carry a dueAt and are not final.
// Today those are asks between sessions (kind "ask"); release steps and blocks use the
// same sweep. One pass, run by heal (lib/heal.mjs: ONE writer per office, under its
// lock; the lead's bell only reads), takes at most ONE step per case:
//
//   due     dueAt has passed         ASK-DUE    NUDGE line for the lead to send to the assignee
//   rering  every reringMinutes, reringTimes times more      ASK-DUE again
//   lead    the rings did not help   ASK-LATE   raised to the lead
//   owner   ownerAfterMinutes past due, once       ASK-OWNER  one plain line for the owner
//
// ⛔ EVERY STEP IS AN EVENT IN tasks.jsonl, so a restart or a second pass never
// rings the same step twice, and a closed case (answered, verified, dropped) is never
// rung. The alerts reach the lead through the typed alert log its bell already reads.
//
// office.json "followThrough": { "reringMinutes": 15, "reringTimes": 2, "ownerAfterMinutes": 90 }
import { readOfficeConfig } from './office.mjs'
import { FINAL, ringsFor, canonName } from './tasks.mjs'
import { writeAlert } from './alerts.mjs'

export const FOLLOW_TYPES = ['ASK-DUE', 'ASK-LATE', 'ASK-OWNER']
const MIN = 60_000

export function followPolicy(cfg) {
  const F = cfg?.followThrough && typeof cfg.followThrough === 'object' ? cfg.followThrough : {}
  const num = (v, d, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)
  return { reringMinutes: num(F.reringMinutes, 15, 1, 24 * 60), reringTimes: num(F.reringTimes, 2, 0, 10), ownerAfterMinutes: num(F.ownerAfterMinutes, 90, 1, 7 * 24 * 60) }
}

// which step (if any) a case is owed now -> 'due' | 'rering' | 'lead' | 'owner' | null
export function nextStep(t, policy, now) {
  // 'done' is the assignee saying so: the stale-task road (checked within 6 h) asks the lead to verify it
  if (!t.dueAt || FINAL.has(t.state) || t.state === 'done' || now < t.dueAt) return null
  const has = (s) => t.rings.some((r) => r.stage === s)
  if (has('owner')) return null
  const ringsToAssignee = t.rings.filter((r) => r.stage === 'due' || r.stage === 'rering')
  const last = t.rings.reduce((a, r) => Math.max(a, r.at), 0)
  const spaced = now - last >= policy.reringMinutes * MIN
  const toLead = t.assigned === 'lead'          // its own lead is not raised to itself
  if (!ringsToAssignee.length) return 'due'
  if (ringsToAssignee.length <= policy.reringTimes) return spaced ? 'rering' : null
  if (!has('lead') && !toLead) return spaced ? 'lead' : null
  return now - t.dueAt >= policy.ownerAfterMinutes * MIN && spaced ? 'owner' : null
}

const quote = (s) => `"${String(s).slice(0, 140)}${String(s).length > 140 ? '…' : ''}"`
const mins = (ms) => { const m = Math.max(1, Math.round(ms / MIN)); return m < 90 ? `${m} minutes` : m < 36 * 60 ? `${Math.round(m / 60)} hours` : `${Math.round(m / 1440)} days` }
function say(t, step, now) {
  const waited = mins(now - t.created), to = t.assigned, from = t.from ?? 'someone'
  if (t.kind === 'ask') {
    if (step === 'due' || step === 'rering') return { type: 'ASK-DUE', text: `NUDGE ${to} ${t.id}: ${from} asked you ${quote(t.said)} ${waited} ago and has no answer. Answer it (node tasks.mjs answer ${t.id} --text "…") or message ${from} back.` }
    if (step === 'lead') return { type: 'ASK-LATE', text: `${to} has not answered ${from}'s ask ${t.id} after ${t.rings.length} rings (${waited}): ${quote(t.said)}. It needs the lead.` }
    return { type: 'ASK-OWNER', text: `${from} asked ${to} ${quote(t.said)} ${waited} ago, and nobody has answered. It needs you.` }
  }
  const what = `${t.title}${t.assigned ? ` (${t.assigned})` : ''}`
  if (step === 'due' || step === 'rering') return { type: 'ASK-DUE', text: `NUDGE ${to} ${t.id}: ${quote(what)} was due ${mins(now - t.dueAt)} ago. Finish it (update --state done with a note) or say what blocks it.` }
  if (step === 'lead') return { type: 'ASK-LATE', text: `${t.id} ${quote(what)} is ${mins(now - t.dueAt)} past due after ${t.rings.length} rings. It needs the lead.` }
  return { type: 'ASK-OWNER', text: `${quote(what)} is ${mins(now - t.dueAt)} past due and nobody has closed it. It needs you.` }
}

// One pass. Records each step (once) and writes its alert. -> [{ id, step, type, text }]
export function followThrough(root, cfg = readOfficeConfig(root), { now = Date.now() } = {}) {
  const policy = followPolicy(cfg)
  const acts = []
  // ⛔ THE ALERT IS WRITTEN BEFORE THE STEP IS MARKED RUNG. A failed write throws and leaves the step
  // unrecorded, so the next pass tries again; marking first would lose the ring for good.
  ringsFor(root, (tasks, ring) => {
    const emit = (t, step, text, type, subject, key = null) => {
      writeAlert(root, cfg, { type, kase: t.id, subject, text, now })
      ring(t.id, step, key)
      acts.push({ id: t.id, step, type, text, subject })
    }
    for (const t of tasks) {
      const step = nextStep(t, policy, now)
      if (!step) continue
      const m = say(t, step, now)
      emit(t, step, m.text, m.type, step === 'owner' ? 'owner' : canonName(root, t.assigned))
    }
  }, now)
  return acts
}
