// MODEL RATES, $ per million tokens — the ONE owner of price arithmetic.
//
// ⛔ A HAND-SYNCED PRICE TABLE GOES STALE, and a wrong dollar is worse than a
// token count. Every consumer must show AS_OF beside any dollar figure, and an
// unknown model gets NO dollars — tokens only, never a guess. Rates from the
// claude-api reference (cached 2026-06-24). Cache read bills ~0.1x input;
// cache write ~1.25x input.
export const AS_OF = '2026-06-24'

const TABLE = [
  [/^claude-fable-5/, { input: 10, output: 50 }],
  [/^claude-mythos-5/, { input: 10, output: 50 }],
  [/^claude-opus-5/, { input: 5, output: 25 }],
  [/^claude-opus-4-[678]/, { input: 5, output: 25 }],
  [/^claude-sonnet-5/, { input: 2, output: 10 }],
  [/^claude-sonnet-4-6/, { input: 3, output: 15 }],
  [/^claude-haiku-4-5/, { input: 1, output: 5 }],
]

export function ratesFor(model) {
  for (const [re, r] of TABLE) if (re.test(model ?? '')) return r
  return null
}

export function costOf({ model, input = 0, output = 0, cacheRead = 0, cacheWrite = 0 }) {
  const r = ratesFor(model)
  if (!r) return null
  const M = 1e6
  const rows = {
    input: (input / M) * r.input,
    output: (output / M) * r.output,
    cacheRead: (cacheRead / M) * r.input * 0.1,
    cacheWrite: (cacheWrite / M) * r.input * 1.25,
  }
  return { ...rows, total: rows.input + rows.output + rows.cacheRead + rows.cacheWrite, asOf: AS_OF }
}
