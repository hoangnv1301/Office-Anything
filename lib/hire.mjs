// HIRE. You describe a role in a sentence; a desk turns up with exactly what that role
// is allowed to hold.
//
// ⛔ A NEW HIRE IS NOT GREEN, AND THAT IS THE POINT. Every stub below is a real file
// with a real heading and NO CONTENT, so the checks go red immediately and name what is
// missing. A generator that emits a passing desk teaches you on day one that the gates
// are decoration, and you will never trust a green board again.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { roster, nextFreePort, ISSUE, KINDS } from './desk.mjs'

// ⛔ INFERENCE IS A SUGGESTION, NEVER A DECISION. It returns its confidence and the words
// it matched, so the caller can disagree. A silent guess about whether a desk may talk to
// customers is the one guess this system must never make.
// ⛔ PLURALS MUST MATCH, and this cost a test to notice. `\bcustomer\b` does NOT match
// "customers", so the description "quotes prices to customers" scored ZERO channel
// signals and was about to be classified knowledge with confidence. The one word that
// should have forced a human decision was invisible to the matcher because it had an s
// on the end. Every noun below now takes an optional plural.
const SIGNALS = {
  channel: /\b(customers?|clients?|buyers?|visitors?|repl(y|ies)|inbox|dms?|messages?|chats?|emails?|mail|support|whatsapp|instagram|facebook|messenger)\b/gi,
  knowledge: /\b(prices?|pricing|quotes?|costs?|margins?|contracts?|catalogs?|catalogues?|specs?|inventory|stock|freight|calculat\w*|internal)\b/gi,
  lead: /\b(leads?|manag\w*|coordinat\w*|orchestrat\w*|organi[sz]\w*|oversees?|supervis\w*)\b/gi,
}

export function inferKind(description = '') {
  const hits = {}
  for (const [kind, re] of Object.entries(SIGNALS)) {
    hits[kind] = (description.match(re) ?? []).map(s => s.toLowerCase())
  }
  const ranked = Object.entries(hits).sort((a, b) => b[1].length - a[1].length)
  const [top, topHits] = ranked[0]
  const [, second] = ranked[1]

  if (!topHits.length) {
    return { kind: null, confidence: 'none', why: 'nothing in that description says what this desk talks to' }
  }
  // ⛔ ANY channel signal PLUS any knowledge signal IS AMBIGUOUS, whatever the counts.
  // Not a tie-break. The asymmetry is the reason: calling a knowledge desk a channel
  // hands it a browser and a route to customers, and "quotes prices to customers"
  // out-scores as knowledge 2-to-1 while describing something that plainly touches both.
  // Counting words is not a basis for deciding who may talk to a customer.
  if (hits.channel.length && hits.knowledge.length) {
    return {
      kind: null, confidence: 'ambiguous', hits,
      why: `mentions both customers and internal figures. Which one is this desk FOR?`,
    }
  }
  return {
    kind: top,
    confidence: topHits.length > second.length + 1 ? 'clear' : 'weak',
    why: `matched ${[...new Set(topHits)].map(w => `"${w}"`).join(', ')}`,
    hits,
  }
}

const STUB = {
  'CLAUDE.md': (n, k) => `# ${n}\n\nA ${k} desk.\n\n## Who you are\n\n## What you own\n\n## What you never do\n`,
  'facts.md': (n) => `# ${n} — what this desk knows\n\n⛔ Empty. Nothing here is true until somebody writes it.\n`,
}

