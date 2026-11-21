/// <reference types="node" />

import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.PLAYWRIGHT_PORT || 5173)
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PLAYWRIGHT_PORT must be an integer between 1024 and 65535')
const origin = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './e2e',
  // Serial execution: the Go API server is single-threaded and each page load
  // downloads all scrub proxies (~80 MB), so parallel workers stall the drops.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: origin,
    trace: 'retain-on-failure',
    viewport: { width: 1600, height: 900 },
    launchOptions: process.env.SCENE_BROWSER ? { executablePath: process.env.SCENE_BROWSER } : {},
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `pnpm dev --host 127.0.0.1 --port ${port} --strictPort`,
    url: origin,
    reuseExistingServer: !process.env.CI && !process.env.PLAYWRIGHT_PORT,
    timeout: 120_000,
  },
})
