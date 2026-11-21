import { expect, test, type Page } from '@playwright/test'
import { mockPaidAuth } from './helpers/paid-auth'
import type { TextItem } from '../src/stores/editor.svelte'

const openingTitle: TextItem = {
  id: 'opening-title', start: 0, duration: 2, text: 'Hello', x: 960, y: 540,
  fontFamily: 'sans', fontSize: 40, fontWeight: 400, italic: false, align: 'center',
  color: '#ffffff', strokeColor: '#000000', strokeWidth: 0,
  backgroundColor: '#000000', backgroundOpacity: 0, backgroundPadding: 18, backgroundRadius: 8,
  bannerStyle: 'none', accentColor: '#8ba8ff', animation: 'none', animationDuration: 0.45,
  opacity: 1, rotation: 0, isCaption: false, highlightMode: 'none', highlightColor: '#fff36d',
  highlightBackgroundColor: '#000000', highlightBackgroundOpacity: 0, highlightAnimation: 'pop', words: [],
}

async function mockAIEdit(page: Page) {
  let finishEdit!: () => void
  const editReady = new Promise<void>(resolve => { finishEdit = resolve })
  await page.route('**/list', route => route.fulfill({ status: 200, body: '' }))
  await page.route('**/ai/compositions', async route => {
    const request = route.request().postDataJSON()
    expect(request.instruction).toBe('Add an opening title')
    await editReady
    const snapshot = request.project.snapshot
    const document = { ...request.project.document, texts: [openingTitle] }
    await route.fulfill({
      json: {
        mode: 'execute', document, recipe: document, bindings: request.project.bindings,
        expectedRevision: snapshot.revision, diagnostics: [], requirements: [],
        summary: 'Add an opening title',
        composition: {
          id: 'ai-title', documentRevision: 'ai-title-1', compilerVersion: '1', catalogVersion: '1',
          duration: 2, output: document.output, assets: request.project.assets,
          tracks: snapshot.tracks, effects: snapshot.effects, transitions: snapshot.transitions,
          textItems: [openingTitle], textRenderKey: 'ai-title-text', segments: {},
        },
      },
    })
  })
  await mockPaidAuth(page)
  return finishEdit
}

test('acknowledges and applies an AI edit automatically on desktop', async ({ page }) => {
  const finishEdit = await mockAIEdit(page)
  await page.goto('/editor')

  await page.getByRole('button', { name: 'AI Edit', exact: true }).click()
  const panel = page.locator('#ai-panel')
  await expect(panel).toBeVisible()
  const instruction = page.getByLabel('Timeline instruction')
  await instruction.fill('Add an opening title')
  await page.getByRole('button', { name: 'Edit timeline', exact: true }).click()
  await expect(instruction).toBeDisabled()
  await expect(panel.getByRole('status')).toContainText('Looking through your footage')
  await expect(page.getByLabel('Review AI edit plan')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Confirm edit' })).toHaveCount(0)
  finishEdit()

  await expect(page.locator('[data-timeline-text-id]')).toHaveCount(1)
  await expect(instruction).toBeEnabled()
  await expect(panel.getByRole('status')).toContainText('Add an opening title')
  await page.getByRole('button', { name: 'Undo last edit', exact: true }).click()
  await expect(page.locator('[data-timeline-text-id]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Redo last edit', exact: true }).click()
  await expect(page.locator('[data-timeline-text-id]')).toHaveCount(1)
})

test('moves and docks the AI panel on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/list', route => route.fulfill({ status: 200, body: '' }))
  await mockPaidAuth(page)
  await page.goto('/editor')

  await page.getByRole('button', { name: 'AI Edit', exact: true }).click()
  const panel = page.locator('#ai-panel')
  const handle = page.getByRole('button', { name: 'Undock and move AI panel' })
  const start = await panel.boundingBox()
  expect(start).not.toBeNull()

  await handle.click()
  const floatingStart = await panel.boundingBox()
  expect(floatingStart).not.toBeNull()
  const topmostPanel = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('#ai-panel')?.id, {
    x: floatingStart!.x + 20,
    y: floatingStart!.y + 20,
  })
  expect(topmostPanel).toBe('ai-panel')

  const headerBox = await panel.locator('.browser-panel-head').boundingBox()
  expect(headerBox).not.toBeNull()
  await page.mouse.move(headerBox!.x + 120, headerBox!.y + headerBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(650, 220, { steps: 8 })
  await page.mouse.up()
  await expect(page.getByRole('button', { name: 'Dock AI panel' })).toBeVisible()
  const moved = await panel.boundingBox()
  expect(moved).not.toBeNull()
  expect(moved!.x).not.toBe(start!.x)
  expect(moved!.height).toBeLessThanOrEqual(482)

  await page.getByRole('button', { name: 'Transitions', exact: true }).click()
  const transitions = page.locator('#transitions-panel')
  const aiShell = page.locator('.ai-panel-shell')
  await expect(transitions).toBeVisible()
  await expect(panel).toBeVisible()
  const transitionsBox = await transitions.boundingBox()
  const aiBox = await aiShell.boundingBox()
  expect(transitionsBox).not.toBeNull()
  expect(aiBox).not.toBeNull()
  expect(aiBox!.width).toBeCloseTo(220, 0)
  expect(aiBox!.width).toBeLessThan(transitionsBox!.width)
  await panel.getByLabel('Timeline instruction').fill('Make the opening shorter')
  await panel.getByRole('button', { name: 'Edit timeline', exact: true }).hover()
  expect(await panel.getByRole('button', { name: 'Edit timeline', exact: true }).evaluate(button => getComputedStyle(button).color)).toBe('rgb(255, 255, 255)')
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('#ai-panel')?.id, {
    x: moved!.x + 20,
    y: moved!.y + 20,
  })).toBe('ai-panel')
  await page.screenshot({ path: '../.impeccable/review/compact-tools-1440-ai-floating.png', fullPage: true, animations: 'disabled' })

  await page.getByRole('button', { name: 'AI Edit', exact: true }).click()
  await expect(panel).toBeHidden()
  await page.getByRole('button', { name: 'AI Edit', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Dock AI panel' })).toBeVisible()
  const restored = await panel.boundingBox()
  expect(restored).not.toBeNull()
  expect(restored!.x).toBeCloseTo(moved!.x, 0)
  expect(restored!.y).toBeCloseTo(moved!.y, 0)

  await page.getByRole('button', { name: 'Dock AI panel' }).click()
  await expect(transitions).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Undock and move AI panel' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Dock AI panel' })).toHaveCount(0)
  await page.screenshot({ path: '../.impeccable/review/editor-purple-1440-ai.png', fullPage: true, animations: 'disabled' })
})

