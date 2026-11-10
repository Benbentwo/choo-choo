import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The commit the app is built from, shown with comments sent from the app (src/main/uiComment.ts).
function buildCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8'
    }).trim()
  } catch {
    return (process.env.GITHUB_SHA ?? '').slice(0, 7)
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: { __BUILD_COMMIT__: JSON.stringify(buildCommit()) },
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [react(), tailwindcss()]
  }
})
