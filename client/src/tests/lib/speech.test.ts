import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  uploadFile: vi.fn(),
  fetchFile: vi.fn(),
  execGuarded: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  deleteFile: vi.fn(),
  terminate: vi.fn(),
}))

vi.mock('@ffmpeg/util', () => ({ fetchFile: mocks.fetchFile }))
vi.mock('../../lib/api', () => ({
  API_BASE: '',
  downloadFile: vi.fn(),
  listProxySources: vi.fn(),
  uploadFile: mocks.uploadFile,
}))
vi.mock('../../lib/media-bin', () => ({
  getMediaBinSources: vi.fn(() => []),
  registerMediaBinSource: vi.fn(),
}))
vi.mock('../../lib/wasm', () => ({
  createFFmpeg: vi.fn(async () => ({
    loaded: true,
    writeFile: mocks.writeFile,
    readFile: mocks.readFile,
    deleteFile: mocks.deleteFile,
    terminate: mocks.terminate,
  })),
  execGuarded: mocks.execGuarded,
}))

import { uploadSpeechReference } from '../../lib/speech'

describe('speech references', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetchFile.mockResolvedValue(new Uint8Array([1, 2, 3]))
    mocks.readFile.mockResolvedValue(new Uint8Array([4, 5, 6]))
    mocks.uploadFile.mockResolvedValue('uploaded')
  })

  it('extracts at most 30 seconds locally and uploads only an MP3', async () => {
    const source = new File(['video'], 'My Interview.mp4', { type: 'video/mp4' })

    await expect(uploadSpeechReference(source, 12.5, 30)).resolves.toBe('My_Interview_voice.mp3')

    expect(mocks.execGuarded).toHaveBeenCalledWith(expect.anything(), expect.arrayContaining([
      '-ss', '12.500', '-t', '30.000', '-vn', '-c:a', 'libmp3lame',
    ]))
    expect(mocks.uploadFile).toHaveBeenCalledOnce()
    const uploaded = mocks.uploadFile.mock.calls[0][0] as File
    expect(uploaded).not.toBe(source)
    expect(uploaded.name).toBe('My_Interview_voice.mp3')
    expect(uploaded.type).toBe('audio/mpeg')
  })

  it('rejects segments longer than 30 seconds before loading FFmpeg', async () => {
    const source = new File(['audio'], 'voice.wav', { type: 'audio/wav' })

    await expect(uploadSpeechReference(source, 0, 30.1)).rejects.toThrow('between 0 and 30 seconds')
    expect(mocks.fetchFile).not.toHaveBeenCalled()
    expect(mocks.uploadFile).not.toHaveBeenCalled()
  })
})
