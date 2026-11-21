import { expect, test } from '@playwright/test'

test.skip(!process.env.CATALOG_FFMPEG_INTEGRATION, 'set CATALOG_FFMPEG_INTEGRATION=1 to validate the vendored FFmpeg core')

test('new effects and every transition execute in the vendored FFmpeg core', async ({ browser }) => {
  test.setTimeout(300_000)

  const effectIds = [
    'glow-bloom', 'halation', 'lens-flare', 'light-rays', 'radial-aberration',
    'vhs-tracking', 'vhs-head-noise', 'datamosh', 'glitch-bands', 'bad-tv',
    'crt-curvature', 'crt-phosphor', 'color-isolation', 'duotone', 'tritone',
    'false-color', 'solarize', 'infrared', 'thermal', 'cross-process',
    'gate-weave', 'dust-scratches', 'film-flicker', 'old-projector', 'comic-book',
    'oil-painting', 'neon-edges', 'kaleidoscope', 'tiny-planet', 'tilt-shift',
  ]
  const failures: string[] = []
  const batchSize = 5
  const transitionCount = 76

  const runBatch = async (batch: { effectIds: string[]; transitionStart: number; transitionEnd: number }) => {
    const page = await browser.newPage()

    try {
      await page.goto('/')
      return await page.evaluate(async ({ effectIds, transitionStart, transitionEnd }) => {
        const effectsModule = await import('/src/lib/effects.ts')
        const wasmModule = await import('/src/lib/wasm.ts')
        const ffmpeg = await wasmModule.createFFmpeg()
        const transitions = effectsModule.EFFECTS.filter(
          (item) => item.kind === 'transition',
        ).slice(transitionStart, transitionEnd)
        const errors: string[] = []
        let lastLog = ''
        ffmpeg.on('log', ({ message }) => { lastLog = message })

        for (const id of effectIds) {
          const output = `catalog_effect_${id}.mp4`
          lastLog = ''
          const code = await ffmpeg.exec([
            '-f', 'lavfi', '-i', 'testsrc2=size=96x54:rate=12:duration=0.25',
            '-vf', effectsModule.buildFilter(id, 0.25),
            '-frames:v', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
            '-y', output,
          ])
          if (code !== 0) errors.push(`effect ${id}: ${lastLog || `exit ${code}`}`)
          try { await ffmpeg.deleteFile(output) } catch {}
        }

        for (const transition of transitions) {
          const output = `catalog_transition_${transition.id}.mp4`
          lastLog = ''
          const code = await ffmpeg.exec([
            '-f', 'lavfi', '-i', 'color=c=0x254b87:size=96x54:rate=12:duration=0.5',
            '-f', 'lavfi', '-i', 'color=c=0xc75b39:size=96x54:rate=12:duration=0.5',
            '-filter_complex', `[0:v][1:v]xfade=${effectsModule.xfadeFilter(transition.xfade)}:duration=0.25:offset=0.2[v]`,
            '-map', '[v]', '-frames:v', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
            '-y', output,
          ])
          if (code !== 0) errors.push(`transition ${transition.id}: ${lastLog || `exit ${code}`}`)
          try { await ffmpeg.deleteFile(output) } catch {}
        }

        ffmpeg.terminate()
        return errors
      }, batch)
    } finally {
      await page.close()
    }
  }

  for (let start = 0; start < effectIds.length; start += batchSize) {
    try {
      failures.push(...await runBatch({
        effectIds: effectIds.slice(start, start + batchSize),
        transitionStart: 0,
        transitionEnd: 0,
      }))
    } catch (error) {
      throw new Error(`effect batch ${start}-${start + batchSize - 1} crashed: ${String(error)}`)
    }
  }

  for (let start = 40; start < transitionCount; start += batchSize) {
    try {
      failures.push(...await runBatch({
        effectIds: [],
        transitionStart: start,
        transitionEnd: start + batchSize,
      }))
    } catch (error) {
      throw new Error(`transition batch ${start}-${start + batchSize - 1} crashed: ${String(error)}`)
    }
  }

  expect(failures).toEqual([])
})

for (const ids of [
  ['glow-bloom', 'contrast-pop', 'vignette'],
  ['comic-book', 'color-boost', 'sharpen-edges', 'stop-motion'],
  ['thermal', 'glitch-bands', 'contrast-pop', 'scanlines'],
]) {
  test(`compound effect chain executes: ${ids.join(', ')}`, async ({ page }) => {
    await page.goto('/')
    const result = await page.evaluate(async (effectIds) => {
      const effectsModule = await import('/src/lib/effects.ts')
      const wasmModule = await import('/src/lib/wasm.ts')
      const ffmpeg = await wasmModule.createFFmpeg()
      const instances = effectIds.map((id) => ({ id, params: effectsModule.defaultEffectParams(id) }))
      let lastLog = ''
      ffmpeg.on('log', ({ message }) => { lastLog = message })
      const code = await ffmpeg.exec([
        '-f', 'lavfi', '-i', 'testsrc2=size=96x54:rate=12:duration=0.25',
        '-vf', effectsModule.buildFilterChain(instances, 0.25),
        '-frames:v', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
        '-y', 'catalog_chain.mp4',
      ])
      ffmpeg.terminate()
      return { code, lastLog }
    }, ids)

    expect(result, result.lastLog).toMatchObject({ code: 0 })
  })
}
