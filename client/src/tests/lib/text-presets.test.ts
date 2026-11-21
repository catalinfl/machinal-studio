import { describe, expect, it } from 'vitest'
import { captionStyleForPreset, SHORT_FORM_TEXT_PRESETS, TEXT_ANIMATION_OPTIONS } from '../../lib/text-presets'

describe('short-form text presets', () => {
  it('offers a broad unique catalog backed by every text motion', () => {
    expect(SHORT_FORM_TEXT_PRESETS).toHaveLength(21)
    expect(new Set(SHORT_FORM_TEXT_PRESETS.map((preset) => preset.id)).size).toBe(21)

    const usedMotions = new Set(SHORT_FORM_TEXT_PRESETS.map((preset) => preset.values.animation))
    for (const option of TEXT_ANIMATION_OPTIONS) {
      if (option.id !== 'none') expect(usedMotions).toContain(option.id)
    }
  })

  it('turns a text preset into deterministic caption styling without replacing cue content or timing', () => {
    const preset = SHORT_FORM_TEXT_PRESETS.find((candidate) => candidate.id === 'hook-pop')!

    expect(captionStyleForPreset(preset)).toMatchObject({
      animation: 'pop',
      animationDuration: 0.28,
      fontFamily: 'montserrat',
      fontSize: 70,
      highlightMode: 'none',
      isCaption: true,
    })
    expect(captionStyleForPreset(preset)).not.toHaveProperty('text')
    expect(captionStyleForPreset(preset)).not.toHaveProperty('duration')
    expect(captionStyleForPreset(preset)).not.toHaveProperty('words')
  })
})
