export const AI_FEATURES = {
  image: 'Image generation',
  ai: 'AI Edit',
  captions: 'Voice to text',
  tts: 'Text to speech',
  render: 'Server render',
  scenes: 'Scene generation',
} as const

export type AIFeature = keyof typeof AI_FEATURES

export function requestedAIFeature(search: string): AIFeature | null {
  const feature = new URLSearchParams(search).get('ai')
  return feature === 'image' || feature === 'ai' || feature === 'captions' || feature === 'tts' || feature === 'render' || feature === 'scenes' ? feature : null
}
