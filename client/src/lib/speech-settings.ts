import { SPEECH_MODELS, type SpeechModel, type SpeechRequest } from './speech'
import { speechLanguageCompatible } from './speech-catalog'

export type SpeechSettings = {
  input: string
  language?: string
  model: SpeechModel
  voiceMode: 'clone' | 'preset'
  voice: string
  referenceName: string
  referenceTranscript: string
  permissionConfirmed: boolean
}

export function resolveVoiceSettings(
  model: typeof SPEECH_MODELS[number],
  requestedMode?: 'clone' | 'preset',
  requestedVoice?: string,
): { voiceMode: 'clone' | 'preset'; voice: string } {
  const voiceMode = requestedMode === 'clone' && model.cloning
    ? 'clone'
    : requestedMode === 'preset' && model.voices.length > 0
      ? 'preset'
      : model.cloning ? 'clone' : 'preset'

  const voice = requestedVoice && model.voices.some((voice) => voice === requestedVoice)
    ? requestedVoice
    : model.defaultVoice ?? model.voices[0] ?? ''

  return { voiceMode, voice }
}

export function validateSpeech(settings: SpeechSettings): boolean {
  const model = SPEECH_MODELS.find((candidate) => candidate.id === settings.model)
  if (!model || !settings.input.trim() || Array.from(settings.input).length > 4000) return false
  if (!speechLanguageCompatible(model, settings.language, settings.voiceMode === 'preset' ? settings.voice : undefined)) return false
  return settings.voiceMode === 'clone'
    ? model.cloning && !!settings.referenceName && settings.permissionConfirmed
    : model.voices.some((voice) => voice === settings.voice)
}

export function buildSpeechRequest(settings: SpeechSettings): SpeechRequest {
  const referenceTranscript = settings.referenceTranscript.trim()
  return {
    input: settings.input.trim(),
    language: settings.language ?? 'auto',
    model: settings.model,
    ...(settings.voiceMode === 'clone' ? {
      referenceName: settings.referenceName,
      ...(referenceTranscript ? { referenceTranscript } : {}),
    } : { voice: settings.voice }),
  }
}
