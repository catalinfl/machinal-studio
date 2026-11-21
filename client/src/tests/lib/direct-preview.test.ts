import { describe, expect, it } from 'vitest'
import { Matrix, Sprite, Texture } from 'pixi.js'
import { canPresentDirectPreview, DirectPreviewLayers, previewLayerMatrix, scenePreviewMatrix, scenePreviewGeometry, previewLayerBounds } from '../../lib/direct-preview'
import { DEFAULT_CLIP_TRANSFORM, normalizeClipTransform } from '../../lib/clip-transform'
import type { Channel, Clip, EffectBlock } from '../../stores/editor.svelte'

function entry(id: string, fileName = `ai_scene_${'a'.repeat(32)}_01.scene.json`) {
  const clip: Clip = { id, fileName, scrubBlobUrl: null, sourceDuration: 5, inPoint: 0, outPoint: 5, start: 0 }
  const channel: Channel = { id, name: id, type: 'video', clips: [clip], muted: false, hidden: false, locked: false }
  return { channel, clip }
}

describe('direct preview composition', () => {
  it('keeps interactive scene bounds aligned with scaling, positioning and rotation', () => {
    const source = { width: 640, height: 360 }
    const view = { width: 1920, height: 1080 }
    const transform = normalizeClipTransform({ zoomX: 0.5, zoomY: 0.5, positionX: 25 })
    expect(previewLayerBounds(scenePreviewGeometry(source, view, transform))).toEqual({ x: 960, y: 270, width: 960, height: 540 })
    const rotated = previewLayerBounds(scenePreviewGeometry(source, view, { ...transform, rotation: 90 }))
    expect(rotated.x).toBeCloseTo(1170)
    expect(rotated.y).toBeCloseTo(60)
    expect(rotated.width).toBeCloseTo(540)
    expect(rotated.height).toBeCloseTo(960)
  })

  it('composes scenes, images and ordinary video on distinct channels without capture', () => {
    expect(canPresentDirectPreview([entry('scene'), entry('image', 'overlay.png'), entry('video', 'video.mp4'), entry('scene-2')], [], 1)).toBe(true)
    expect(canPresentDirectPreview([entry('image', 'overlay.png')], [], 1)).toBe(false)
    expect(canPresentDirectPreview([], [], 1)).toBe(false)
  })

  it('composes cross-dissolves directly and keeps other overlaps on the transition compositor', () => {
    const left = entry('left'), right = entry('right')
    right.channel = left.channel
    expect(canPresentDirectPreview([left, right], [], 1)).toBe(true)
    expect(canPresentDirectPreview([left, right], [], 1, () => 'wipe-left')).toBe(false)
    expect(canPresentDirectPreview([right], [], 1)).toBe(true)
  })

  it('falls back only for currently active, relevant Pixi effects', () => {
    const scene = entry('scene'), image = entry('image', 'overlay.png')
    const effect: EffectBlock = { id: 'effect', effectId: 'grayscale', channelId: 'image', params: {}, ramp: null, start: 1, duration: 2, nodeId: null }
    expect(canPresentDirectPreview([scene, image], [effect], 0)).toBe(true)
    expect(canPresentDirectPreview([scene, image], [effect], 1)).toBe(true)
    expect(canPresentDirectPreview([scene, image], [{ ...effect, effectId: 'film-grain' }], 1)).toBe(false)
    expect(canPresentDirectPreview([scene, image], [effect], 3)).toBe(true)
    expect(canPresentDirectPreview([scene, image], [{ ...effect, ownerClipId: 'other' }], 1)).toBe(true)
  })

  it('fits scenes in the same coordinate system as the Pixi preview', () => {
    expect(scenePreviewMatrix({ width: 320, height: 180 }, { width: 200, height: 200 }, DEFAULT_CLIP_TRANSFORM)).toBe('matrix(0.625,0,0,0.625,0,43.75)')
    const transform = normalizeClipTransform({ zoomX: 2, zoomY: 0.5, positionX: 10, positionY: -20, anchorX: 0.2, anchorY: 0.8, rotation: 35, pitch: 20, yaw: -15, flipH: true })
    const value = scenePreviewMatrix({ width: 320, height: 180 }, { width: 640, height: 360 }, transform)
    const matrix = new Matrix().setTransform(384, 108, 64, 144, -4, 1, 35 * Math.PI / 180, -15 * Math.PI / 180 * 0.55, 20 * Math.PI / 180 * 0.55)
    const actual = value.slice(7, -1).split(',').map(Number)
    for (const [index, expected] of [matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty].entries()) {
      expect(actual[index]).toBeCloseTo(expected, 10)
    }
  })

  it('fills direct scene previews and interaction bounds using the same centered crop as footage', () => {
    const source = { width: 320, height: 180 }
    const view = { width: 180, height: 320 }
    const geometry = scenePreviewGeometry(source, view, DEFAULT_CLIP_TRANSFORM, 'cover')
    const bounds = previewLayerBounds(geometry)
    expect(bounds.y).toBe(0)
    expect(bounds.height).toBe(320)
    expect(bounds.x).toBeCloseTo((180 - 320 * 320 / 180) / 2)
    expect(scenePreviewMatrix(source, view, DEFAULT_CLIP_TRANSFORM, 'cover')).toBe(previewLayerMatrix(geometry))
  })

  it('reuses cached media in place and hides obsolete layers without destroying them', () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const layers = new DirectPreviewLayers(() => parent)
    const canvas = document.createElement('canvas')
    const video = document.createElement('video')
    const sprite = new Sprite(Texture.EMPTY)
    sprite.position.set(100, 50)
    sprite.anchor.set(0.5)
    try {
      layers.begin({ width: 200, height: 100 })
      layers.present(canvas, sprite, 1)
      layers.present(video, sprite, 3)
      layers.end()
      expect(canvas.parentElement).toBe(layers.host)
      expect(canvas.style.transform).toBe(previewLayerMatrix(sprite))
      expect(video.style.zIndex).toBe('3')
      layers.begin({ width: 300, height: 150 })
      layers.present(canvas, sprite, 2)
      layers.end()
      expect(layers.host.style.width).toBe('300px')
      expect(canvas.style.zIndex).toBe('2')
      expect(video.style.display).toBe('none')
      expect(video.dataset.directPreviewLayer).toBeUndefined()
      expect(video.parentElement).toBe(layers.host)
      layers.begin({ width: 300, height: 150 })
      layers.end()
      expect(canvas.style.display).toBe('none')
    } finally {
      layers.dispose()
      expect(parent.childElementCount).toBe(0)
      sprite.destroy()
      parent.remove()
    }
  })
})
