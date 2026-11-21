import { describe, expect, it } from 'vitest'
import { videoFitFilter, videoFitScale } from '../../lib/video-fit'

describe('video framing', () => {
  it('fills portrait output without shrinking landscape footage to its width', () => {
    expect(videoFitScale(1920, 1080, 1080, 1920, 'contain')).toBe(1080 / 1920)
    const scale = videoFitScale(1920, 1080, 1080, 1920, 'cover')
    expect(scale).toBe(1920 / 1080)
    expect(1080 * scale).toBe(1920)
    expect(1920 * scale).toBeGreaterThan(1080)
  })

  it('crops top and bottom for portrait sources in landscape output', () => {
    expect(videoFitScale(1080, 1920, 1920, 1080, 'cover')).toBe(1920 / 1080)
    expect(videoFitScale(1920, 1080, 1280, 720, 'cover')).toBe(2 / 3)
  })

  it('uses a centered, even-sized crop for fill and padded whole-image framing by default', () => {
    expect(videoFitFilter(1080, 1920, 'cover')).toBe('scale=1080:1920:force_original_aspect_ratio=increase:force_divisible_by=2,crop=1080:1920:(iw-ow)/2:(ih-oh)/2,setsar=1')
    expect(videoFitFilter(1080, 1920)).toBe('scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1')
    expect(videoFitFilter(406, 720, 'contain', { padColor: 'black', forceDivisibleBy: 2 })).toContain('force_divisible_by=2,pad=406:720:(ow-iw)/2:(oh-ih)/2:color=black')
  })
})
