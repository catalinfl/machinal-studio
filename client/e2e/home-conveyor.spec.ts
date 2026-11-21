import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const reviewRoot = resolve('..', '.impeccable', 'review', process.env.CONVEYOR_REVIEW_RUN || '')

async function openHome(page: Page, theme = 'light') {
  await page.addInitScript(value => localStorage.setItem('scrub-theme', value), theme)
  await page.goto('/')
  await expect(page.locator('.video-conveyor')).toBeVisible()
  await page.getByRole('button', { name: 'Got it', exact: true }).click()
  await page.evaluate(() => document.fonts.ready)
  await page.locator('.video-conveyor image').evaluateAll(async elements => {
    const sources = [...new Set(elements.map(element => element.getAttribute('href')!))]
    await Promise.all(sources.map(async source => {
      const image = new Image()
      image.src = source
      await image.decode()
    }))
  })
}

async function setAnimationTime(page: Page, time: number) {
  await page.locator('.video-conveyor').evaluate((node, value) => {
    for (const animation of node.getAnimations({ subtree: true })) {
      animation.pause()
      animation.currentTime = value
    }
  }, time)
}

test('the conveyor loops without playback controls or a disclaimer', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await openHome(page)
  const conveyor = page.locator('.video-conveyor')
  await expect(conveyor).toHaveAttribute('data-running', 'true')
  const treads = page.locator('.belt-treads')
  const initial = await treads.evaluate(node => getComputedStyle(node).strokeDashoffset)
  await expect.poll(() => treads.evaluate(node => getComputedStyle(node).strokeDashoffset)).not.toBe(initial)
  await expect(conveyor.getByRole('button')).toHaveCount(0)
  await expect(page.getByText('Illustrative workflow · no files are uploaded')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('uses the same artwork in the inputs and the playing MP4', async ({ page }) => {
  const writes: string[] = []
  page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()) })
  await openHome(page)
  await expect(page.locator('.direction-demo')).toHaveCount(0)
  await expect(page.getByText('warm-memory', { exact: true })).toBeVisible()
  await expect(page.getByText('cross-dissolve', { exact: true })).toBeVisible()
  await expect(page.locator('.outgoing-film')).toContainText('Scenic route')
  for (const name of ['mountains', 'coast']) {
    const images = page.locator(`.video-conveyor image[href$="direction-${name}-ai.png"]`)
    await expect(images).toHaveCount(2)
    const response = await page.request.get(`/images/home/direction-${name}-ai.png`)
    expect(response.ok()).toBe(true)
    expect(response.headers()['content-type']).toContain('image/png')
  }
  await setAnimationTime(page, 7300)
  expect(Number(await page.locator('.film-second-scene').evaluate(node => getComputedStyle(node).opacity))).toBeGreaterThan(.95)
  await setAnimationTime(page, 6300)
  expect(Number(await page.locator('.film-second-scene').evaluate(node => getComputedStyle(node).opacity))).toBe(0)
  expect(writes).toEqual([])
})

