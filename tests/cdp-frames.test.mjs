// The frame codec is the part that silently corrupts if wrong, so it is the
// part with tests. Network behavior is exercised against a real Chrome by the
// board itself; these stay hermetic.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildFrame, parseFrames } from '../lib/cdp.mjs'

const unmask = (frame) => {
  // a client frame is masked; decode it the way a server would
  const { frames } = parseFrames(frame)
  assert.equal(frames.length, 1)
  return frames[0]
}

test('a short frame round-trips', () => {
  const f = unmask(buildFrame('{"id":1}'))
  assert.equal(f.opcode, 1)
  assert.equal(f.payload.toString(), '{"id":1}')
})

test('a 16-bit-length frame round-trips at the boundary', () => {
  const text = 'x'.repeat(126)
  assert.equal(unmask(buildFrame(text)).payload.toString(), text)
})

test('a 64-bit-length frame round-trips (a screenshot is this size)', () => {
  const text = 'y'.repeat(70000)
  assert.equal(unmask(buildFrame(text)).payload.toString(), text)
})

test('a frame split across chunks yields nothing, then everything', () => {
  const whole = buildFrame('z'.repeat(300))
  const cut = 40
  const first = parseFrames(whole.slice(0, cut))
  assert.equal(first.frames.length, 0, 'half a frame is no frame')
  const second = parseFrames(Buffer.concat([first.rest, whole.slice(cut)]))
  assert.equal(second.frames.length, 1)
  assert.equal(second.frames[0].payload.length, 300)
})

test('two frames in one buffer both come out, in order', () => {
  const both = Buffer.concat([buildFrame('one'), buildFrame('two')])
  const { frames, rest } = parseFrames(both)
  assert.deepEqual(frames.map((f) => f.payload.toString()), ['one', 'two'])
  assert.equal(rest.length, 0)
})
