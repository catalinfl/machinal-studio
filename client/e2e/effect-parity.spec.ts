import { expect, test } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Report } from '../diagnostics/parity'
import { reportHTML } from '../diagnostics/report-html'

test('capture catalog Pixi / FFmpeg parity report', async ({ page }, testInfo) => {
  test.skip(!process.env.EFFECT_PARITY, 'Run pnpm report:effects to capture actual WebGL and FFmpeg frames')
  test.setTimeout(1_800_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/diagnostics/effect-parity.html')
  const profile = process.env.PARITY_PROFILE === 'yuv420p' ? 'yuv420p' : 'rgba'
  const report = await page.evaluate(async ({ ids, ramps, profile }) => {
    const { runParity } = await import('/diagnostics/parity.ts')
    return runParity((result, done, total) => console.log(`parity ${done}/${total}: ${result.id} ${result.variant} ${result.status}`), { ids, ramps, profile })
  }, { ids: process.env.PARITY_IDS?.split(','), ramps: process.env.PARITY_RAMPS !== '0', profile }) as Report

  const directory = process.env.PARITY_IDS ? testInfo.outputPath('effect-parity') : path.resolve(`reports/effect-parity${profile === 'rgba' ? '' : '-yuv420p'}`)
  await mkdir(directory, { recursive: true })
  if (!process.env.PARITY_IDS) {
    try {
      await writeFile(path.join(directory, 'before.md'), await readFile(path.join(directory, 'report.md')), { flag: 'wx' })
    } catch (error) {
      if (!['EEXIST', 'ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
    }
  }
  const rows: string[] = []
  for (const result of report.results) {
    const worst = Math.max(0, ...result.samples.map(sample => sample.mae))
    rows.push(`| ${result.id} | ${result.variant} | ${result.status} | ${result.samples.length ? worst.toFixed(2) : '—'} | ${result.notes.join('; ').replaceAll('|', '\\|')} |`)
    for (const sample of result.samples) {
      for (const kind of ['pixi', 'ffmpeg', 'difference', 'overlay'] as const) {
        const filename = `${result.id.replaceAll(' + ', '_')}-${result.variant}-${sample.time}-${kind}.png`
        await writeFile(path.join(directory, filename), Buffer.from(sample[kind].split(',')[1], 'base64'))
        sample[kind] = filename
      }
    }
  }
  const markdown = `# Effect parity — measured report\n\n${report.date}\n\n${report.environment}\n\n${report.ffmpegVersion}\n\n${report.fixture}\n\nRGB MAE 0–255; worst sampled frame. Partial = missing temporal/editor behavior, never parity certified. WASM filter-kernel comparison, not native export validation. PNGs and report.json are alongside this file.\n\n| Effect | Variant | Status | Worst MAE | Notes |\n|---|---|---|---:|---|\n${rows.join('\n')}\n`
  await writeFile(path.join(directory, 'report.md'), markdown)
  try {
    const previous = await readFile(path.join(directory, 'before.md'), 'utf8')
    const before = new Map(previous.split('\n').filter(line => line.startsWith('| ')).map(line => {
      const columns = line.split('|').map(column => column.trim())
      return [`${columns[1]}/${columns[2]}`, columns[4]]
    }))
    const changes = report.results.map(result => {
      const key = `${result.id}/${result.variant}`
      const after = result.samples.length ? Math.max(...result.samples.map(sample => sample.mae)).toFixed(2) : '—'
      const prior = before.get(key) ?? '—'
      const delta = Number.isFinite(Number(prior)) && Number.isFinite(Number(after)) ? (Number(after) - Number(prior)).toFixed(2) : '—'
      return `| ${result.id} | ${result.variant} | ${prior} | ${after} | ${delta} | ${result.status} |`
    })
    await writeFile(path.join(directory, 'changes.md'), `# Before / after — ${profile}\n\nWorst sampled RGB MAE (0–255); negative delta is improvement. Baseline measurements are in before.md. PNGs show the current run only.\n\n| Effect | Variant | Before | After | Delta | Status |\n|---|---|---:|---:|---:|---|\n${changes.join('\n')}\n`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2))
  const stylesheet = path.relative(directory, path.resolve('diagnostics/parity.css')).replaceAll('\\', '/')
  await writeFile(path.join(directory, 'index.html'), reportHTML(report, stylesheet))
  await testInfo.attach('parity report', { path: path.join(directory, 'report.md'), contentType: 'text/markdown' })
  const baseline = report.results.find(result => result.id === 'baseline')!
  expect(baseline.status, baseline.error).toBe('measured')
  expect(baseline.samples).toHaveLength(4)
  expect(Math.max(...baseline.samples.map(sample => sample.mae))).toBeLessThan(0.1)
  expect(errors).toEqual([])
  for (const result of report.results.filter(result => result.status === 'error')) {
    expect(result.error, `${result.id}: unexpected diagnostic failure`).toMatch(/FFmpeg exit|RuntimeError|shader/i)
  }
  // Differences and unsupported FFmpeg filters are findings, not harness failures.
  expect(report.results.length).toBeGreaterThan(1)
})

test('diagnostic controls render and display actual comparisons', async ({ page }, testInfo) => {
  test.skip(!process.env.EFFECT_PARITY, 'Opt-in diagnostic UI check')
  await page.goto('/diagnostics/effect-parity.html')
  await page.getByRole('combobox', { name: 'Effect', exact: true }).selectOption('negate')
  await page.getByRole('button', { name: 'Run comparison' }).click()
  await expect(page.getByRole('status')).toContainText('Finished: 3 cases', { timeout: 60_000 })
  await page.locator('#results > details').nth(1).locator('summary').first().click()
  await expect(page.locator('details[open] img')).toHaveCount(16)
  const image = await page.locator('details[open] img').first().boundingBox()
  expect(image!.width / image!.height).toBeCloseTo(160 / 90, 2)
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true })
  await expect(page.getByRole('button', { name: 'Download JSON' })).toBeEnabled()
})

test('repaired effects stay close to FFmpeg on every fixture frame', async ({ page }) => {
  test.skip(!process.env.EFFECT_PARITY, 'Opt-in WebGL / FFmpeg pixel regression')
  test.setTimeout(180_000)
  await page.goto('/diagnostics/effect-parity.html')
  const limits: Record<string, number> = {
    baseline: 0.1, 'gaussian-blur': 2, 'dust-reduction': 1,
    emboss: 2, prism: 1, mirror: 1, 'flip-v': 1, rotate: 2,
    shear: 2, 'camera-shake': 2, 'gate-weave': 2,
    'negative-strobe': 1.1, 'rgb-punch': 3, 'radial-aberration': 2,
    'lens-distortion': 1, fisheye: 1, kaleidoscope: 1, 'tiny-planet': 2,
    duotone: 2, tritone: 2, 'chromatic-correction': 1, thermal: 2,
  }
  const report = await page.evaluate(async ids => {
    const { runParity } = await import('/diagnostics/parity.ts')
    return runParity(() => {}, { ids, ramps: true, sampleFrames: Array.from({ length: 12 }, (_, index) => index) })
  }, Object.keys(limits).filter(id => id !== 'baseline')) as Report
  for (const result of report.results) {
    expect(result.status, `${result.id}/${result.variant}: ${result.error}`).toBe('measured')
    expect(result.samples).toHaveLength(12)
    for (const sample of result.samples) {
      expect(sample.mae, `${result.id}/${result.variant} at ${sample.time}s`).toBeLessThan(limits[result.id])
    }
  }
})

test('median honors non-default window radii without shader errors', async ({ page }) => {
  test.skip(!process.env.EFFECT_PARITY, 'Opt-in WebGL / FFmpeg pixel regression')
  test.setTimeout(180_000)
  await page.goto('/diagnostics/effect-parity.html')
  for (const radius of [2, 5, 10]) {
    const report = await page.evaluate(async radius => {
      const { runParity } = await import('/diagnostics/parity.ts')
      return runParity(() => {}, { ids: ['dust-reduction'], ramps: true, params: { 'dust-reduction': { radius } }, sampleFrames: [0, 6] })
    }, radius) as Report
    for (const result of report.results) {
      expect(result.status, `${radius}: ${result.error}`).toBe('measured')
      for (const sample of result.samples) expect(sample.mae, `radius ${radius}, ${result.variant}`).toBeLessThan(1)
    }
  }
})

test('zero intensity preserves decoded YUV colors', async ({ page }) => {
  test.skip(!process.env.EFFECT_PARITY, 'Opt-in YUV / RGB conversion regression')
  await page.goto('/diagnostics/effect-parity.html')
  const report = await page.evaluate(async () => {
    const { runParity } = await import('/diagnostics/parity.ts')
    return runParity(() => {}, { profile: 'yuv420p', ids: ['mirror', 'emboss', 'sepia', 'camera-shake', 'gaussian-blur'], ramps: true, sampleFrames: [0] })
  }) as Report
  for (const result of report.results.filter(result => result.variant === 'ramp')) {
    expect(result.status, `${result.id}: ${result.error}`).toBe('measured')
    expect(result.samples[0].mae, result.id).toBeLessThan(0.1)
  }
})
