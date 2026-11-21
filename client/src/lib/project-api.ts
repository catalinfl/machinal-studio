import { API_BASE } from './api-origin'
import { selectProjectSession, startProjectSession } from './session'
import type { ProjectState } from './project-state'
import type { ProjectPresentation } from './project-presentation'

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
  if (!response.ok) throw new Error(response.status === 409
    ? 'This project changed in another tab. Reload the project to continue.'
    : `Could not ${body === undefined ? 'load' : 'save'} local projects. Check that the local API is running, then retry.`)
  return response.json() as Promise<T>
}
