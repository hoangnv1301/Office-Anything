// THE CREDENTIAL PATTERNS, ONE COPY (moved out of hooks/no-secrets.mjs unchanged, which re-exports them): lib/ and board/
// ship without hooks/ in some copies, so lib code that must refuse a credential imports them from here.

// ⛔ PATTERNS THAT ARE ACTUAL CREDENTIALS, not words that merely look alarming. A matcher
// that fires on the word "password" in prose gets disabled within a day, and then it is
// not protecting anything. Every entry here matches a real key's SHAPE.
export const SECRETS = [
  ['AWS access key',    /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token',      /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['Anthropic key',     /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI key',        /\bsk-[A-Za-z0-9]{32,}\b/],
  ['Google API key',    /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Slack token',       /\bxox[baprs]-[0-9A-Za-z-]{10,}/],
  ['Stripe key',        /\b[rs]k_(live|test)_[0-9A-Za-z]{20,}\b/],
  ['private key',       /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/],
  ['JWT',               /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['assigned secret',   /\b(api[_-]?key|secret|passwd|password|token|bearer)\s*[:=]\s*["'][^"'\s]{12,}["']/i],
  ['connection string', /\b(postgres|mysql|mongodb(\+srv)?):\/\/[^\s:]+:[^\s@]+@/],
]

// ⛔ A .env IS A CREDENTIAL FILE WHATEVER IS IN IT TODAY. This repo's parent learned it the
// hard way: .gitignore said `.env` and a file called `.env.bak.2026-08-22` walked straight
// past it carrying a live token. Match the SHAPE of the name, not one exact spelling.
export const CREDENTIAL_FILENAMES =
  /(^|\/)(\.env($|[.\w-]*)|.*\.env|id_rsa|id_ed25519|.*\.pem|.*\.p12|.*\.pfx|credentials\.json|service-account.*\.json)$/i

export function scanText(text, path = '') {
  const out = []
  if (CREDENTIAL_FILENAMES.test(path)) {
    out.push({ path, what: 'a credential FILE by its name', sample: '' })
  }
  for (const [what, re] of SECRETS) {
    const m = text.match(re)
    // Never print the whole secret. A leak report that quotes the key is a second leak.
    if (m) out.push({ path, what, sample: `${m[0].slice(0, 10)}...` })
  }
  return out
}

