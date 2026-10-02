import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// ⛔ every writing call carries the board's token and says it is JSON: the
// server refuses anything else (another site's page cannot read the token
// out of this page, nor send JSON cross-site without a preflight it refuses)
const csrf = document.querySelector('meta[name="oa-csrf"]')?.getAttribute('content') ?? ''
const nativeFetch = window.fetch.bind(window)
window.fetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
  const method = (init.method ?? 'GET').toUpperCase()
  if (typeof input === 'string' && input.startsWith('api/') && method !== 'GET' && method !== 'HEAD') {
    init = { ...init, headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string> ?? {}), 'x-oa-csrf': csrf }, body: init.body ?? '{}' }
  }
  return nativeFetch(input, init)
}

document.documentElement.classList.add('dark')
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
