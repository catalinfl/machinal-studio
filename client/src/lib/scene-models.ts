const modelPrefix = 'data:model/gltf-binary;base64,'
const maxModelBytes = 4 * 1024 * 1024

export function validateEmbeddedSceneModels(models: unknown): void {
  if (models === undefined) return
  if (!models || typeof models !== 'object' || Array.isArray(models)) throw new Error('Invalid embedded scene models')
  const entries = Object.entries(models)
  if (entries.length > 2) throw new Error('Attach at most two GLB models')
  for (const [id, source] of entries) {
    if (!/^model_[12]$/.test(id) || typeof source !== 'string' || !source.startsWith(modelPrefix) || source.length > modelPrefix.length + Math.ceil(maxModelBytes / 3) * 4) throw new Error('Invalid embedded GLB attachment')
    const encoded = source.slice(modelPrefix.length)
    if (!encoded.length || encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('Invalid embedded GLB encoding')
    const decoded = atob(encoded)
    if (decoded.length < 28 || decoded.length > maxModelBytes) throw new Error('Invalid embedded GLB length')
    const header = new DataView(Uint8Array.from(decoded.slice(0, 20), value => value.charCodeAt(0)).buffer)
    if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== decoded.length) throw new Error('Invalid embedded GLB container')
  }
}
