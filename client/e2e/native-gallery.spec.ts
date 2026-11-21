import { expect, test } from '@playwright/test'

test('playback and seeking update the actual native scene, not just the clock', async ({ page }) => {
  await page.goto('/native-gallery.html')
  await page.getByLabel('Find a port').fill('ai-answer-rank')

  const play = page.getByRole('button', { name: 'Play', exact: true })
  const scene = page.locator('#aar-typed')
  const prompt = "What's the best CRM for a small team?"
  await expect(play).toBeEnabled()
  await expect(scene).not.toContainText(prompt)
  await play.click()
  await expect(scene).toContainText(prompt)
  await page.getByRole('button', { name: 'Pause', exact: true }).click()

  await page.getByRole('slider', { name: 'Scene time' }).fill('0')
  await expect(scene).not.toContainText(prompt)
  await page.getByRole('slider', { name: 'Scene time' }).fill('4')
  await expect(scene).toContainText(prompt)

  await page.getByRole('button', { name: /Portrait/ }).click()
  await expect(play).toBeEnabled()
  await expect(scene).not.toContainText(prompt)
  await play.click()
  await expect(scene).toContainText(prompt)
})
