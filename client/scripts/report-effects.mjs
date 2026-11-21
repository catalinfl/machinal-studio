import { spawnSync } from 'node:child_process'

const result = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', 'e2e/effect-parity.spec.ts', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, EFFECT_PARITY: '1' },
})
if (result.error) console.error(result.error)
process.exit(result.status ?? 1)
