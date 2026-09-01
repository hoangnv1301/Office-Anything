// FIRE. The part nobody else ships.
//
// ⛔ FIRING IS NOT DELETING A FOLDER. Every step below exists because skipping it broke
// something real in the system this came from. The order matters, and step 1 matters most.
import { existsSync, renameSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { roster, readDesk } from './desk.mjs'

// ⛔ THE CHECKLIST IS DATA, NOT PROSE, so it can be executed and so a skipped step is
// visible rather than forgotten. Each carries the scar that put it here.
export const STEPS = [
  { id: 'session',  auto: false, say: 'Close its running session FIRST.',
    why: 'A retired desk does NOT exit when its folder moves. Six were once reported up while nine were running: three retired desks were live, acting, and invisible to the thing counting them.' },
  { id: 'shared',   auto: false, say: 'Move any shared code it owned to a neutral home.',
    why: 'Removing one desk once broke nine test files at once, because it was quietly carrying a whole deliverable gate. A desk owning shared code is a desk you cannot remove cleanly.' },
  { id: 'knowledge',auto: false, say: 'Rehome its knowledge, naming the successor.',
    why: 'A folded desk\'s facts have an owner or they are lost. "Somebody will remember" is not an owner.' },
  { id: 'work',     auto: false, say: 'Reassign its open work.',
    why: 'Otherwise the board keeps a promise nobody holds, and it reads as done.' },
  { id: 'archive',  auto: true,  say: 'Move the folder to bk/, never delete it.',
    why: 'You will want to read it again. Every removal in the source system is still on disk.' },
  { id: 'docs',     auto: false, say: 'Delete its row from your docs.',
    why: 'Three removed desks stayed listed for a day: a doc telling an agent to go ask a desk that no longer exists.' },
]

// ⛔ REFUSES RATHER THAN WARNS. A fire that proceeds past a blocker with a printed warning
// is a fire that took the folder off disk while something still pointed at it.
export function blockers(root, name) {
  const out = []
  const dir = join(root, 'desks', name)
  if (!existsSync(dir)) return [{ id: 'missing', say: `desks/${name} does not exist` }]

  const desk = readDesk(dir)
  if (desk?.live) {
    out.push({ id: 'live', say: `${name} is LIVE. Take it dark first, deliberately, and let anyone mid-conversation finish.` })
  }

  // Does anything still name this desk? A dangling reference outlives the folder.
  const refs = []
  const walk = (d, depth = 0) => {
    if (depth > 4) return
    let entries = []
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (['.git', 'node_modules', 'bk', 'desks'].includes(e.name)) continue
      const p = join(d, e.name)
      if (e.isDirectory()) { walk(p, depth + 1); continue }
      if (!/\.(md|mjs|js|ts|json)$/.test(e.name)) continue
      try {
        if (new RegExp(`\\b${name}\\b`).test(readFileSync(p, 'utf8'))) refs.push(p.slice(root.length + 1))
      } catch {}
    }
  }
  walk(root)
  if (refs.length) {
    out.push({ id: 'referenced', say: `${refs.length} file(s) still name ${name}`, files: refs.slice(0, 8) })
  }
  return out
}

export function fire(root, name, { reason, date = '0000-00-00', force = false } = {}) {
  // ⛔ AN OVERRIDE MUST COST SOMETHING. A reason that is free to type becomes boilerplate:
  // the system this came from had one, it cost nothing, and it got typed into every command
  // for a day while the gate it bypassed printed the count in the author's face.
  if (!reason || reason.trim().length < 20) {
    throw new Error('firing needs a --reason of at least 20 characters, and it is recorded')
  }
  const stop = blockers(root, name)
  if (stop.length && !force) {
    const e = new Error(`refusing to fire ${name}: ${stop.map(s => s.say).join('; ')}`)
    e.blockers = stop
    throw e
  }

  const from = join(root, 'desks', name)
  mkdirSync(join(root, 'bk'), { recursive: true })

  // ⛔ NEVER OVERWRITE AN ARCHIVE. Hiring a name, firing it, hiring it again and firing it
  // the same day produced a raw ENOTEMPTY here. That was the good outcome: on a filesystem
  // where rename onto an existing directory succeeds, the FIRST archive would have been
  // destroyed silently. An archive is the only copy of a desk that ever existed, and this
  // whole command exists so that removal is not a deletion.
  let to = join(root, 'bk', `${date}-${name}-removed`)
  for (let n = 2; existsSync(to); n++) to = join(root, 'bk', `${date}-${name}-removed-${n}`)
  renameSync(from, to)

  return {
    name, movedTo: to.slice(root.length + 1), reason,
    remaining: STEPS.filter(s => !s.auto),
    stillReferenced: stop.find(s => s.id === 'referenced')?.files ?? [],
  }
}
