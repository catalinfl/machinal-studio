import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
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
