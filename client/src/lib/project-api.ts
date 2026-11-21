import { API_BASE } from './api-origin'
import { selectProjectSession, startProjectSession } from './session'
import type { ProjectState } from './project-state'
import type { ProjectPresentation, PreparedComposition } from './project-presentation'
import type { PreparedText, PreparedTextReference } from './composition-types'
import type { ProjectTextAsset } from './project-text-assets'
import { loadCachedProjectText } from './project-text-cache'

export interface ProjectSummary {
  id: string
  name: string
  sessionId: string
  mediaToken?: string
  version: number
  createdAt: string
  updatedAt: string
}

export interface SavedProject extends ProjectSummary {
  state: ProjectState | null
  presentation?: ProjectPresentation
  presentationWarning?: string
}

export function projectOwner(): string { return 'local' }

export class ProjectRequestError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export function projectConflict(): ProjectRequestError {
  return new ProjectRequestError(409, 'This project changed in another tab. Your unsaved changes are still in this tab. Download a draft before reloading.')
}

function textAssetURL(projectId: string, reference: PreparedTextReference): string {
  if (!/^[a-f0-9]{64}$/.test(reference.id) || !reference.key || reference.key.length > 128) throw new Error('Invalid saved caption image reference.')
  return `${API_BASE}/projects/${encodeURIComponent(projectId)}/text-assets/${reference.id}?key=${encodeURIComponent(reference.key)}`
}

export async function loadProjectTextAsset(projectId: string, reference: PreparedTextReference): Promise<PreparedText> {
  const url = textAssetURL(projectId, reference)
  return loadCachedProjectText(projectOwner(), projectId, reference, async () => {
    const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' })
    if (!response.ok) throw new Error('The saved caption images could not be loaded. Your project has not been changed; retry loading it.')
    return response.text()
  })
}

export async function loadPreparedComposition(projectId: string, prepared: PreparedComposition): Promise<PreparedComposition> {
  if (!prepared.preparedTextRef || !prepared.composition || prepared.composition.preparedText) return prepared
  const preparedText = await loadProjectTextAsset(projectId, prepared.preparedTextRef)
  return { ...prepared, composition: { ...prepared.composition, preparedText } }
}

export async function saveProjectTextAsset(projectId: string, asset: ProjectTextAsset): Promise<void> {
  const response = await fetch(textAssetURL(projectId, asset.reference), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', body: JSON.stringify(asset.value),
  })
  if (!response.ok) throw new ProjectRequestError(response.status, 'The caption image cache could not be saved. Your unsaved project is still in this tab; retry saving it.')
}

export function activateProject(project: ProjectSummary): () => void {
  selectProjectSession(project.sessionId, project.mediaToken)
  return startProjectSession(API_BASE)
}

export async function projectRequest<T>(path = '', body?: unknown, keepalive = false): Promise<T> {
  const response = await fetch(`${API_BASE}/projects${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' }, credentials: 'omit',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), keepalive,
  }).catch(() => {
    throw new Error('Could not reach the local API. Start the local Docker services and retry.')
  })
  if (response.status === 409) throw projectConflict()
  if (!response.ok) throw new ProjectRequestError(response.status, (await response.text()).slice(0, 500) || `Could not ${body === undefined ? 'load' : 'save'} local projects. Check that the local API is running, then retry.`)
  return response.json() as Promise<T>
}
