import { test, expect } from '@playwright/test'

test('documentation covers product workflows without exposing rendering internals', async ({ page }) => {
  await page.goto('/docs')
  await expect(page.getByRole('heading', { name: 'Documentation', exact: true })).toBeVisible()
  await expect(page.locator('.body')).not.toContainText(/ffmpeg|ffprobe/i)

  const targets = await page.locator('.body section').evaluateAll(sections => sections.map(section => section.id))
  expect(new Set(targets).size).toBe(targets.length)
  for (const id of ['workflows', 'editor-guide', 'projects', 'ai-guide', 'api-keys-guide', 'api-render', 'local-headless', 'rendering', 'pricing', 'faq']) {
    expect(targets).toContain(id)
  }

  const navigation = page.getByRole('navigation', { name: 'Documentation contents' })
  for (const button of await navigation.getByRole('button').all()) {
    await button.click()
    const id = new URL(page.url()).hash.slice(1)
    await expect(page.locator(`section[id="${id}"]`)).toHaveCount(1)
  }

  const question = page.getByText('Do I need Pro for local headless rendering?', { exact: true })
  await question.click()
  await expect(question.locator('..')).toContainText('do not require a machinal account')
  await expect(page.locator('#pricing')).toContainText('1,000 API credits')
  await expect(page.locator('#api-render pre').last()).toContainText('--data-urlencode "file=$FILENAME"')
})

test('deep links and copyable local commands work', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/docs#local-headless')
  await expect(page.locator('#local-headless')).toBeInViewport()
  const copy = page.getByRole('button', { name: 'Copy Compile or render from a media folder', exact: true })
  await copy.click()
  await expect(copy).toHaveText('Copied')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('edit render composition.edit.yaml --root /path/to/media --output result.mp4')
})

for (const width of [1440, 390]) {
  test(`documentation is readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/docs')
    await expect(page.getByRole('heading', { name: 'Documentation', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: `C:/Users/PC/AppData/Local/Temp/opencode/docs-${width}.png` })
    await page.getByRole('navigation', { name: 'Documentation contents' }).getByRole('button', { name: 'Frequently asked questions', exact: true }).click()
    await expect(page.locator('#faq')).toBeInViewport()
    await page.getByText('Can I render without opening the editor?', { exact: true }).click()
    await expect(page.locator('details[open]')).toContainText('edit render locally')
  })
}

test('desktop contents scroll independently and the last entry is reachable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 720 })
  await page.goto('/docs')
  const toc = page.getByRole('navigation', { name: 'Documentation contents' })
  await expect(toc).toBeVisible()
  const before = await page.locator('.head').boundingBox()
  await toc.hover()
  await page.mouse.wheel(0, 1800)
  await expect.poll(() => toc.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  const faq = toc.getByRole('button', { name: 'Frequently asked questions', exact: true })
  await expect(faq).toBeInViewport()
  await page.mouse.wheel(0, 1000)
  await expect.poll(() => page.locator('.docs').evaluate(element => element.scrollTop)).toBe(0)
  expect(await page.locator('.head').boundingBox()).toEqual(before)
  expect(await page.locator('.body').evaluate(element => element.scrollTop)).toBe(0)
  const bounds = await toc.boundingBox()
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(720)

  await faq.click()
  await expect(page.locator('#faq')).toBeInViewport()
  await expect.poll(() => page.locator('.docs').evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  const pageScroll = await page.locator('.docs').evaluate(element => element.scrollTop)
  await page.locator('#faq h2').hover()
  await page.mouse.wheel(0, -600)
  await expect.poll(() => page.locator('.docs').evaluate(element => element.scrollTop)).toBeLessThan(pageScroll)
})
