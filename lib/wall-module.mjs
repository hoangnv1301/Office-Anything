// THE OFFICE'S OWN WALL MODULE, RUN WHERE IT CANNOT HOLD THE WALL HOSTAGE.
//
// office.json "wall.module" is code the plugin did not write. If it throws,
// the wall must not read that as "nothing to refuse"; if it never returns, the
// wall must not wait forever, and it must not count on Claude Code's hook
// timeout to block the call for it.
// A timer in the same thread cannot interrupt a synchronous loop, so the
// module runs in a worker thread, and the wall terminates it at its own
// deadline. Every failure surfaces as a thrown error, and the caller decides
// (the desk wall denies: failClosed is its default).
import { Worker } from 'node:worker_threads'
import { pathToFileURL } from 'node:url'

// 5 s: at 2 s about 1 call in 1,000 missed it on a machine at load 25-30
// (a worker's own start is most of it), and each miss refused a desk
export const MODULE_DEADLINE_MS = 5000

const WORKER = `
const { parentPort, workerData } = require('node:worker_threads')
let mod = null
parentPort.on('message', async ({ id, fn, args }) => {
  try {
    mod ??= await import(workerData.url)
    const f = mod[fn]
    const value = typeof f === 'function' ? await f(...args) : null
    parentPort.postMessage({ id, ok: true, value: value ?? null })
  } catch (e) {
    parentPort.postMessage({ id, ok: false, error: String(e?.message ?? e) })
  }
})
`

// -> { call(fn, ...args) -> Promise<value>, close() }. One deadline for the
// whole session of calls, so two calls cannot each take the full allowance.
export function openModule(file, { deadlineMs = MODULE_DEADLINE_MS } = {}) {
  const w = new Worker(WORKER, { eval: true, workerData: { url: pathToFileURL(file).href } })
  const pending = new Map()
  let seq = 0, dead = null
  const fail = (why) => { dead ??= why; for (const { reject } of pending.values()) reject(new Error(dead)); pending.clear() }
  const timer = setTimeout(() => { fail(`the office's wall module did not answer within ${deadlineMs} ms`); w.terminate() }, deadlineMs)
  w.on('message', ({ id, ok, value, error }) => {
    const p = pending.get(id); if (!p) return
    pending.delete(id)
    ok ? p.resolve(value) : p.reject(new Error(`the office's wall module threw: ${error}`))
  })
  w.on('error', (e) => fail(`the office's wall module failed: ${e.message}`))
  w.on('exit', () => fail('the office\'s wall module stopped'))
  return {
    call: (fn, ...args) => new Promise((resolve, reject) => {
      if (dead) return reject(new Error(dead))
      const id = ++seq
      pending.set(id, { resolve, reject })
      // payloads are JSON: a structured-clone failure is a module failure too
      try { w.postMessage({ id, fn, args: JSON.parse(JSON.stringify(args)) }) } catch (e) { pending.delete(id); reject(e) }
    }),
    close: () => { clearTimeout(timer); w.terminate() },
  }
}
