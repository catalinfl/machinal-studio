import { DEMO_SCENES, type DemoSceneId } from './landing'

export const DEMO_FRAME = { w: 960, h: 540, fps: 24 }

export function createDemoArtwork(id: DemoSceneId): HTMLCanvasElement {
  const scene = DEMO_SCENES.find(scene => scene.id === id)!
  const canvas = document.createElement('canvas')
  canvas.width = DEMO_FRAME.w
  canvas.height = DEMO_FRAME.h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = scene.ground
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = scene.ink
  ctx.font = '500 17px "IBM Plex Sans Variable"'
  ctx.fillText('machinal / your creative playground', 48, 48)
  ctx.font = '500 83px "IBM Plex Sans Variable"'
  scene.words.forEach((line, index) => ctx.fillText(line, 48, 253 + index * 88))
  ctx.font = '400 16px "IBM Plex Sans Variable"'
  ctx.fillText('A small idea. A different direction.', 48, 492)
  ctx.strokeStyle = scene.ink
  ctx.lineWidth = 14
  ctx.beginPath()
  ctx.moveTo(750, 175)
  ctx.lineTo(890, 35)
  ctx.moveTo(750, 35)
  ctx.lineTo(890, 35)
  ctx.lineTo(890, 175)
  ctx.stroke()
  return canvas
}
