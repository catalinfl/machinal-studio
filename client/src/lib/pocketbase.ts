// Compatibility for project/session helpers; no SDK, tokens, storage or network.
export const pb = {
  authStore: {
    record: { id: 'local' },
    token: '',
    isValid: true,
    onChange(_listener: () => void): () => void { return () => {} },
  },
}
