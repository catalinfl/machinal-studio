import { describe, expect, it } from 'vitest'
import { EFFECTS, groupEffectsByCategory } from '../../lib/effects'
import { CLIP_LOOKS } from '../../lib/clip-looks'
import { filterPaletteGroups, filterPaletteItems } from '../../lib/palette-search'

describe('palette search', () => {
  const effectFields = (effect: (typeof EFFECTS)[number]) => [
    effect.label, effect.summary, effect.category, effect.id,
  ]

  it('keeps the complete catalog for a blank query', () => {
    const groups = groupEffectsByCategory(EFFECTS)
    expect(filterPaletteGroups(groups, '  ', effectFields)).toBe(groups)
    expect(filterPaletteItems(CLIP_LOOKS, '', (look) => [look.label])).toBe(CLIP_LOOKS)
  })

  it('finds effects without case or surrounding whitespace changing the result', () => {
    const groups = groupEffectsByCategory(EFFECTS.filter((effect) => effect.kind === 'effect'))
    const result = filterPaletteGroups(groups, '  SEPIA  ', effectFields)
    expect(result.flatMap((group) => group.items).some((effect) => effect.id === 'sepia')).toBe(true)
    expect(result.every((group) => group.items.length > 0)).toBe(true)
    expect(result).toEqual(filterPaletteGroups(groups, 'sepia', effectFields))
    expect(groups.flatMap((group) => group.items)).toHaveLength(EFFECTS.filter((effect) => effect.kind === 'effect').length)
  })

  it('matches description and ID in the readonly looks catalog', () => {
    const fields = (look: (typeof CLIP_LOOKS)[number]) => [look.label, look.description, look.category, look.id]
    const look = CLIP_LOOKS.find((look) => look.id === 'sepia-strobe')!
    expect(filterPaletteItems(CLIP_LOOKS, look.id, fields)).toContain(look)
    expect(filterPaletteItems(CLIP_LOOKS, look.description, fields)).toContain(look)
    expect(filterPaletteItems(CLIP_LOOKS, 'no-such-catalog-entry', fields)).toEqual([])
  })
})