for (const width of [1440, 390]) {
  for (const theme of ['light', 'dark']) {
    test(`feeds nearby files slowly from the left beneath the machine at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await openHome(page, theme)
      const film = page.locator('.outgoing-film')
      const sources = page.locator('.incoming-media')
      const video = page.locator('.source-video')
      const image = page.locator('.source-image')
      const output = resolve(reviewRoot, 'conveyor-close-feed')
      await mkdir(output, { recursive: true })

      await setAnimationTime(page, 0)
      expect(await film.evaluate(node => getComputedStyle(node).opacity)).toBe('0')
      expect(await sources.evaluate(node => getComputedStyle(node).opacity)).toBe('1')
      const scene = page.locator('.conveyor-scene')
      const beltTop = await scene.evaluate((node, y) => new DOMPoint(0, y).matrixTransform((node as SVGSVGElement).getScreenCTM()!).y, width === 390 ? 300 : 285)
      for (const source of await sources.locator('svg').all()) {
        const box = await source.boundingBox()
        expect(Math.abs(box!.y + box!.height - beltTop)).toBeLessThan(1)
      }
      const clip = page.locator('clipPath rect').first()
      expect(Number(await clip.getAttribute('x')) + Number(await clip.getAttribute('width'))).toBe(width === 390 ? 538 : 682)
      const leftEdge = await scene.evaluate(node => new DOMPoint(18, 0).matrixTransform((node as SVGSVGElement).getScreenCTM()!).x)
      const initiallyOutside = await video.boundingBox()
      expect(initiallyOutside!.x + initiallyOutside!.width).toBeLessThanOrEqual(leftEdge)

      await setAnimationTime(page, 1200)
      const earlierPosition = await video.evaluate(node => new DOMMatrix(getComputedStyle(node).transform).m41)
      await setAnimationTime(page, 2200)
      const laterPosition = await video.evaluate(node => new DOMMatrix(getComputedStyle(node).transform).m41)
      expect(laterPosition - earlierPosition).toBeCloseTo(910 / 4.2, 1)

      for (const [phase, time] of [['arriving', 500], ['paired', 2200], ['covered', width === 390 ? 2300 : 3100], ['second', 2900]] as const) {
        await setAnimationTime(page, time)
        expect(await film.evaluate(node => getComputedStyle(node).opacity)).toBe('0')
        for (const source of [video, image]) {
          expect(await source.evaluate(node => getComputedStyle(node).opacity)).toBe('1')
          expect(await source.evaluate(node => node.getAnimations().some(animation => (animation.effect as KeyframeEffect).getKeyframes().some(frame => 'opacity' in frame)))).toBe(false)
        }
        if (phase === 'arriving') {
          const waiting = await image.boundingBox()
          expect(waiting!.x + waiting!.width).toBeLessThanOrEqual(leftEdge)
        }
        if (phase === 'paired') {
          const leading = await video.boundingBox()
          const following = await image.boundingBox()
          const gap = leading!.x - following!.x - following!.width
          expect(gap).toBeGreaterThan(10)
          expect(gap).toBeLessThan(100)
        }
        if (phase === 'covered') {
          expect(await scene.evaluate((node, compact) => {
            const point = new DOMPoint(compact ? 418 : 562, compact ? 242 : 220).matrixTransform((node as SVGSVGElement).getScreenCTM()!)
            return !!document.elementFromPoint(point.x, point.y)?.closest('.machine-foreground')
          }, width === 390)).toBe(true)
        }
        await page.locator('.video-conveyor').screenshot({ path: `${output}/belt-${width}-${theme}-${phase}.png` })
      }
      await setAnimationTime(page, 5100)
      expect(await film.evaluate(node => getComputedStyle(node).opacity)).toBe('0')
      await setAnimationTime(page, 6900)
      expect(await film.evaluate(node => getComputedStyle(node).opacity)).toBe('1')
      await page.locator('.video-conveyor').screenshot({ path: `${output}/belt-${width}-${theme}-result.png` })
      await setAnimationTime(page, 10000)
      expect(await film.evaluate(node => getComputedStyle(node).opacity)).toBe('0')
    })

    test(`consumed files never flash back across the belt at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await openHome(page, theme)
      const output = resolve(reviewRoot, 'conveyor-flicker')
      await mkdir(output, { recursive: true })

      const boundaries = await page.locator('.conveyor-scene').evaluate(node => {
        const clip = node.querySelector('clipPath rect')!
        const left = Number(clip.getAttribute('x'))
        const right = left + Number(clip.getAttribute('width'))
        const matrix = (node as SVGSVGElement).getScreenCTM()!
        return {
          left: new DOMPoint(left, 0).matrixTransform(matrix).x,
          right: new DOMPoint(right, 0).matrixTransform(matrix).x,
        }
      })

      for (const iteration of [0, 1]) {
        for (const [kind, consumedAt] of [['video', 4200], ['image', 5200]] as const) {
          const source = page.locator(`.source-${kind}`)
          for (const offset of [-1, 0, .1, .25, .5, .75, .9, 1, 16, 100, 250]) {
            const time = iteration * 10000 + consumedAt + offset
            await setAnimationTime(page, time)
            const box = (await source.boundingBox())!
            expect(box.x, `${kind} reappeared at ${time} ms`).toBeGreaterThanOrEqual(boundaries.right)
          }

          if (iteration === 0) {
            await setAnimationTime(page, consumedAt + .5)
            await page.locator('.video-conveyor').screenshot({ path: `${output}/after-${width}-${theme}-${kind}.png` })
          }
        }

        await setAnimationTime(page, iteration * 10000 + 9999.9)
        for (const source of await page.locator('.source-video, .source-image').all()) {
          expect((await source.boundingBox())!.x).toBeGreaterThanOrEqual(boundaries.right)
        }

        await setAnimationTime(page, (iteration + 1) * 10000)
        for (const source of await page.locator('.source-video, .source-image').all()) {
          const box = (await source.boundingBox())!
          expect(box.x + box.width).toBeLessThanOrEqual(boundaries.left)
          expect(await source.locator('g').first().evaluate(node => new DOMMatrix(getComputedStyle(node).transform).m11)).toBe(1)
        }
      }
    })
  }
}

