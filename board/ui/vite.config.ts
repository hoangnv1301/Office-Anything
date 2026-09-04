import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // ⛔ never empty dist before building: the live board serves it, and a failed
  // build left an EMPTY dist for a minute while every open tab reloaded into it
  // ("page crashed", 2026-09-04). index.html is written last, so a failed build
  // now leaves the previous build serving intact.
  build: { emptyOutDir: false },
  // @ts-expect-error vitest extends the vite config
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'] },
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
})
