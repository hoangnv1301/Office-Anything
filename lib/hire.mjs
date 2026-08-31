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

export function hire(root, { name, kind, description = '', now = () => Date.now() }) {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error(`"${name}" is not a desk name. Lowercase letters, digits and hyphens, starting with a letter.`)
  }
  if (!KINDS.includes(kind)) throw new Error(`kind must be one of ${KINDS.join(', ')}`)

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