for (const width of [1440, 390]) {
  for (const theme of ['light', 'dark']) {
    test(`workflow annotations follow their active phases at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await openHome(page, theme)
      await expect(page.locator('.media-phase')).toHaveCount(1)
      await expect(page.locator('.recipe-phase')).toHaveCount(width === 390 ? 0 : 1)
      await expect(page.locator('.result-phase')).toHaveCount(2)
      const output = resolve(reviewRoot, 'conveyor-phases')
      await mkdir(output, { recursive: true })

      for (const iteration of [0, 1]) {
        for (const [time, media, recipe, result, spark] of [
          [0, 0, 0, 0, 0],
          [1000, 1, 0, 0, 0],
          [3000, 1, 1, 0, 0],
          [4200, 0, 1, 0, 0],
          [5800, 0, 0, 1, 1],
          [7500, 0, 0, 1, 0],
          [9500, 0, 0, 0, 0],
        ]) {
          await setAnimationTime(page, iteration * 10000 + time)
          for (const [selector, expected] of [
            ['.media-phase', media],
            ['.recipe-phase', recipe],
            ['.result-phase', result],
            ['.render-spark', spark],
          ] as const) {
            const opacities = await page.locator(selector).evaluateAll(nodes => nodes.map(node => Number(getComputedStyle(node).opacity)))
            expect(opacities.every(opacity => opacity === expected), `${selector} at ${time} ms in loop ${iteration}`).toBe(true)
          }
          if (iteration === 0 && [1000, 4200, 7500].includes(time)) {
            await page.locator('.video-conveyor').screenshot({ path: `${output}/phase-${width}-${theme}-${time}.png` })
          }
        }
      }
    })
  }
}

test('the smaller recipe stays aligned above the machine', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openHome(page)
  const recipe = page.locator('.recipe-art')
  await expect(recipe).toHaveAttribute('width', '180')
  await expect(recipe.locator('..').locator('..')).toHaveAttribute('transform', 'translate(528 9)')
})

for (const width of [1440, 390]) {
  for (const theme of ['light', 'dark']) {
    test(`one MP4 mirrors the intake effect without distortion at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await openHome(page, theme)
      const film = page.locator('.outgoing-film')
      const scene = page.locator('.conveyor-scene')
      const output = resolve(reviewRoot, 'conveyor-reverse-intake')
      await mkdir(output, { recursive: true })
      await expect(film).toHaveCount(1)
      await expect(film.locator('svg')).toHaveCount(1)
      const sourceDimensions = await page.locator('.source-video svg').evaluate(node => ({
        width: Number(node.getAttribute('width')),
        height: Number(node.getAttribute('height')),
      }))
      await expect(film.locator('svg')).toHaveAttribute('width', String(sourceDimensions.width))
      await expect(film.locator('svg')).toHaveAttribute('height', String(sourceDimensions.height))
      const outletHeight = await page.locator('.machine-outlet-cavity').evaluate(node => (node as SVGGraphicsElement).getBBox().height - 7)
      expect(outletHeight).toBeCloseTo(sourceDimensions.height * .74, 4)

      await setAnimationTime(page, 5100)
      expect(await film.evaluate(node => getComputedStyle(node).opacity)).toBe('0')

      let previousWidth = 0
      for (const [phase, time] of [
        ['slot', 5200],
        ['emerging', 5600],
        ['small', 6400],
        ['growing', 7100],
        ['ready', 7800],
      ] as const) {
        await setAnimationTime(page, time)
        const matrix = await film.locator('.film-size').evaluate(node => {
          const value = new DOMMatrix(getComputedStyle(node).transform)
          return { x: value.m11, y: value.m22 }
        })
        expect(matrix.x).toBeCloseTo(matrix.y, 5)
        expect(matrix.x).toBeGreaterThanOrEqual(.74)
        expect(matrix.x).toBeLessThanOrEqual(1)
        if (time <= 6400) expect(matrix.x).toBeCloseTo(.74, 5)
        else expect(matrix.x).toBeGreaterThan(.74)
        expect(await film.evaluate(node => getComputedStyle(node).opacity)).toBe('1')
        const picture = (await film.boundingBox())!
        expect(picture.width + .001).toBeGreaterThanOrEqual(previousWidth)
        previousWidth = picture.width

        if (phase === 'slot') {
          const center = { x: picture.x + picture.width / 2, y: picture.y + picture.height / 2 }
          expect(await page.evaluate(point => !!document.elementFromPoint(point.x, point.y)?.closest('.machine-foreground'), center)).toBe(true)
        }
        if (phase === 'growing' || phase === 'ready') {
          const center = { x: picture.x + picture.width / 2, y: picture.y + picture.height / 2 }
          expect(await page.evaluate(point => !!document.elementFromPoint(point.x, point.y)?.closest('.outgoing-film'), center)).toBe(true)
        }
        if (width === 1440) {
          const beltTop = await scene.evaluate(node => new DOMPoint(0, 285).matrixTransform((node as SVGSVGElement).getScreenCTM()!).y)
          expect(Math.abs(picture.y + picture.height - beltTop)).toBeLessThan(1)
          if (phase === 'small') {
            const arrow = (await page.locator('.flow-arrow').boundingBox())!
            expect(picture.x).toBeLessThanOrEqual(arrow.x + arrow.width)
            expect(picture.x + picture.width).toBeGreaterThanOrEqual(arrow.x)
          }
        }
        const sceneBox = (await scene.boundingBox())!
        expect(picture.x).toBeGreaterThanOrEqual(sceneBox.x)
        if (phase !== 'ready') expect(picture.x + picture.width).toBeLessThanOrEqual(sceneBox.x + sceneBox.width)
        await page.locator('.video-conveyor').screenshot({ path: `${output}/output-${width}-${theme}-${phase}.png` })
      }

      const samples = await film.evaluate(node => {
        const animations = node.closest('.video-conveyor')!.getAnimations({ subtree: true })
        const size = node.querySelector('.film-size')!
        const intake = node.closest('.conveyor-scene')!.querySelector('.intake-video')!
        const result = []
        for (let time = 6400; time <= 7800; time += 50) {
          for (const animation of animations) {
            animation.pause()
            animation.currentTime = time
          }
          const scale = new DOMMatrix(getComputedStyle(size).transform)
          const travel = new DOMMatrix(getComputedStyle(node).transform)
          for (const animation of animations) animation.currentTime = 2500 - (time - 6400)
          const reverseIntake = new DOMMatrix(getComputedStyle(intake).transform)
          result.push({ time, scaleX: scale.m11, scaleY: scale.m22, intakeScale: reverseIntake.m11, x: travel.m41, y: travel.m42 })
        }
        return result
      })
      for (let index = 1; index < samples.length; index++) {
        const current = samples[index]
        const previous = samples[index - 1]
        expect(current.scaleX, `reverse intake at ${current.time} ms`).toBeCloseTo(current.intakeScale, 5)
        expect(current.scaleY).toBeCloseTo(current.scaleX, 5)
        expect(current.scaleX).toBeGreaterThan(previous.scaleX)
        expect(Math.hypot(current.x - previous.x, current.y - previous.y), `travel at ${current.time} ms`).toBeGreaterThan(.1)
      }

      const sceneBox = (await scene.boundingBox())!
      for (const iteration of [0, 1]) {
        let previousX = -Infinity
        for (const time of [6900, 7000, 7500, 8000, 8500, 9000, 9500, 9999.9]) {
          await setAnimationTime(page, iteration * 10000 + time)
          expect(await film.evaluate(node => getComputedStyle(node).opacity)).toBe('1')
          const picture = (await film.boundingBox())!
          expect(picture.x, `continuous rightward exit at ${time} ms`).toBeGreaterThan(previousX)
          previousX = picture.x
        }
        expect(previousX).toBeGreaterThan(sceneBox.x + sceneBox.width)
        await setAnimationTime(page, (iteration + 1) * 10000)
        expect(await film.evaluate(node => getComputedStyle(node).opacity)).toBe('0')
      }

      await setAnimationTime(page, 10000)
      expect(await film.evaluate(node => getComputedStyle(node).opacity)).toBe('0')
    })
  }
}

