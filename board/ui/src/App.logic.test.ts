// The pure seams of the board's App, tested by name. Rendering behavior is
// walked by board/ui/e2e.mjs against the living office; these stay hermetic.
import { describe, expect, test } from 'vitest'
import { toBlocks, deskStatusLine, composerHint, rowLine, sentIn, type Msg } from './App'

const user = (text: string): Msg => ({ role: 'user', text })
const asst = (text: string, tools: { name: string; input: unknown }[] = []): Msg => ({ role: 'assistant', text, tools })

describe('toBlocks — the folding that keeps tool spam off the screen', () => {
  test('plain conversation stays one block per message', () => {
    const b = toBlocks([user('hi'), asst('hello')])
    expect(b.map((x) => x.kind)).toEqual(['msg', 'msg'])
  })

  test('a run of tool-only turns folds into ONE tools block', () => {
    const b = toBlocks([
      asst('', [{ name: 'Bash', input: {} }]),
      asst('', [{ name: 'Bash', input: {} }, { name: 'Read', input: {} }]),
    ])
    expect(b).toHaveLength(1)
    expect(b[0].kind).toBe('tools')
    expect(b[0].kind === 'tools' && b[0].tools).toHaveLength(3)
  })

  test('text between tool runs breaks the fold — order is preserved', () => {
    const b = toBlocks([
      asst('', [{ name: 'Bash', input: {} }]),
      asst('now the answer'),
      asst('', [{ name: 'Bash', input: {} }]),
    ])
    expect(b.map((x) => x.kind)).toEqual(['tools', 'msg', 'tools'])
  })

  test('a message carrying text AND tools yields the text then joins the fold', () => {
    const b = toBlocks([asst('working on it', [{ name: 'Bash', input: {} }]), asst('', [{ name: 'Bash', input: {} }])])
    expect(b.map((x) => x.kind)).toEqual(['msg', 'tools'])
    expect(b[1].kind === 'tools' && b[1].tools).toHaveLength(2)
  })

  test('reasoning is split out ahead of its message text', () => {
    const b = toBlocks([{ role: 'assistant', text: 'the answer', reasoning: 'thinking…' }])
    expect(b).toHaveLength(2)
    expect(b[0].kind === 'msg' && b[0].m.reasoning).toBe('thinking…')
    expect(b[1].kind === 'msg' && b[1].m.text).toBe('the answer')
  })

  test('an empty user message still shows — a user turn is never swallowed', () => {
    expect(toBlocks([user('')])).toHaveLength(1)
  })
})

describe('deskStatusLine — every live status the CLI writes, in its words', () => {
  test('waiting says on what; shell is a running command; unknown is said as-is', () => {
    expect(deskStatusLine({ state: 'waiting', detail: 'permission prompt' })).toBe('waiting on you · permission prompt')
    expect(deskStatusLine({ state: 'shell' })).toBe('running a command')
    expect(deskStatusLine({ state: 'working' })).toBe('working')
    expect(deskStatusLine({ state: 'idle' })).toBe('idle')
    expect(deskStatusLine({ state: 'parked' })).toBe('parked')
    expect(deskStatusLine({ online: false })).toBe('offline')
  })
})

describe('composerHint — the road a message takes, said before typing', () => {
  test('inbox, terminal, or the honest no', () => {
    expect(composerHint({ label: 'pricing', route: 'inbox' })).toMatch(/session inbox/)
    expect(composerHint({ label: 'pricing', route: 'terminal' })).toMatch(/terminal/)
    expect(composerHint({ label: 'pricing', route: null })).toMatch(/Claude app/)
  })
})

describe('rowLine — the sidebar always says what a desk is doing', () => {
  test('a working desk says its detail; waiting wins; nothing known still says something', () => {
    expect(rowLine({ state: 'working', busy: true, detail: 'writing a reply', activeMin: 0 })).toBe('Writing a reply')
    expect(rowLine({ state: 'working', busy: true, activeMin: 0 })).toBe('Working')
    expect(rowLine({ state: 'waiting', waiting: true, detail: 'plan approval', activeMin: 0 })).toBe('Waiting on you · plan approval')
    expect(rowLine({ state: 'idle', online: true, activeMin: 3 })).toBe('Idle')
    expect(rowLine({ online: false, activeMin: null })).toBe('Offline')
    expect(rowLine({ online: null, activeMin: 5 })).toBe('Idle')
    expect(rowLine({ online: null, activeMin: null })).toBe('No live session')
  })
})

describe('sentIn — a hand-off to another desk, lifted out of the tool run', () => {
  test('each SendMessage with words becomes one hand-off; "Done when" is read from the message', () => {
    const s = sentIn([
      { name: 'Read', input: { file_path: 'a' } },
      { name: 'SendMessage', input: { to: 'design', message: 'Redraw the upper at 32 in.\nDone when: four views are in the folder.' } },
      { name: 'SendMessage', input: { to: 'pricing', message: 'Reprice SO-1.' } },
      { name: 'SendMessage', input: { to: 'design' } },
    ])
    expect(s).toEqual([
      { to: 'design', text: 'Redraw the upper at 32 in.\nDone when: four views are in the folder.', doneWhen: 'four views are in the folder.' },
      { to: 'pricing', text: 'Reprice SO-1.', doneWhen: null },
    ])
  })
})
