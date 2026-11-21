import { afterEach, describe, expect, it, vi } from 'vitest'
import { LiveScenePlayer, type LiveSceneSource } from '../../lib/live-scene'

const source: LiveSceneSource = {
  version: 1, component: '<div>Scene</div>', javascript: 'void 0;',
  config: { width: 320, height: 180, fps: 30, durationInFrames: 300 },
}

afterEach(() => vi.restoreAllMocks())

describe('live scene playback', () => {
  it('uses preview dimensions, redraws a resized paused frame, and captures exports at full resolution', async () => {
    const player = new LiveScenePlayer(source, document.body)
    const commands: Array<{ id: number; frame: number; capture: boolean; renderScale: number; matrices: number[][] }> = []
    vi.spyOn(player.iframe.contentWindow!, 'postMessage').mockImplementation(message => { commands.push(message) })
    const respond = (index: number) => window.dispatchEvent(new MessageEvent('message', {
      source: player.iframe.contentWindow,
      data: { type: 'live-scene:response', id: commands[index].id, channel: player.channel },
    }))
    try {
      player.setPreviewSize(160, 90)
      player.iframe.dispatchEvent(new Event('load'))
      player.iframe.onload = null
      expect(commands[0].renderScale).toBe(0.5)
      respond(0)
      await player.ready()
      const first = player.present(1)
      await vi.waitFor(() => expect(commands).toHaveLength(2))
      respond(1)
      await first
      player.setPreviewSize(80, 45)
      const resized = player.present(1)
      await vi.waitFor(() => expect(commands).toHaveLength(3))
      expect(commands[2]).toMatchObject({ frame: 30, capture: false, renderScale: 0.25 })
      respond(2)
      await resized
      const matrices = [[1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]]
      const recolored = player.present(1, false, 1, matrices)
      await vi.waitFor(() => expect(commands).toHaveLength(4))
      expect(commands[3].matrices).toEqual(matrices)
      respond(3)
      await recolored
      const capture = player.seek(1, true, true)
      await vi.waitFor(() => expect(commands).toHaveLength(5))
      expect(commands[4]).toMatchObject({ capture: true, renderScale: 1, matrices: [] })
      respond(4)
      await capture
    } finally { player.dispose() }
  })

  it('coalesces slow preview frames to the latest time and sends pause even within the same frame', async () => {
    const player = new LiveScenePlayer(source, document.body)
    const commands: Array<{ id: number; channel: string; method: string; frame: number; playing: boolean; capture: boolean }> = []
    const send = vi.spyOn(player.iframe.contentWindow!, 'postMessage').mockImplementation(message => { commands.push(message) })
    const respond = (index: number) => window.dispatchEvent(new MessageEvent('message', {
      source: player.iframe.contentWindow,
      data: { type: 'live-scene:response', id: commands[index].id, channel: player.channel },
    }))
    try {
      player.iframe.dispatchEvent(new Event('load'))
      player.iframe.onload = null
      respond(0)
      await player.ready()
      const pending = player.present(1, true)
      void pending.catch(() => {})
      await Promise.resolve()
      for (let i = 0; i < 100; i++) void player.present(2 + i / 30, true)
      expect(commands).toHaveLength(2)
      respond(1)
      await vi.waitFor(() => expect(commands).toHaveLength(3))
      expect(commands[2]).toMatchObject({ frame: 159, playing: true, capture: false })
      respond(2)
      await pending
      await player.present(5.3, true)
      expect(send).toHaveBeenCalledTimes(3)
      const paused = player.present(5.3, false)
      await vi.waitFor(() => expect(commands).toHaveLength(4))
      expect(commands[3].playing).toBe(false)
      respond(3)
      await paused
    } finally { player.dispose() }
  })
})