for (const width of [1440, 390]) {
  for (const theme of ['light', 'dark']) {
    test(`recipe slides into the toaster slot at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await openHome(page, theme)
      const feed = page.locator('.incoming-recipe')
      const window = page.locator('.recipe-feed-window')
      const clipPath = await window.getAttribute('clip-path')
      expect(clipPath).toMatch(/^url\(#.+-recipe-slot\)$/)
      const path = await page.locator('clipPath[id$="-recipe-slot"] path').getAttribute('d')
      expect(path).toBe(width === 390 ? 'M0 0H620V189H567L548 201H0Z' : 'M0 0H1200V165H711L692 177H0Z')
      const output = resolve(reviewRoot, 'conveyor-feed')
      await mkdir(output, { recursive: true })
      for (const [phase, time] of [['aligned', 0], ['entering', 2500], ['inside', 4200]] as const) {
        await setAnimationTime(page, time)
        expect(await feed.evaluate(node => getComputedStyle(node).opacity)).toBe('1')
        if (phase === 'inside') {
          expect(await feed.evaluate(node => new DOMMatrix(getComputedStyle(node).transform).m42)).toBe(195)
        }
        await page.locator('.video-conveyor').screenshot({ path: `${output}/recipe-${width}-${theme}-${phase}.png` })
      }
    })
  }
}

for (const theme of ['light', 'dark']) {
  test(`the MP4 emerges over the outlet wall, not behind it, in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openHome(page, theme)
    const output = resolve(reviewRoot, 'conveyor-outlet-depth')
    await mkdir(output, { recursive: true })

    for (const time of [5600, 5800]) {
      await setAnimationTime(page, time)
      const layers = await page.locator('.machine-foreground').evaluate(node => {
        const matrix = (node as SVGGraphicsElement).getScreenCTM()!
        const layerAt = (x: number, y: number) => {
          const point = new DOMPoint(x, y).matrixTransform(matrix)
          return document.elementFromPoint(point.x, point.y)
        }
        return {
          front: !!layerAt(225, 90)?.closest('.machine-foreground'),
          opening: !!layerAt(238, 90)?.closest('.outgoing-film'),
          outerWall: !!layerAt(248, 90)?.closest('.outgoing-film'),
          lip: layerAt(233, 90)?.classList.contains('machine-outlet-lip'),
          above: !!layerAt(248, 40)?.closest('.machine-foreground'),
          below: !!layerAt(248, 150)?.closest('.machine-foreground'),
        }
      })
      expect(layers).toEqual({ front: true, opening: true, outerWall: true, lip: true, above: true, below: true })
      await page.locator('.video-conveyor').screenshot({ path: `${output}/outlet-1440-${theme}-${time}.png` })
    }
  })
}

