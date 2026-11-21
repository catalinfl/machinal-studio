import { expect, test } from '@playwright/test'

test('blur filters preserve source-pixel scale and valid texture edges in WebGL', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && /shader|webgl|glsl|pixi/i.test(message.text())) errors.push(message.text())
  })
  await page.goto('/')

  const samples = await page.evaluate(async () => {
    const { Application, Sprite, Texture, createPixiFilters, planPixiEffect } = await import('/e2e/helpers/preview-pixi.ts')
    const source = document.createElement('canvas')
    source.width = 320
    source.height = 160
    const context = source.getContext('2d')!
    context.fillStyle = 'black'
    context.fillRect(0, 0, 320, 160)
    context.fillStyle = 'white'
    context.fillRect(0, 0, 160, 160)
    const results = []

    for (const resolution of [1, 2]) {
      const app = new Application()
      await app.init({ width: 80, height: 40, resolution, preference: 'webgl' })
      const sprite = new Sprite(Texture.from(source))
      sprite.scale.set(0.25)
      app.stage.addChild(sprite)
      for (const id of ['directional-blur', 'blur', 'soft-focus', 'gaussian-blur']) {
        const params = id === 'directional-blur' ? { angle: 0, radius: 8 }
          : id === 'soft-focus' || id === 'gaussian-blur' ? { sigma: 4, brightness: 0, saturation: 1 }
          : { lumaRadius: 8 }
        const built = createPixiFilters(planPixiEffect(id, params, 1, 0), { w: 320, h: 160 }, { x: 0.25, y: 0.25 })
        sprite.filters = built.filters
        const { pixels, width } = app.renderer.extract.pixels({ target: app.stage, resolution: 1 })
        const sample = (x: number) => pixels[(20 * width + x) * 4]
        results.push({ id, resolution, edge: sample(1), far: sample(32), near: sample(39), dark: sample(48) })
        sprite.filters = []
        built.filters.forEach((filter) => filter.destroy())
      }
      app.destroy(true, { children: true, texture: true, textureSource: true })
    }
    return results
  })

  expect(errors).toEqual([])
  for (const sample of samples) {
    expect(sample.edge, JSON.stringify(sample)).toBeGreaterThan(245)
    expect(sample.far, JSON.stringify(sample)).toBeGreaterThan(245)
    expect(sample.near, JSON.stringify(sample)).toBeLessThan(240)
    expect(sample.near, JSON.stringify(sample)).toBeGreaterThan(100)
    expect(sample.dark, JSON.stringify(sample)).toBeLessThan(10)
  }
})
