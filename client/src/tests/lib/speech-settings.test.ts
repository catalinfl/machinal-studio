import { describe, expect, it } from 'vitest'
import { buildSpeechRequest, validateSpeech, type SpeechSettings } from '../../lib/speech-settings'

const settings: SpeechSettings = {
  input: '  Hello world  ',
  model: 'fish-audio/s2.1-pro',
  voiceMode: 'clone',
  voice: 'unused',
  referenceName: 'sample.mp3',
  referenceTranscript: '  Reference words  ',
  permissionConfirmed: true,
}

describe('speech settings', () => {
  it('builds clone requests without sending preset-only fields', () => {
    expect(buildSpeechRequest(settings)).toEqual({
      input: 'Hello world',
      language: 'auto',
      model: 'fish-audio/s2.1-pro',
      referenceName: 'sample.mp3',
      referenceTranscript: 'Reference words',
    })
    expect(buildSpeechRequest({ ...settings, referenceTranscript: '  ' })).not.toHaveProperty('referenceTranscript')
    expect(settings.input).toBe('  Hello world  ')
  })

  it('builds preset requests without leaking reference data', () => {
    expect(buildSpeechRequest({ ...settings, model: 'x-ai/grok-voice-tts-1.0', voiceMode: 'preset', voice: 'eve' })).toEqual({
      input: 'Hello world', language: 'auto', model: 'x-ai/grok-voice-tts-1.0', voice: 'eve',
    })
  })

  it('requires an authorized reference for a clone-capable model', () => {
    expect(validateSpeech(settings)).toBe(true)
    expect(validateSpeech({ ...settings, referenceName: '' })).toBe(false)
    expect(validateSpeech({ ...settings, permissionConfirmed: false })).toBe(false)
    expect(validateSpeech({ ...settings, model: 'x-ai/grok-voice-tts-1.0' })).toBe(false)
  })

  it('preserves the explicitly selected narration language', () => {
    expect(buildSpeechRequest({ ...settings, language: 'ro' }).language).toBe('ro')
    expect(buildSpeechRequest({ ...settings, language: 'en' }).language).toBe('en')
  })

  it('requires a voice supported by the selected preset model', () => {
    const preset: SpeechSettings = { ...settings, model: 'x-ai/grok-voice-tts-1.0', voiceMode: 'preset', voice: 'eve' }
    expect(validateSpeech(preset)).toBe(true)
    expect(validateSpeech({ ...preset, voice: 'missing' })).toBe(false)
  })

  it('rejects empty input and counts Unicode characters at the input limit', () => {
    expect(validateSpeech({ ...settings, input: '  ' })).toBe(false)
    expect(validateSpeech({ ...settings, input: '😀'.repeat(4000) })).toBe(true)
    expect(validateSpeech({ ...settings, input: '😀'.repeat(4001) })).toBe(false)
  })
})
