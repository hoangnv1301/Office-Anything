// THE OFFICE'S OWN CONVERSATION: every desk-to-desk message, from the records
// both ends already keep. A message a desk SENT is a SendMessage call in its
// transcript; a message it RECEIVED is a peer bubble (a user entry or a queued
// command carrying the cross-session envelope). Nothing here is stored; the
// timeline is re-read from the transcripts every time.
//
// ⛔ AN ASK NOBODY ANSWERED IS THE THING THE OWNER NEEDS TO SEE. One desk asks
// another for an order id, the other is busy, and the work stops with nobody
// looking. "Unanswered" means: the newest message between two desks went from
// A to B, B has said nothing to A since, and the message ASKS something (a
// question, or a request). A closing "done, thanks" is the last word too, and
// flagging it would turn the marker into noise.
export const isAsk = (t) => /\?|\b(please|can you|could you|need(?:s|ed)? (?:you|your|the|a)|send (?:me|over|back)|let me know|confirm|waiting (?:on|for))\b/i.test(String(t ?? ''))

// One message seen from both ends (A's SendMessage and B's peer bubble) is one
// line: same pair, same opening words, within a few minutes.
const SAME_WINDOW_MS = 5 * 60 * 1000
const opening = (t) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)

// rows: [{ desk, messages }]; resolve(name) maps a session or desk name to a
// desk label of THIS office, or null for anything else (a subagent, "main",
// a session outside the office), which is not desk-to-desk traffic.
export function officeTimeline(rows, resolve, { limit = 120 } = {}) {
  const seen = []
  for (const { desk, messages } of rows) {
    for (const m of messages ?? []) {
      if (m.role === 'peer') {
        const from = resolve(m.from)
        if (from && from !== desk) seen.push({ from, to: desk, text: m.text ?? '', at: m.at ?? null })
      } else if (m.role === 'assistant') {
        for (const t of m.tools ?? []) {
          if (t.name !== 'SendMessage') continue
          const to = resolve(t.input?.to)
          const text = typeof t.input?.message === 'string' ? t.input.message : ''
          if (to && to !== desk && text) seen.push({ from: desk, to, text, at: m.at ?? null })
        }
      }
    }
  }
  const ms = (x) => (x.at ? Date.parse(x.at) : 0) || 0
  seen.sort((a, b) => ms(a) - ms(b))
  const out = []
  for (const x of seen) {
    const dup = out.some((y) => y.from === x.from && y.to === x.to && opening(y.text) === opening(x.text)
      && Math.abs(ms(y) - ms(x)) <= SAME_WINDOW_MS)
    if (!dup) out.push({ ...x, text: x.text.slice(0, 1200) })
  }
  // unanswered: the last word between a pair, when the receiver has not replied
  const lastByPair = new Map()
  out.forEach((x, i) => lastByPair.set([x.from, x.to].sort().join('\u0000'), i))
  for (const i of lastByPair.values()) if (isAsk(out[i].text)) out[i].unanswered = true
  return out.slice(-limit)
}
