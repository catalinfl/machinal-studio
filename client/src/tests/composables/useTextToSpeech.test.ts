import { describe, expect, it } from 'vitest'
import { resolveVoiceSettings } from '../../composables/useTextToSpeech.svelte'
import { SPEECH_MODELS } from '../../lib/speech'

describe('resolveVoiceSettings', () => {
  it('defaults clone-capable models to cloning', () => {
    const model = SPEECH_MODELS.find((candidate) => candidate.id === 'fish-audio/s2.1-pro')!
    expect(resolveVoiceSettings(model)).toEqual({ voiceMode: 'clone', voice: '' })
  })

  it('falls back to the first valid preset voice', () => {
    const model = SPEECH_MODELS.find((candidate) => candidate.id === 'mistralai/voxtral-mini-tts-2603')!
    expect(resolveVoiceSettings(model, 'preset', 'missing-voice')).toEqual({
      voiceMode: 'preset',
      voice: model.voices[0],
    })
  })
})
