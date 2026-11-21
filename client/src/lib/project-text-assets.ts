import type { DocumentSession, PreparedText, PreparedTextReference } from './composition-types'

export interface ProjectTextAsset {
  reference: PreparedTextReference
  value: PreparedText
}

export async function textAssetDigest(source: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
}

export async function prepareSessionText(
  session: DocumentSession,
  load?: (reference: PreparedTextReference) => Promise<PreparedText>,
): Promise<DocumentSession> {
  const assets = new Map<string, Promise<ProjectTextAsset>>()

  async function prepare(value?: PreparedText, reference?: PreparedTextReference): Promise<ProjectTextAsset | undefined> {
    if (!value && !reference) return undefined
    if (!value) {
      if (!load) throw new Error('The saved caption images could not be restored. Your project has not been changed.')
      const existing = assets.get(reference!.id)
      if (existing) {
        const asset = await existing
        if (asset.reference.key !== reference!.key) throw new Error('The saved caption images have conflicting render keys.')
        return asset
      }
      const pending = load(reference!).then(value => {
        if (value.key !== reference!.key) throw new Error('The saved caption images do not match their render key.')
        return { value, reference: reference! }
      })
      assets.set(reference!.id, pending)
      return pending
    }
    const id = await textAssetDigest(JSON.stringify(value))
    const existing = assets.get(id)
    if (existing) return existing
    const asset = { value, reference: { id, key: value.key } }
    assets.set(id, Promise.resolve(asset))
    return asset
  }

  const primary = await prepare(session.preparedText, session.preparedTextRef)
  const compiled = await prepare(session.composition.preparedText, session.composition.preparedTextRef)
  return {
    ...session,
    preparedText: primary?.value,
    preparedTextRef: primary?.reference,
    composition: { ...session.composition, preparedText: compiled?.value, preparedTextRef: compiled?.reference },
  }
}

export function compactSessionText(session: DocumentSession | null): DocumentSession | null {
  if (!session) return null
  const primary = session.preparedTextRef && (!session.preparedText || session.preparedText.key === session.preparedTextRef.key)
  const compiled = session.composition.preparedTextRef && (!session.composition.preparedText || session.composition.preparedText.key === session.composition.preparedTextRef.key)
  return {
    ...session,
    ...(primary ? { preparedText: undefined } : {}),
    composition: { ...session.composition, ...(compiled ? { preparedText: undefined } : {}) },
  }
}

export function sessionTextAssets(session: DocumentSession | null): ProjectTextAsset[] {
  const assets = new Map<string, ProjectTextAsset>()
  if (session) {
    for (const item of [session, session.composition]) {
      if (item.preparedText && item.preparedTextRef) assets.set(item.preparedTextRef.id, { reference: item.preparedTextRef, value: item.preparedText })
    }
  }
  return [...assets.values()]
}