test('stops offscreen and in a hidden document', async ({ page }) => {
  await openHome(page)
  const conveyor = page.locator('.video-conveyor')
  await page.locator('.closing').scrollIntoViewIfNeeded()
  await expect(conveyor).toHaveAttribute('data-running', 'false')
  await conveyor.scrollIntoViewIfNeeded()
  await expect(conveyor).toHaveAttribute('data-running', 'true')
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(conveyor).toHaveAttribute('data-running', 'false')
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(conveyor).toHaveAttribute('data-running', 'true')
})

test('reduced motion shows the complete static composition and responds to preference changes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openHome(page)
  await expect(page.getByText('Reduced motion', { exact: true })).toBeVisible()
  await expect(page.locator('.video-conveyor')).toHaveAttribute('data-running', 'false')
  expect(await page.locator('.video-conveyor').evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation instanceof CSSAnimation).length)).toBe(0)
  for (const selector of ['.incoming-media', '.incoming-recipe', '.outgoing-film']) {
    expect(await page.locator(selector).evaluate(node => getComputedStyle(node).opacity)).toBe('1')
  }
  const annotations = await page.locator('.media-phase, .recipe-phase, .result-phase, .render-spark').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).opacity))
  expect(annotations.every(opacity => opacity === '1')).toBe(true)
  expect(await page.locator('.outgoing-film').evaluate(node => getComputedStyle(node).transform)).toBe('none')
  expect(await page.locator('.film-size').evaluate(node => getComputedStyle(node).transform)).toBe('none')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect(page.getByText('Reduced motion', { exact: true })).toHaveCount(0)
  await expect(page.locator('.video-conveyor')).toHaveAttribute('data-running', 'true')
})

