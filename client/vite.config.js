import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const workspaceRoot = fileURLToPath(new URL('..', import.meta.url))
const scenesPackage = fileURLToPath(new URL('./node_modules/@machinal/scenes/dist/', import.meta.url))
const rendererPackageUrl = new URL('../services/scene-renderer/package.json', import.meta.url)
const threePackage = fileURLToPath(new URL('../services/scene-renderer/node_modules/three/', import.meta.url))
const rendererRequire = existsSync(rendererPackageUrl) ? createRequire(rendererPackageUrl) : null

function resolveRendererAliases() {
  if (!rendererRequire) return []
  const aliases = []
  for (const name of ['d3', 'd3-delaunay', 'clipper-lib', 'lottie-web/build/player/lottie_light.js', 'topojson-client']) {
    try {
      aliases.push({
        find: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
        replacement: rendererRequire.resolve(name),
      })
    } catch {
      // Optional dev-only native gallery dependencies from ../services/scene-renderer
    }
  }
  aliases.push(
    { find: /^@machinal\/hyperframes\/(.+)$/, replacement: fileURLToPath(new URL('../services/scene-renderer/hyperframes/', import.meta.url)) + '$1.mjs' },
    { find: /^three\/addons\/(.+)$/, replacement: `${threePackage}examples/jsm/$1` },
    { find: /^three\/(.+)$/, replacement: `${threePackage}$1` },
    { find: /^three$/, replacement: fileURLToPath(new URL('../services/scene-renderer/node_modules/three/build/three.module.js', import.meta.url)) },
  )
  return aliases
}

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  resolve: {
    alias: [
      ...resolveRendererAliases(),
      { find: /^gsap\/dist\/(MotionPathPlugin|TextPlugin)$/, replacement: fileURLToPath(new URL('./node_modules/gsap/dist/', import.meta.url)) + '$1.js' },
      { find: /^gsap\/dist\/CustomEase$/, replacement: fileURLToPath(new URL('./node_modules/gsap/dist/CustomEase.js', import.meta.url)) },
      { find: /^gsap$/, replacement: fileURLToPath(new URL('./node_modules/gsap/index.js', import.meta.url)) },
      { find: /^@machinal\/scenes\/svelte$/, replacement: `${scenesPackage}svelte/index.js` },
      { find: /^@machinal\/scenes\/runtime$/, replacement: `${scenesPackage}runtime/index.js` },
      { find: /^@machinal\/scenes$/, replacement: `${scenesPackage}index.js` },
    ],
  },
  server: {
    fs: { allow: [workspaceRoot] },
  },
  // @ffmpeg/ffmpeg spawns its web worker via `new Worker(new URL("./worker.js", import.meta.url), { type: "module" })`.
  // Vite's dep optimizer pre-bundles the package into .vite/deps/, which drops worker.js
  // from the output -> "file does not exist at .vite/deps/worker.js" + the load hangs at
  // "initializing core 80%" because the worker never responds. Excluding the ffmpeg packages
  // from optimization makes Vite serve them as-is so the worker URL pattern resolves natively.
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', '@ffmpeg/core'],
  },
  worker: {
    format: 'es',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/tests/setup.ts'],
    exclude: ['node_modules', 'dist', 'e2e/**'],
  },
})
