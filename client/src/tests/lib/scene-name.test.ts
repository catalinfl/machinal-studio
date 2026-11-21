import { describe, expect, it } from 'vitest'
import { conciseSceneName, sceneFileDisplayName } from '../../lib/scene-name'

describe('scene display names', () => {
  it('uses a concise subject title without a file extension', () => {
    expect(conciseSceneName('  Rădăcini\nîn creștere.scene.json  ', 'Other description')).toBe('Rădăcini în creștere')
    expect(conciseSceneName('Neon streets.MP4')).toBe('Neon streets')
    expect(conciseSceneName('The roots unfold beneath the growing tree in warm light')).toBe('The roots unfold beneath the growing')
  })

  it('falls back from technical or generic titles to relevant scene copy', () => {
    const file = `ai_scene_${'a'.repeat(32)}_01.scene.json`
    expect(conciseSceneName(file, 'Generated scene', 'Edited scene', ' ', 'Roots unfold')).toBe('Roots unfold')
    expect(conciseSceneName('', undefined, 'Scene')).toBeUndefined()
    expect(conciseSceneName(42 as unknown as string, 'Roots unfold')).toBe('Roots unfold')
    expect(conciseSceneName('ș'.repeat(80))).toBe('ș'.repeat(60))
    expect(conciseSceneName(`${'a'.repeat(55)} growing roots`)).toBe('a'.repeat(55))
  })

  it('hides technical scene filenames even before their metadata loads', () => {
    expect(sceneFileDisplayName(`ai_scene_${'b'.repeat(32)}_03.scene.json`)).toBe('Scene 3')
    expect(sceneFileDisplayName(`ai_scene_${'c'.repeat(32)}_02.mp4`)).toBe('Scene 2')
    expect(sceneFileDisplayName('holiday.mp4')).toBeUndefined()
    expect(sceneFileDisplayName('data.json')).toBeUndefined()
  })
})
