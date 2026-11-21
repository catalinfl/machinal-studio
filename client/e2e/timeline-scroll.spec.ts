import { expect, test } from '@playwright/test'

test.use({
  viewport: { width: 1600, height: 900 },
  launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] },
})

test('keeps the scrollbar, tracks and ruler aligned during dragging and resizing', async ({ page }, testInfo) => {
  await page.route('**/list*', (route) => route.fulfill({ json: [] }))
  await page.goto('/editor')
  await expect(page.locator('.tl-scrollbar')).toBeVisible()
  await page.evaluate(async () => {
    const storeURL = performance.getEntriesByType('resource').map((entry) => entry.name)
      .findLast((name) => new URL(name).pathname === '/src/stores/editor.svelte.ts')
    const { editor } = await import(storeURL ?? '/src/stores/editor.svelte.ts')
    editor.clearTimeline()
    editor.setPixelsPerSecond(60)
    for (let index = 0; index < 100; index++) {
      editor.addTextItem(index * 6, { text: `Caption ${index}`, duration: 5 })
    }
  })

  const scrollbar = page.locator('.tl-scrollbar')
  const tracks = page.locator('.tl-track-scroll')
  await expect.poll(() => scrollbar.evaluate((element) => element.scrollWidth)).toBeGreaterThan(30_000)
  const geometry = await scrollbar.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return {
      x: rect.x,
      y: rect.y + rect.height - 6,
      width: element.clientWidth,
      thumbWidth: element.clientWidth ** 2 / element.scrollWidth,
    }
  })

  await page.evaluate(() => {
    const tracks = document.querySelector<HTMLElement>('.tl-track-scroll')!
    const scrollbar = document.querySelector<HTMLElement>('.tl-scrollbar')!
    const ruler = document.querySelector<HTMLElement>('.tl-ruler')!
    const samples: { bar: number; tracks: number; ruler: number }[] = []
    Object.assign(window, { timelineScrollSamples: samples })

    const sample = () => {
      samples.push({
        bar: scrollbar.scrollLeft,
        tracks: tracks.scrollLeft,
        ruler: -new DOMMatrixReadOnly(getComputedStyle(ruler).transform).m41,
      })
      if (samples.length < 300) requestAnimationFrame(sample)
    }

    requestAnimationFrame(sample)
  })

  const startX = geometry.x + geometry.thumbWidth / 2
  await page.mouse.move(startX, geometry.y)
  await page.mouse.down()
  await page.mouse.move(geometry.x + geometry.width * 0.75, geometry.y, { steps: 40 })
  await page.mouse.up()
  await expect.poll(() => tracks.evaluate((element) => element.scrollLeft)).toBeGreaterThan(10_000)

  const samples = await page.evaluate(() =>
    (window as unknown as { timelineScrollSamples: { bar: number; tracks: number; ruler: number }[] }).timelineScrollSamples,
  )

  for (let index = 1; index < samples.length; index++) {
    expect(samples[index].bar).toBeGreaterThanOrEqual(samples[index - 1].bar)
    expect(Math.abs(samples[index].tracks - samples[index].ruler)).toBeLessThanOrEqual(1)
  }

  await expect.poll(() => page.evaluate(() => {
    const tracks = document.querySelector<HTMLElement>('.tl-track-scroll')!
    const scrollbar = document.querySelector<HTMLElement>('.tl-scrollbar')!
    return Math.abs(tracks.scrollLeft - scrollbar.scrollLeft)
  })).toBeLessThanOrEqual(1)

  await page.getByLabel('Timeline zoom', { exact: true }).fill('120')
  await expect.poll(() => page.evaluate(() => {
    const tracks = document.querySelector<HTMLElement>('.tl-track-scroll')!
    const ruler = document.querySelector<HTMLElement>('.tl-ruler')!
    return Math.abs(tracks.scrollLeft + new DOMMatrixReadOnly(getComputedStyle(ruler).transform).m41)
  })).toBeLessThanOrEqual(1)
  await page.screenshot({ path: testInfo.outputPath('timeline-scroll-desktop.png') })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Hide tracks' }).click()
  await tracks.evaluate((element) => { element.scrollLeft = 1200 })
  await expect.poll(() => scrollbar.evaluate((element) => element.scrollLeft)).toBe(1200)
  await expect.poll(() => page.evaluate(() => {
    const tracks = document.querySelector<HTMLElement>('.tl-track-scroll')!
    const ruler = document.querySelector<HTMLElement>('.tl-ruler')!
    return Math.abs(tracks.scrollLeft + new DOMMatrixReadOnly(getComputedStyle(ruler).transform).m41)
  })).toBeLessThanOrEqual(1)
  await page.screenshot({ path: testInfo.outputPath('timeline-scroll-mobile.png') })
})
