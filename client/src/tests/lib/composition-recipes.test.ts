import { describe, expect, it } from 'vitest'
import { captionJobSnippet, generalizeDocument, imageJobSnippet, speechJobSnippet, starterRecipe } from '../../lib/composition-recipes'
import { parseDocument } from 'yaml'
import type { EditDocument } from '../../lib/composition-types'
import type { CaptionDraft } from '../../lib/subtitles'

describe('reusable recipe drafting', () => {
  it('generalizes a shared effect and specializes the second video without embedding asset ids', () => {
    const document = {
      version: 1, mode: 'assemble', tracks: [{ id: 'v1', type: 'video', clips: [
        { id: 'c1', start: 0, look: 'warm-memory' }, { id: 'c2', start: 2, look: 'raw-story' },
      ] }], effects: [
        { id: 'e1', ownerClipId: 'c1', preset: 'vignette', params: {} },
        { id: 'e2', ownerClipId: 'c2', preset: 'vignette', params: {} },
      ],
    } as unknown as EditDocument

    expect(generalizeDocument(document).rules).toEqual([
      { id: 'v1-each', target: { kind: 'video', trackId: 'v1', position: 'all' }, apply: { effect: { preset: 'vignette', params: {} } } },
      { id: 'v1-1', target: { kind: 'video', trackId: 'v1', position: 'nth', index: 1 }, apply: { look: 'warm-memory' } },
      { id: 'v1-2', target: { kind: 'video', trackId: 'v1', position: 'nth', index: 2 }, apply: { look: 'raw-story' } },
    ])
  })

  it('provides a before/after voice template with a symbolic job reference', () => {
    const recipe = starterRecipe('voice')
    expect(recipe.before?.[0].type).toBe('speech.generate')
    expect(recipe.placements?.[0]).toMatchObject({ job: 'voice', track: { type: 'audio', role: 'narration' } })
    expect(recipe.after?.[0].type).toBe('captions.generate')
  })

  it('exports selected generation settings as pasteable staged YAML', () => {
    const captions = parseDocument(captionJobSnippet(3)).toJS()
    expect(captions.after).toEqual([{ id: 'captions', type: 'captions.generate', language: 'auto', maxWords: 3 }])
    expect(JSON.stringify(captions)).not.toContain('resultTextIds')
    const styled = parseDocument(captionJobSnippet(2, { fontSize: 72, y: 820, highlightMode: 'word' } as CaptionDraft, 'ro')).toJS()
    expect(styled.after[0]).toMatchObject({ language: 'ro', maxWords: 2, style: { fontSize: 72, y: 820, highlightMode: 'word' } })
    expect(JSON.stringify(styled)).not.toContain('Keep my words')

    const speech = parseDocument(speechJobSnippet({ text: 'Salut', model: 'tts', referenceName: 'sample.mp3', start: 2 })).toJS()
    expect(speech.before[0]).toMatchObject({ text: 'Salut', model: 'tts', referenceName: 'sample.mp3' })
    expect(speech.placements[0]).toMatchObject({ job: 'voice', start: 2 })

    const image = parseDocument(imageJobSnippet({ prompt: 'sunset', model: 'image', aspect: '4:3', background: 'transparent', imageStyle: 'Film grain', start: 5, duration: 3 })).toJS()
    expect(image.before[0]).toMatchObject({ prompt: 'sunset', model: 'image', aspect: '4:3', background: 'transparent', imageStyle: 'Film grain' })
    expect(image.placements[0].duration).toBe(3)
  })
})