test('keeps the AI instruction when the panel is hidden', async ({ page }) => {
  await page.route('**/list', route => route.fulfill({ status: 200, body: '' }))
  await mockPaidAuth(page)
  await page.goto('/editor')

  await page.getByRole('button', { name: 'AI Edit', exact: true }).click()
  await page.getByLabel('Timeline instruction').fill('Keep this instruction for later')
  await page.getByRole('button', { name: 'AI Edit', exact: true }).click()
  await expect(page.locator('#ai-panel')).toBeHidden()

  await page.getByRole('button', { name: 'AI Edit', exact: true }).click()
  await expect(page.getByLabel('Timeline instruction')).toHaveValue('Keep this instruction for later')
})

test('finishes an in-flight AI edit while the panel is hidden', async ({ page }) => {
  const finishEdit = await mockAIEdit(page)
  await page.goto('/editor')

  await page.getByRole('button', { name: 'AI Edit', exact: true }).click()
  await page.getByLabel('Timeline instruction').fill('Add an opening title')
  await page.getByRole('button', { name: 'Edit timeline', exact: true }).click()
  await expect(page.getByLabel('Timeline instruction')).toBeDisabled()

  await page.getByRole('button', { name: 'AI Edit', exact: true }).click()
  await expect(page.locator('#ai-panel')).toBeHidden()
  finishEdit()
  await expect(page.locator('[data-timeline-text-id]')).toHaveCount(1)
  await page.getByRole('button', { name: 'AI Edit', exact: true }).click()
  await expect(page.locator('#ai-panel').getByRole('status')).toContainText('Add an opening title')
})

test('opens the AI panel without overflowing a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/list', route => route.fulfill({ status: 200, body: '' }))
  await mockPaidAuth(page)
  await page.goto('/editor')

  await page.getByRole('navigation', { name: 'Editor panels' }).getByRole('button', { name: 'AI Edit', exact: true }).click()
  const panel = page.locator('#ai-panel')
  await expect(panel).toBeVisible()
  const box = await panel.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.width).toBeLessThanOrEqual(390)
  await page.screenshot({ path: '../.impeccable/review/editor-purple-390-ai.png', fullPage: true, animations: 'disabled' })
})
