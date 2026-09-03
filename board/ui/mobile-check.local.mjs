// Mobile pass: emulate a phone in a fresh tab, screenshot, count blockers.
import WebSocket from 'ws'
import { writeFileSync } from 'node:fs'
const page = await (await fetch('http://127.0.0.1:9229/json/new?' + encodeURIComponent('http://127.0.0.1:7719/'), { method: 'PUT' })).json()
await new Promise(r => setTimeout(r, 2000))
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 })
const pending = new Map(); let idc = 0
ws.on('message', (d) => { const j = JSON.parse(d); if (j.id && pending.has(j.id)) { pending.get(j.id)(j); pending.delete(j.id) } })
await new Promise(r => ws.on('open', r))
const call = (m, p = {}) => new Promise(res => { const id = ++idc; pending.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })) })
const ev = async (e) => (await call('Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.result?.value
await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
await new Promise(r => setTimeout(r, 3500))
console.log(await ev(`(() => {
  return JSON.stringify({
    hamburger: !!([...document.querySelectorAll('button')].find(b => b.textContent.trim() === '☰' && getComputedStyle(b).display !== 'none')),
    sidePanesHidden: [...document.querySelectorAll('[data-rail], [data-slot=resizable-panel]')].filter(p => getComputedStyle(p).display === 'none').length,
    hScroll: document.documentElement.scrollWidth > 395,
    composer: !!document.querySelector('textarea'),
    bubbles: document.querySelectorAll('[class*=is-user],[class*=is-assistant]').length,
  })
})()`)) 
const b64 = (await call('Page.captureScreenshot', { format: 'png' }))?.result?.data
if (b64) { writeFileSync('/tmp/mobile.png', Buffer.from(b64, 'base64')); console.log('saved /tmp/mobile.png') }
await fetch('http://127.0.0.1:9229/json/close/' + page.id).catch(() => {})
ws.close()
