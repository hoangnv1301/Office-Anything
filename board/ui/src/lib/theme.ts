// LIGHT AND DARK. The board follows the system unless the viewer chose one
// (the moon/sun in the sidebar footer, kept per browser), and a #dark / #light
// in the address wins over both, so a screenshot is the same every run.
export const THEME_KEY = 'office-theme'

export function isDark(): boolean {
  return document.documentElement.classList.contains('dark')
}

export function applyTheme(): void {
  const hash = /^#(dark|light)\b/.exec(location.hash)?.[1]
  let saved: string | null = null
  try { saved = localStorage.getItem(THEME_KEY) } catch { saved = null }
  const dark = hash ? hash === 'dark' : saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.classList.toggle('dark', dark)
}

// the viewer's own choice; the system's answer again when they pick what it says anyway
export function chooseTheme(dark: boolean): void {
  try {
    const system = window.matchMedia('(prefers-color-scheme: dark)').matches
    if (dark === system) localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light')
  } catch { /* a remembered theme is a convenience */ }
  document.documentElement.classList.toggle('dark', dark)
}

export function watchTheme(): void {
  applyTheme()
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme)
  window.addEventListener('hashchange', applyTheme)
}
