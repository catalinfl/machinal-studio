import { test, expect, type Page } from '@playwright/test'

const SAMPLE_POINTS = [[.1, .12], [.5, .12], [.8, .12], [.1, .85], [.5, .85], [.8, .85]]

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type: string, options?: Record<string, unknown>) {
      return getContext.call(this, type, type.startsWith('webgl') ? { ...options, preserveDrawingBuffer: true } : options)
    } as typeof getContext
    localStorage.setItem('scrub-theme', 'light')
  })
  const record = { id: 'demo-user', email: 'creator@example.test', name: 'Demo Creator', collectionName: 'users', isPaid: true }
  const token = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.test-signature`
  await page.addInitScript(value => localStorage.setItem('pocketbase_auth', JSON.stringify(value)), { token, record })
  await page.route('**/api/collections/users/auth-refresh', route => route.fulfill({ json: { token, record } }))
  await page.goto('/toolkit')
  await expect(page.locator('.canvas-host canvas')).toBeVisible()
  await page.locator('.direction-demo').scrollIntoViewIfNeeded()
  await page.locator('.direction-demo').getByRole('button', { name: 'Media', exact: true }).click()
})

async function seek(page: Page, time: number) {
  const pause = page.getByRole('button', { name: 'Pause sandbox', exact: true })
  if (await pause.count()) await pause.click()
  await page.getByRole('slider', { name: 'Scrub interactive timeline' }).evaluate(async (element, value) => {
    const input = element as HTMLInputElement
    input.value = String(value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  }, time)
}

async function samplePreview(page: Page) {
  return page.locator('.canvas-host canvas').evaluate((element, points) => {
    const source = element as HTMLCanvasElement
    const canvas = document.createElement('canvas')
    canvas.width = source.width
    canvas.height = source.height
    const context = canvas.getContext('2d')!
    context.drawImage(source, 0, 0)
    return points.map(([x, y]) => Array.from(context.getImageData(Math.floor(x * canvas.width), Math.floor(y * canvas.height), 1, 1).data))
  }, SAMPLE_POINTS)
}

function expectFullFrame(samples: number[][]) {
  for (const pixel of samples) expect(pixel[3], JSON.stringify(samples)).toBe(255)
}

test('styles and effects cover the entire preview, including all four quadrants', async ({ page }) => {
  const baseline = await samplePreview(page)
  expectFullFrame(baseline)
  for (const pixel of baseline) expect(pixel).toEqual([198, 173, 255, 255])
  await page.getByRole('button', { name: 'Effects', exact: true }).click()
  await page.locator('.direction-demo').getByRole('button', { name: /^Grayscale/ }).click()
  await seek(page, 1)
  const grayscale = await samplePreview(page)
  expectFullFrame(grayscale)
  for (const pixel of grayscale) {
    for (const channel of pixel.slice(0, 3)) expect(Math.abs(channel - 190)).toBeLessThanOrEqual(1)
  }

  await page.getByRole('button', { name: 'Remove effect', exact: true }).click()
  await page.getByRole('button', { name: 'Styles', exact: true }).click()
  await page.locator('.direction-demo').getByRole('button', { name: /^Silver Contrast/ }).click()
  await seek(page, 1)
  const silver = await samplePreview(page)
  expectFullFrame(silver)
  // Silver Contrast adds independent RGB film grain after its monochrome grade.
  for (const pixel of silver) {
    expect(Math.max(...pixel.slice(0, 3)) - Math.min(...pixel.slice(0, 3))).toBeLessThanOrEqual(15)
    expect(Math.min(...pixel.slice(0, 3))).toBeGreaterThan(40)
  }

  for (const name of ['Warm Memory', 'Neon Night']) {
    await page.locator('.direction-demo').getByRole('button', { name: new RegExp(`^${name}`) }).click()
    await seek(page, 1)
    const styled = await samplePreview(page)
    expectFullFrame(styled)
    for (let point = 0; point < styled.length; point++) {
      expect(styled[point].slice(0, 3)).not.toEqual(baseline[point].slice(0, 3))
      expect(Math.max(...styled[point].slice(0, 3))).toBeGreaterThan(80)
    }
  }

  await page.getByRole('button', { name: 'Remove style', exact: true }).click()
  await page.getByRole('button', { name: 'Effects', exact: true }).click()
  for (const name of ['Prism', 'Vignette']) {
    await page.locator('.direction-demo').getByRole('button', { name: new RegExp(`^${name}`) }).click()
    await seek(page, 1)
    const treated = await samplePreview(page)
    expectFullFrame(treated)
    for (const pixel of treated) expect(Math.max(...pixel.slice(0, 3))).toBeGreaterThan(80)
  }
  await expect(page.locator('.fallback-art')).toHaveCount(0)

  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await seek(page, 1)
  expect(await samplePreview(page)).toEqual(baseline)
})

test('catalog transitions render changing frames at both scene boundaries', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error' && /shader|webgl|glsl|pixi/i.test(message.text())) errors.push(message.text())
  })
  const first = await samplePreview(page)
  await page.getByRole('button', { name: 'Add The next move to timeline' }).click()
  const second = await samplePreview(page)
  await page.getByRole('button', { name: 'Add Your direction to timeline' }).click()
  const third = await samplePreview(page)
  await page.getByRole('button', { name: 'Transitions', exact: true }).click()

  for (const name of ['Cross Dissolve', 'Push Left', 'Fade Through Black']) {
    await page.locator('.direction-demo').getByRole('button', { name: new RegExp(`^${name}`) }).click()
    for (const [start, from, to] of [[3.4, first, second], [6.8, second, third]] as const) {
      await seek(page, start + .02)
      const early = await samplePreview(page)
      await seek(page, start + .3)
      const middle = await samplePreview(page)
      await seek(page, start + .58)
      const late = await samplePreview(page)
      expectFullFrame(middle)
      expect(middle).not.toEqual(early)
      expect(middle).not.toEqual(late)
      if (name === 'Cross Dissolve') {
        for (let point = 0; point < middle.length; point++) {
          for (let channel = 0; channel < 3; channel++) {
            expect(Math.abs(middle[point][channel] - (from[point][channel] + to[point][channel]) / 2)).toBeLessThanOrEqual(5)
          }
        }
      }
      if (name === 'Push Left') {
        for (const [point, frame] of [[0, from], [2, to], [3, from], [5, to]] as const) {
          for (let channel = 0; channel < 3; channel++) expect(Math.abs(middle[point][channel] - frame[point][channel])).toBeLessThanOrEqual(5)
        }
      }
    }
  }
  await page.getByRole('button', { name: 'Use a straight cut', exact: true }).click()
  await expect(page.getByRole('group', { name: 'Timeline transitions' })).toHaveCount(0)
  await seek(page, 3.98)
  expect(await samplePreview(page)).toEqual(first)
  await seek(page, 4.02)
  expect(await samplePreview(page)).toEqual(second)

  await page.locator('.direction-demo').getByRole('button', { name: /^Cross Dissolve/ }).click()
  await seek(page, 3.2)
  await page.getByRole('button', { name: 'Play sandbox', exact: true }).click()
  await expect.poll(async () => Number(await page.getByRole('slider', { name: 'Scrub interactive timeline' }).inputValue())).toBeGreaterThan(4.1)
  await page.getByRole('button', { name: 'Pause sandbox', exact: true }).click()
  expect(await samplePreview(page)).toEqual(second)
  expect(errors).toEqual([])
})

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  for (const theme of ['light', 'dark']) {
    test(`transition labels stay separate at ${viewport.width}px in ${theme} theme`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport)
      if (theme === 'dark') {
        await page.getByRole('button', { name: 'Account settings', exact: true }).click()
        await page.getByRole('button', { name: 'Use dark theme' }).click()
        await page.keyboard.press('Escape')
      }
      await page.getByRole('button', { name: 'Add The next move to timeline' }).click()
      await page.getByRole('button', { name: 'Add Your direction to timeline' }).click()
      const finalScene = await samplePreview(page)
      await page.getByRole('button', { name: 'Transitions', exact: true }).click()
      await page.locator('.direction-demo').getByRole('button', { name: /^Cross Dissolve/ }).click()
      const labels = await page.locator('.clip-label').evaluateAll(elements => elements.map(element => {
        const rect = element.getBoundingClientRect()
        return { left: rect.left, right: rect.right }
      }))
      expect(labels).toHaveLength(3)
      for (let index = 0; index < labels.length - 1; index++) expect(labels[index].right).toBeLessThanOrEqual(labels[index + 1].left)
      const markers = page.getByRole('button', { name: /^Preview Cross Dissolve between/ })
      await expect(markers).toHaveCount(2)
      await expect(page.getByRole('button', { name: 'Play sandbox', exact: true })).toBeVisible()
      expect(await samplePreview(page)).toEqual(finalScene)
      await markers.last().click()
      await expect(page.getByRole('button', { name: 'Pause sandbox', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Play sandbox', exact: true })).toBeVisible()
      await expect(page.getByRole('slider', { name: 'Scrub interactive timeline' })).toHaveValue('7.6')
      expect(await samplePreview(page)).toEqual(finalScene)
      expect(await page.evaluate(() => document.querySelector('.home')!.scrollWidth <= window.innerWidth)).toBe(true)
      if (viewport.width > 640) {
        await page.locator('.direction-demo').screenshot({ path: testInfo.outputPath('transitions.png') })
      } else {
        await page.locator('.preview-pane').evaluate(element => element.scrollIntoView({ block: 'start' }))
        await page.screenshot({ path: testInfo.outputPath('preview-timeline.png') })
        await page.locator('.editor-controls').evaluate(element => element.scrollIntoView({ block: 'start' }))
        await page.screenshot({ path: testInfo.outputPath('transition-controls.png') })
      }
    })
  }
}
