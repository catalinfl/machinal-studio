import { expect, test } from './helpers/fixtures'
import { mockPaidAuth } from './helpers/paid-auth'

test('reviews multiple timed captions and applies one style to the resulting selection', async ({ page }) => {
  await mockPaidAuth(page)
  await page.route('**/ai/subtitles', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        cues: [
          {
            start: 0,
            end: 1.8,
            text: 'Precision starts here',
            words: [
              { text: 'Precision', start: 0, end: 0.6 },
              { text: 'starts', start: 0.65, end: 1.1 },
              { text: 'here', start: 1.2, end: 1.8 },
            ],
          },
          {
            start: 2,
            end: 3.6,
            text: 'Every word stays synced',
            words: [
              { text: 'Every', start: 2, end: 2.35 },
              { text: 'word', start: 2.4, end: 2.75 },
              { text: 'stays', start: 2.8, end: 3.15 },
              { text: 'synced', start: 3.2, end: 3.6 },
            ],
          },
        ],
      }),
    })
  })
  await page.goto('/editor')
  const audioTrack = page.getByRole('application', { name: 'Drop zone: Audio 1' })
  await audioTrack.evaluate((target) => {
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('application/x-cineedit-clip', JSON.stringify({
      fileName: 'caption-source.mp3',
      sourceMode: 'proxy',
      mediaKind: 'audio',
      scrubBlobUrl: 'blob:caption-source',
      sourceDuration: 10,
      dragOffsetX: 0,
    }))
    const box = target.getBoundingClientRect()
    for (const type of ['dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(type, {
        dataTransfer,
        clientX: box.left,
        clientY: box.top + 20,
        bubbles: true,
        cancelable: true,
      }))
    }
  })
  const sourceClip = audioTrack.locator('.clip')
  await expect(sourceClip).toBeVisible()
  await sourceClip.click()

  await page.getByRole('button', { name: 'Text', exact: true }).click()
  await page.getByRole('button', { name: 'Generate voice to text' }).click()

  const dialog = page.getByRole('dialog', { name: 'Review captions' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('checkbox')).toHaveCount(2)
  await dialog.getByLabel('Caption font').click()
  await dialog.getByRole('button', { name: 'Montserrat' }).click()
  await dialog.getByLabel('Caption size').fill('70')
  await dialog.getByRole('button', { name: 'Add selected captions' }).click()

  await expect(page.locator('[data-timeline-text-id]')).toHaveCount(2)
  await page.locator('[data-timeline-text-id]').first().dblclick()
  await expect(page.locator('#text-inspector .inspector-selection-label')).toHaveText('2 text layers selected')
  await expect(page.getByLabel('Text font')).toHaveAttribute('data-value', 'montserrat')
  await expect(page.getByLabel('Text size')).toHaveValue('70')
})
