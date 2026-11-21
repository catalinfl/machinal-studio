import catalog from './speech-catalog.json'

export const DEFAULT_SPEECH_MODEL = 'google/gemini-3.8-flash-tts'

const voiceSets: Record<string, string[]> = catalog.voiceSets

export const SPEECH_MODELS = catalog.models.map((model) => ({
  ...model,
  voices: model.voices ?? voiceSets[model.voiceSet ?? ''] ?? [],
  legacy: model.legacy ?? false,
}))

export type SpeechModel = (typeof SPEECH_MODELS)[number]['id']

export function speechVoiceLanguage(family: string, voice: string): string | undefined {
  if (family === 'mai') return voice.slice(0, 2)
  if (family === 'voxtral') return voice.startsWith('gb_') ? 'en' : voice.split('_')[0]
  if (family !== 'kokoro') return undefined
  return ({ a: 'en', b: 'en', e: 'es', f: 'fr', h: 'hi', i: 'it', j: 'ja', p: 'pt', z: 'zh' } as Record<string, string>)[voice[0]]
}

export function speechLanguageCompatible(model: typeof SPEECH_MODELS[number], language?: string, voice?: string): boolean {
  if (!language || language === 'auto') return true
  const base = language.toLowerCase().replace('_', '-').split('-')[0]
  const voiceLanguage = voice ? speechVoiceLanguage(model.family, voice) : undefined
  return model.languages.includes(base) && (!voiceLanguage || voiceLanguage === base)
}
