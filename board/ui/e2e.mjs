// THE BOARD'S END-TO-END RIG. Run against a live board and a headed Chrome:
//   node board/ui/e2e.mjs        (board on 7719, lead Chrome CDP on 9229)
// Nine functions, each measured against a threshold with REAL, hit-tested
// input. Not part of `node --test`: it needs a living office to walk through.
// THE LEAD'S OWN END-TO-END. Each function measured against a threshold in the
// real page; a miss is a named FAIL, never a shrug.
import WebSocket from 'ws'
import { writeFileSync } from 'node:fs'

const THRESH_MS = 6000
// ⛔ NEVER Page.reload OVER CDP: on this Chrome, hit-tested Input events stop
// reaching the page after a session-driven reload (isolated by probe3). A
// fresh tab per run gets a fresh target where real input works, and the tab
// is closed on the way out.
const page = await (await fetch('http://127.0.0.1:9229/json/new?' + encodeURIComponent('http://127.0.0.1:7719/'), { method: 'PUT' })).json()
await new Promise(r => setTimeout(r, 4500))
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 })
// ⛔ THE FIRST VERSION SLEPT A FIXED 150ms AND READ WHATEVER HAD ARRIVED.
// All eight checks "failed" as undefined, which was the RIG lagging, not the
// app. A measurement that cannot tell its own latency from the subject's is
// worse than none: every reply is awaited by id now.
const pending = new Map()
let idc = 10
ws.on('message', (d) => { const j = JSON.parse(d); if (j.id && pending.has(j.id)) { pending.get(j.id)(j); pending.delete(j.id) } })
await new Promise(r => ws.on('open', r))
const call = (m, p = {}) => new Promise((res) => { const id = ++idc; pending.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })) })
const send = (m, p = {}) => { call(m, p); return 0 }
const evalJs = async (expr) => (await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.result?.value
const until = async (expr, ms = THRESH_MS, step = 350) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const v = await evalJs(expr)
    if (v) return { ok: true, ms: Date.now() - t0, v }
    await new Promise(r => setTimeout(r, step))
  }
  return { ok: false, ms: Date.now() - t0 }
}
const shot = async (name) => {
  const b64 = (await call('Page.captureScreenshot', { format: 'png' }))?.result?.data
  if (b64) writeFileSync('/tmp/e2e-' + name + '.png', Buffer.from(b64, 'base64'))
}
const click = async (selectorExpr) => evalJs(`(()=>{const el=${selectorExpr}; if(!el) return false; el.click(); return true})()`)
// ⛔ HIT-TESTED INPUT ONLY. Synthetic dispatch bypasses hit-testing, so a rig
// using it keeps "passing" clicks a human cannot make — it spent twenty
// minutes clicking through an open modal without noticing. CDP Input events
// go through Chrome's real pipeline: what they hit is what a user hits.
const mouseClick = async (selectorExpr) => {
  const box = await evalJs(`(()=>{const el=${selectorExpr}; if(!el) return null; el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)}})()`)
  if (!box) return false
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y })
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1, pointerType: 'mouse' })
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1, pointerType: 'mouse' })
  return true
}

const results = []
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? ' ok  ' : ' ⛔  ') + name + '  ' + (detail ?? '')) }

await call('Page.enable')

// 1. chat renders within threshold
const chat = await until(`document.querySelectorAll('[class*=is-user],[class*=is-assistant]').length > 0`)
check('chat renders < ' + THRESH_MS + 'ms', chat.ok, chat.ms + 'ms')

// 2. markdown really renders (a <strong> exists inside a bubble)
check('markdown renders', !!(await evalJs(`!!document.querySelector('[class*=is-assistant] strong, [class*=is-assistant] code')`)))

// 3. images in chat
const imgCount = await evalJs(`document.querySelectorAll('#root img').length`)
const imgLoaded = await evalJs(`[...document.querySelectorAll('#root img')].filter(i=>i.complete&&i.naturalWidth>0).length`)
check('images present and LOADED', imgCount > 0 && imgLoaded > 0, imgLoaded + '/' + imgCount + ' loaded')

// 4. tool runs folded
check('tool runs folded into Task rows', (await evalJs(`[...document.querySelectorAll('button,div')].filter(b=>/tool calls? —/.test(b.textContent)).length`)) > 0)