for (const width of [1440, 390]) {
  for (const theme of ['light', 'dark']) {
    test(`composition fits ${width}px in ${theme} appearance`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await openHome(page, theme)
      await expect(page.locator('.conveyor-scene')).toHaveClass(width === 390 ? /compact/ : /^conveyor-scene$/)
      await expect(page.locator('.belt-axle')).toHaveCount(0)
      await expect(page.locator('.belt-hub')).toHaveCount(2)
      await setAnimationTime(page, 0)
      expect(await page.locator('main.home').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
      const output = resolve(reviewRoot, 'conveyor-spacing')
      await mkdir(output, { recursive: true })
      await page.locator('main.home').evaluate(node => node.scrollTop = 0)
      await page.screenshot({ path: `${output}/conveyor-${width}-${theme}-first-view.png` })
      await page.locator('.video-conveyor').screenshot({ path: `${output}/conveyor-${width}-${theme}.png` })
      await setAnimationTime(page, 8900)
      await page.locator('.video-conveyor').screenshot({ path: `${output}/conveyor-${width}-${theme}-playing.png` })
    })
  }
}

for (const width of [1440, 390]) {
  for (const theme of ['light', 'dark']) {
    test(`mechanical detailing preserves the machine and belt geometry at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await openHome(page, theme)
      await expect(page.locator('.machine-original-top')).toHaveAttribute('width', '254')
      await expect(page.locator('.machine-original-top')).toHaveAttribute('height', '191')
      await expect(page.locator('.machine-foreground')).toHaveAttribute('transform', width === 390 ? 'translate(338 175)' : 'translate(482 151)')
      await expect(page.locator('.machine-rotor')).toHaveCount(2)
      await expect(page.locator('.machine-carriage')).toHaveCount(0)
      await expect(page.locator('.machine-reel, .machine-film')).toHaveCount(0)
      await expect(page.locator('.machine-gears')).toHaveAttribute('transform', 'translate(32 0)')
      await expect(page.locator('.machine-assembly')).not.toContainText('MAKE IT YOURS')
      await expect(page.locator('.machine-assembly path[d="M34 103h97m-97 25h97"], .machine-assembly path[d="M35 102h94m-94 25h94"]')).toHaveCount(0)
      await setAnimationTime(page, 1000)
      const gearStart = await page.locator('.machine-rotor').first().evaluate(node => new DOMMatrix(getComputedStyle(node).transform).m11)
      await setAnimationTime(page, 2000)
      const gearEnd = await page.locator('.machine-rotor').first().evaluate(node => {
        const matrix = new DOMMatrix(getComputedStyle(node).transform)
        return { x: matrix.m41, y: matrix.m42, rotation: matrix.m11 }
      })
      expect(gearEnd.x).toBe(0)
      expect(gearEnd.y).toBe(0)
      expect(gearEnd.rotation).not.toBe(gearStart)
      await expect(page.locator('.belt-hub')).toHaveCount(2)
      await expect(page.locator('.belt-outline')).toHaveAttribute('d', width === 390 ? 'M24 314H506Q566 314 566 374V470Q566 530 506 530H76' : 'M18 299H1182')
      const paintServers = await page.locator('.conveyor-scene').evaluate(node => {
        const ids = Array.from(node.querySelectorAll('[id]'), element => element.id)
        const references = Array.from(node.querySelectorAll('[fill^="url"], [clip-path^="url"]'), element => element.getAttribute('fill') || element.getAttribute('clip-path'))
        return ids.length === new Set(ids).size && references.every(value => !!document.getElementById(value!.slice(5, -1)))
      })
      expect(paintServers).toBe(true)
      const output = resolve(reviewRoot, 'mechanical-detail')
      await mkdir(output, { recursive: true })
      for (const [phase, time] of [['intake', 2200], ['processing', 4200], ['output', 7100]] as const) {
        await setAnimationTime(page, time)
        await page.locator('.video-conveyor').screenshot({ path: `${output}/${width}-${theme}-${phase}.png` })
      }
    })
  }
}