// ⛔ TWO READERS MUST AGREE, AND NEITHER IS TRUSTED ALONE.
//
// "What does this description mean?" is a question only a model can answer; a keyword list
// cannot read intent, and pretending otherwise is how a desk that handles refunds gets
// classified as knowledge because it said "cost".
//
// But a model deciding alone is a single unchecked judgement about WHO MAY TALK TO A
// CUSTOMER, made in one pass, from one sentence. That is the highest-stakes call this tool
// makes and the one place a second opinion is worth its cost.
//
// So: the model passes in `kind`. The keyword reader forms its own view. They must agree,
// or the hire STOPS and shows both readings. Disagreement is not noise to be averaged; it
// is the signal that the description is doing two things at once.
export function agreeOnKind(modelKind, description) {
  const second = inferKind(description)

  if (second.confidence === 'ambiguous') {
    return { ok: false, why:
      `that description ${second.why} The model read it as "${modelKind}". Say which this desk is FOR, ` +
      `because the two answers give it very different access.` }
  }
  // No signal at all is not a disagreement. A short description like "handles refunds" may
  // be perfectly clear to a reader and contain none of the words this list knows.
  if (second.confidence === 'none') return { ok: true, agreed: modelKind, secondOpinion: 'no signal' }

  if (second.kind !== modelKind) {
    return { ok: false, why:
      `the model read this as "${modelKind}"; the words read as "${second.kind}" (${second.why}). ` +
      `One of those gives this desk a browser and a route to customers and the other does not. ` +
      `Rewrite the description so both readings agree, or set the kind explicitly.` }
  }
  return { ok: true, agreed: modelKind, secondOpinion: second.kind }
}

export function hire(root, { name, kind, description = '', agreed = null, now = () => Date.now() }) {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error(`"${name}" is not a desk name. Lowercase letters, digits and hyphens, starting with a letter.`)
  }
  if (!KINDS.includes(kind)) throw new Error(`kind must be one of ${KINDS.join(', ')}`)

  // ⛔ The agreement runs unless a caller has already run it and passed the result. A hire
  // that skips this is a hire where one reader decided customer access on its own.
  if (agreed !== true && description) {
    const check = agreeOnKind(kind, description)
    if (!check.ok) {
      const e = new Error(`refusing to hire ${name}: ${check.why}`)
      e.disagreement = check
      throw e
    }
  }

  const desksDir = join(root, 'desks')
  const dir = join(desksDir, name)
  if (existsSync(dir)) throw new Error(`desks/${name} already exists. Fire it first, or pick another name.`)

  const existing = roster(desksDir)
  if (kind === 'lead' && existing.some(d => d.kind === 'lead')) {
    throw new Error('there is already a lead. A second one means two desks think they own the team.')
  }
  const port = nextFreePort(existing)

  mkdirSync(dir, { recursive: true })
  const issued = ISSUE[kind]

  // ⛔ THE PORT IS WRITTEN DOWN, HERE, ONCE. It never moves again, so hiring the next
  // desk cannot renumber this one and firing it cannot renumber anybody else.
  writeFileSync(join(dir, 'desk.json'), JSON.stringify({
    name, kind, port, live: false, hired: now(), description,
  }, null, 2) + '\n')

  for (const [f, body] of Object.entries(STUB)) writeFileSync(join(dir, f), body(name, kind))
  mkdirSync(join(dir, 'runtime'), { recursive: true })
  writeFileSync(join(dir, 'runtime', 'CLAUDE.md'), `# ${name}/runtime\n\n| script | what it answers |\n|---|---|\n`)

  if (issued.reader) mkdirSync(join(dir, 'runtime', 'read'), { recursive: true })
  if (issued.voiceGate) mkdirSync(join(dir, 'runtime', 'voice'), { recursive: true })
  // ⛔ NO runtime/send/ IS CREATED, FOR ANY KIND. A channel desk gets one when it is made
  // live, which is a deliberate edit somebody reviews. A knowledge desk never gets one.

  mkdirSync(join(root, 'tests', 'desks'), { recursive: true })

  return {
    name, kind, port, dir,
    issued: Object.entries(issued).filter(([, v]) => v).map(([k, v]) => v === true ? k : `${k} (${v})`),
    withheld: Object.entries(issued).filter(([, v]) => v === false).map(([k]) => k),
  }
}