// 5. workspace tree renders and a FILE CLICK opens the dialog with content
await mouseClick(`[...document.querySelectorAll('[role=tab]')].find(t=>t.textContent==='workspace')`)
const tree = await until(`document.querySelectorAll('[data-rail="files"] [class*=cursor-pointer]').length > 3`)
check('workspace tree renders', tree.ok, tree.ms + 'ms')
// ⛔ Scoped to the RAIL: unscoped, cursor-pointer also matched chat Task rows,
// and a conversation that MENTIONS CLAUDE.md stole the click. The matcher
// disease again, in the rig itself.
// ⚠️ KNOWN RIG QUIRK, logged honestly: hit-tested Input clicks on the rail
// work when the page has been interacted with, but the first ones after
// Page.reload never reach React here, while the identical probe without a
// reload opens the dialog in 0.8s every time. App behavior is proven by that
// probe and by a human screenshot; the rig uses component-level events for
// THIS step and still asserts the full fetch->dialog pipeline.
const synth = async (sel) => evalJs(`(()=>{const el=${sel}; if(!el)return false; for(const t of ['pointerdown','mousedown','pointerup','mouseup','click']) el.dispatchEvent(new (t.startsWith('pointer')?PointerEvent:MouseEvent)(t,{bubbles:true,cancelable:true})); return true})()`)
const clicked = await mouseClick(`[...document.querySelectorAll('[data-rail="files"] [class*="cursor-pointer"]')].find(el=>el.textContent.trim()==='CLAUDE.md')`)
let dialog = await until(`(()=>{const d=document.querySelector('[role=dialog]'); return d && d.innerText.length > 200})()`, 3000)
let retried = false
if (clicked && !dialog.ok) {   // a user would click again; the retry is REPORTED, never hidden
  retried = true
  await mouseClick(`[...document.querySelectorAll('[data-rail="files"] [class*="cursor-pointer"]')].find(el=>el.textContent.trim()==='CLAUDE.md')`)
  dialog = await until(`(()=>{const d=document.querySelector('[role=dialog]'); return d && d.innerText.length > 200})()`, 3000)
}
if (!dialog.ok) console.log('   diag:', await evalJs(`JSON.stringify({dlg: !!document.querySelector('[role=dialog]'), len: document.querySelector('[role=dialog]')?.innerText?.length ?? 0, wsfile: performance.getEntriesByType('resource').filter(r=>r.name.includes('wsfile')).length, sel: window.getSelection()?.toString()?.length ?? 0, hit: document.elementFromPoint(1068,518)?.tagName})`))
check('file click opens dialog with content', clicked && dialog.ok, 'clicked=' + clicked + (retried ? ' RETRIED' : '') + ' ' + dialog.ms + 'ms')
await shot('file-dialog')
// ⛔ A MODAL LEFT OPEN INVALIDATES EVERY LATER STEP: synthetic events bypass
// hit-testing, so the rig would keep "passing" clicks a real user cannot make.
// Close with a real Escape and ASSERT it closed.
await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 20, y: 500, button: 'left', clickCount: 1 })
await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 20, y: 500, button: 'left', clickCount: 1 })
const closed = await until(`!document.querySelector('[role=dialog]')`, 3000)
check('file dialog dismisses (outside pointer)', closed.ok, closed.ms + 'ms')

// 6. desk switch updates the header
await mouseClick(`[...document.querySelectorAll('button')].find(b=>/design/.test(b.textContent))`)
const switched = await until(`document.querySelector('header')?.innerText.includes('design')`)
check('desk switch updates pane', switched.ok, switched.ms + 'ms')

// 7. computer tab answers (stream or an honest why)
await mouseClick(`[...document.querySelectorAll('[role=tab]')].find(t=>t.textContent==='Computer')`)
// ⛔ STRICT: the default placeholder text must not count as a pass. If the
// desk's screen endpoint answers 200, only a LOADED mirror image passes.
const screenUp = (await fetch('http://127.0.0.1:7719/api/screen?key=' + encodeURIComponent(await evalJs(`window.__selKey ?? ''`) || '-Volumes-Extreme-SSD-external-workspace-alibaba-store-diagnost-ai-alibaba-claude-runbook-v2-desks-design'))).status === 200
const computer = screenUp
  ? await until(`(()=>{const img=document.querySelector('img[alt="desk browser display"]'); return img&&img.complete&&img.naturalWidth>0 ? 'mirror' : false})()`, 12000)
  : await until(`/no headed browser|no browser to show/.test(document.body.innerText)`, 6000)
check('computer tab shows the MIRROR when a browser is up', computer.ok, String(computer.v ?? 'why') + ' ' + computer.ms + 'ms')
await shot('computer')

// 8. back to lead + chat for the closing screenshot
await mouseClick(`[...document.querySelectorAll('[role=tab]')].find(t=>t.textContent==='Chat')`)
await mouseClick(`[...document.querySelectorAll('button')].find(b=>/team-lead/.test(b.textContent))`)
await new Promise(r => setTimeout(r, 3000))
await shot('final')

console.log('---'); console.log(results.filter(r => !r.ok).length + ' FAIL of ' + results.length)
ws.close()
await fetch('http://127.0.0.1:9229/json/close/' + page.id).catch(() => {})
