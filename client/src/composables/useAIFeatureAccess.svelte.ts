import { requestedAIFeature, type AIFeature } from '../lib/ai-access'

export function useAIFeatureAccess() {
  return {
    request(_feature: AIFeature, onGranted?: () => void): void { onGranted?.() },
    resume(): AIFeature | null { return requestedAIFeature(window.location.search) },
    close(): void {},
    settlePendingGrant(): void {},
    get feature(): AIFeature | null { return null },
  }
}
