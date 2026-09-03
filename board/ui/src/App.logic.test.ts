// The pure seams of the board's App, tested by name. Rendering behavior is
// walked by board/ui/e2e.mjs against the living office; these stay hermetic.
import { describe, expect, test } from 'vitest'
import { toBlocks, type Msg } from './App'

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
