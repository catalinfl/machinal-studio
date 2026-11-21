import { expect, test } from '@playwright/test'

test('local render applies each audio clip volume', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')

  const levels = await page.evaluate(async () => {
    const { compileProjectLocal } = await import('../src/lib/local-render')
    const sampleRate = 44_100
    const duration = 0.5
    const sampleCount = Math.round(sampleRate * duration)
    const bytes = new ArrayBuffer(44 + sampleCount * 2)
    const view = new DataView(bytes)
    const writeText = (offset: number, value: string) => {
      for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index))
    }
    writeText(0, 'RIFF')
    view.setUint32(4, 36 + sampleCount * 2, true)
    writeText(8, 'WAVE')
    writeText(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    writeText(36, 'data')
    view.setUint32(40, sampleCount * 2, true)
    for (let index = 0; index < sampleCount; index++) {
      const sample = Math.sin(2 * Math.PI * 440 * index / sampleRate) * 0.2
      view.setInt16(44 + index * 2, Math.round(sample * 0x7fff), true)
    }
    const source = new Blob([bytes], { type: 'audio/wav' })
    const volumes = [0, 50, 150]
    const result = await compileProjectLocal({
      resolution: { w: 640, h: 360 },
      fps: 30,
      videoChannels: [],
      audioChannels: [{
        clips: volumes.map((volume, index) => ({
          file: 'tone.wav',
          inPoint: 0,
          outPoint: duration,
          start: index * duration,
          volume,
          segments: [],
        })),
      }],
    }, { resolveSource: async () => source })

    const context = new AudioContext()
    const decoded = await context.decodeAudioData(await result.blob.arrayBuffer())
    const samples = decoded.getChannelData(0)
    const rms = (start: number, end: number) => {
      let sum = 0
      let count = 0
      for (let index = Math.floor(start * decoded.sampleRate); index < end * decoded.sampleRate; index++) {
        sum += samples[index] ** 2
        count++
      }
      return Math.sqrt(sum / count)
    }
    const measured = [rms(0.1, 0.4), rms(0.6, 0.9), rms(1.1, 1.4)]
    await context.close()
    return measured
  })

  expect(levels[0]).toBeLessThan(0.001)
  expect(levels[1]).toBeGreaterThan(0.04)
  expect(levels[2]).toBeGreaterThan(levels[1] * 2.5)
})

test('local render keeps source-contiguous cuts free of audio seams', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')

  const analysis = await page.evaluate(async () => {
    const { compileProjectLocal } = await import('../src/lib/local-render')
    const sampleRate = 44_100
    const duration = 2
    const sampleCount = sampleRate * duration
    const bytes = new ArrayBuffer(44 + sampleCount * 2)
    const view = new DataView(bytes)
    const writeText = (offset: number, value: string) => {
      for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index))
    }
    writeText(0, 'RIFF')
    view.setUint32(4, 36 + sampleCount * 2, true)
    writeText(8, 'WAVE')
    writeText(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    writeText(36, 'data')
    view.setUint32(40, sampleCount * 2, true)
    for (let index = 0; index < sampleCount; index++) {
      const sample = Math.sin(2 * Math.PI * 440 * index / sampleRate) * 0.2
      view.setInt16(44 + index * 2, Math.round(sample * 0x7fff), true)
    }
    const source = new Blob([bytes], { type: 'audio/wav' })
    const boundaries = [0, 0.431, 0.917, 1.376, duration]
    const result = await compileProjectLocal({
      resolution: { w: 640, h: 360 },
      fps: 30,
      videoChannels: [],
      audioChannels: [{
        clips: boundaries.slice(0, -1).map((start, index) => ({
          file: 'continuous.wav',
          mediaKind: 'audio' as const,
          inPoint: start,
          outPoint: boundaries[index + 1],
          start,
          volume: 100,
          segments: [],
        })),
      }],
    }, { resolveSource: async () => source })

    const context = new AudioContext()
    const decoded = await context.decodeAudioData(await result.blob.arrayBuffer())
    const samples = decoded.getChannelData(0)
    const boundaryRms = boundaries.slice(1, -1).map((boundary) => {
      const start = Math.floor((boundary - 0.004) * decoded.sampleRate)
      const end = Math.ceil((boundary + 0.004) * decoded.sampleRate)
      let sum = 0
      for (let index = start; index < end; index++) sum += samples[index] ** 2
      return Math.sqrt(sum / (end - start))
    })
    await context.close()
    return { boundaryRms, duration: decoded.duration }
  })

  expect(analysis.duration).toBeCloseTo(2, 2)
  expect(Math.min(...analysis.boundaryRms)).toBeGreaterThan(0.08)
})
