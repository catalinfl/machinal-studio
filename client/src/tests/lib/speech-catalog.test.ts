import { describe, expect, it } from 'vitest'
import { DEFAULT_SPEECH_MODEL, SPEECH_MODELS, speechLanguageCompatible } from '../../lib/speech-catalog'
import { createRecipeAction } from '../../lib/recipe-action-fields'
import { validateSpeech } from '../../lib/speech-settings'

describe('shared speech catalog', () => {
  it('uses Gemini 3.8 Flash for new work and retains explicit legacy recipes', () => {
    expect(DEFAULT_SPEECH_MODEL).toBe('google/gemini-3.8-flash-tts')
    expect(createRecipeAction('voice', 'voice', 0)).toMatchObject({ model: DEFAULT_SPEECH_MODEL })
    expect(SPEECH_MODELS.find((model) => model.id === 'google/gemini-3.1-flash-tts-preview')?.legacy).toBe(true)
    expect(SPEECH_MODELS.find((model) => model.id === 'google/gemini-3.8-flash-lite-tts')?.voices).toContain('Kore')
    expect(SPEECH_MODELS.every((model) => !model.detail.includes('$'))).toBe(true)
  })

  it('offers economy without pretending incompatible voices speak Romanian', () => {
    const kokoro = SPEECH_MODELS.find((model) => model.id === 'hexgrad/kokoro-82m')!
    expect(kokoro.voices).toHaveLength(54)
    expect(kokoro.tier).toBe('economy')
    expect(speechLanguageCompatible(kokoro, 'en-US', 'af_heart')).toBe(true)
    expect(speechLanguageCompatible(kokoro, 'ro', 'af_heart')).toBe(false)
    expect(speechLanguageCompatible(kokoro, 'hi', 'hf_alpha')).toBe(true)
    expect(speechLanguageCompatible(kokoro, 'it', 'if_sara')).toBe(true)
    expect(speechLanguageCompatible(kokoro, 'en', 'if_sara')).toBe(false)
    expect(validateSpeech({
      input: 'Salut!', language: 'ro', model: kokoro.id, voiceMode: 'preset', voice: 'af_heart',
      referenceName: '', referenceTranscript: '', permissionConfirmed: false,
    })).toBe(false)
  })
})
