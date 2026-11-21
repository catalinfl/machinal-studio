import { describe, expect, it, vi } from 'vitest'
import { sceneVideoInputs, validateEmbeddedSceneVideos, validateSceneVideoFiles, type SceneVideoDraft } from '../../lib/scene-videos'
import { uploadSceneVideos } from '../../lib/scene-generation'

function video(name = 'footage.mp4'): SceneVideoDraft {
  return { id: 'draft', file: new File(['original footage'], name, {type:'video/mp4'}), uploadName:'scene_video_unique.mp4', previewUrl:'blob:thumbnail', description:' Slow zoom ', look:'cinematic' }
}

describe('scene video attachments', () => {
  it('preserves independent usage directions and chosen looks with stable scene IDs', () => {
    expect(sceneVideoInputs([video()])).toEqual([{id:'video_1',file:'scene_video_unique.mp4',name:'footage.mp4',description:'Slow zoom',look:'cinematic'}])
    expect(() => validateSceneVideoFiles([video().file], 2)).toThrow('2 videos')
    expect(() => validateSceneVideoFiles([new File(['x'], 'unsupported.mov', {type:'video/quicktime'})])).toThrow('MP4')
    expect(() => sceneVideoInputs([{...video(),description:'ș'.repeat(601)}])).toThrow('600')
  })

  it('uploads original files under unique names without leaking browser URLs', async () => {
    const fetch = vi.fn().mockResolvedValue({ok:true})
    vi.stubGlobal('fetch',fetch)
    try {
      await uploadSceneVideos([video()],new AbortController().signal)
      const request = fetch.mock.calls[0][1]
      const file = request.body.get('file') as File
      expect(file.name).toBe('scene_video_unique.mp4')
      expect(file.size).toBe(video().file.size)
    } finally { vi.unstubAllGlobals() }
  })

  it('accepts portable embedded footage and rejects external sources or invalid IDs', () => {
    expect(() => validateEmbeddedSceneVideos({video_1:'data:video/mp4;base64,AA=='})).not.toThrow()
    for (const sources of [{video_3:'data:video/mp4;base64,AA=='},{video_1:'https://example.test/video.mp4'},{video_1:'data:text/html;base64,AA=='}]) {
      expect(() => validateEmbeddedSceneVideos(sources)).toThrow('invalid')
    }
  })
})
