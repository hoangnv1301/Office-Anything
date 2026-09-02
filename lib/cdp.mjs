// A MINIMAL CDP CLIENT, ZERO DEPENDENCIES. Exists for exactly one job: ask a
// desk's OWN headed Chrome for a picture of what it is showing, so the board
// can mirror the display without touching what is running. Text frames only,
// client frames masked as RFC 6455 requires, 16/64-bit lengths, ping answered
// with pong. Anything fancier belongs to a real library and a real dependency.
import { connect } from 'node:net'
import { randomBytes, createHash } from 'node:crypto'

export function buildFrame(payloadText) {
  const payload = Buffer.from(payloadText, 'utf8')
  const mask = randomBytes(4)
  const head = []
  head.push(0x81) // FIN + text
  if (payload.length < 126) head.push(0x80 | payload.length)
  else if (payload.length < 65536) { head.push(0x80 | 126, payload.length >> 8, payload.length & 0xff) }
  else {
    head.push(0x80 | 127, 0, 0, 0, 0,
      (payload.length >>> 24) & 0xff, (payload.length >>> 16) & 0xff, (payload.length >>> 8) & 0xff, payload.length & 0xff)
  }
  const masked = Buffer.alloc(payload.length)
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4]
  return Buffer.concat([Buffer.from(head), mask, masked])
}

// Parse as many complete frames as the buffer holds; hand back the remainder.
export function parseFrames(buf) {
  const frames = []
  let off = 0
  while (buf.length - off >= 2) {
    const opcode = buf[off] & 0x0f
    const masked = (buf[off + 1] & 0x80) !== 0
    let len = buf[off + 1] & 0x7f
    let p = off + 2
    if (len === 126) { if (buf.length - p < 2) break; len = buf.readUInt16BE(p); p += 2 }
    else if (len === 127) { if (buf.length - p < 8) break; len = Number(buf.readBigUInt64BE(p)); p += 8 }
    const maskLen = masked ? 4 : 0
    if (buf.length - p < maskLen + len) break
    let payload = buf.slice(p + maskLen, p + maskLen + len)
    if (masked) { const m = buf.slice(p, p + 4); payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= m[i % 4] }
    frames.push({ opcode, payload })
    off = p + maskLen + len
  }
  return { frames, rest: buf.slice(off) }
}

export function wsCall(wsUrl, method, params = {}, { timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(wsUrl)
    const key = randomBytes(16).toString('base64')
    const sock = connect(Number(u.port), u.hostname)
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('cdp timeout')) }, timeoutMs)
    let upgraded = false, buf = Buffer.alloc(0)
    sock.on('error', (e) => { clearTimeout(timer); reject(e) })
    sock.on('connect', () => {
      sock.write(`GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`)
    })
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d])
      if (!upgraded) {
        const end = buf.indexOf('\r\n\r\n')
        if (end < 0) return
        const head = buf.slice(0, end).toString()
        if (!/101/.test(head.split('\r\n')[0])) { clearTimeout(timer); sock.destroy(); return reject(new Error('upgrade refused')) }
        const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
        if (!head.includes(accept)) { clearTimeout(timer); sock.destroy(); return reject(new Error('bad accept key')) }
        upgraded = true
        buf = buf.slice(end + 4)
        sock.write(buildFrame(JSON.stringify({ id: 1, method, params })))
      }
      const { frames, rest } = parseFrames(buf)
      buf = rest
      for (const f of frames) {
        if (f.opcode === 9) sock.write(Buffer.concat([Buffer.from([0x8a, 0x80]), randomBytes(4)])) // pong, masked, empty
        if (f.opcode !== 1) continue
        try {
          const j = JSON.parse(f.payload.toString('utf8'))
          if (j.id === 1) { clearTimeout(timer); sock.destroy(); return resolve(j) }
        } catch { /* partial? parseFrames only yields whole frames; a bad frame is a bad peer */ }
      }
    })
  })
}

// The picture of what a desk's Chrome is SHOWING. Display only, by design.
export async function screenshotOf(port, { quality = 60 } = {}) {
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = tabs.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  if (!page) return null
  const r = await wsCall(page.webSocketDebuggerUrl, 'Page.captureScreenshot', { format: 'jpeg', quality })
  const b64 = r?.result?.data
  return b64 ? { jpeg: Buffer.from(b64, 'base64'), title: page.title, url: page.url } : null
}
