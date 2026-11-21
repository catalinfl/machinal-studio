import type { useProjects } from './useProjects.svelte'
import { projectRequest, type SavedProject } from '../lib/project-api'
import { API_BASE, authHeader } from '../lib/api'
import { editor } from '../stores/editor.svelte'

type Version = { id: string; name: string; projectVersion: number; createdAt: string }
type Phase = { kind: 'idle' } | { kind: 'working' } | { kind: 'error'; message: string }
type Pending = { kind: 'restore' | 'remove'; version: Version } | null

export function useProjectVersions(getProjects: () => ReturnType<typeof useProjects>) {
  let versions = $state<Version[]>([])
  let name = $state('')
  let pending = $state<Pending>(null)
  let phase = $state<Phase>({ kind: 'idle' })
  const busy = $derived(phase.kind === 'working')

  async function run(action: () => Promise<void>) {
    if (busy) return
    phase = { kind: 'working' }
    try {
      await action()
      phase = { kind: 'idle' }
    } catch (error) {
      phase = { kind: 'error', message: error instanceof Error ? error.message : 'Could not update versions.' }
    }
  }

  async function refresh() {
    const project = getProjects().current
    if (project) versions = await projectRequest<Version[]>(`/${project.id}/versions`)
  }

  async function save() {
    const projects = getProjects()
    await projects.save()
    if (!projects.current) return
    await projectRequest(`/${projects.current.id}/versions`, { name, version: projects.current.version })
    name = ''
    await refresh()
  }

  async function restoreVersion(version: Version) {
    const projects = getProjects()
    if (!projects.current) return
    const projectId = projects.current.id
    const revision = editor.stateRevision
    await projects.save()
    await projectRequest(`/${projectId}/versions`, { name: `Before restore: ${version.name}`.slice(0, 120), version: projects.current.version })
    const saved = await projectRequest<SavedProject>(`/${projectId}/versions/${version.id}`)
    if (projects.current?.id !== projectId || editor.stateRevision !== revision) throw new Error('The edit changed while preparing the restore. Your current edit has been kept.')
    await projects.restoreVersion(saved.state)
  }

  async function removeVersion(version: Version) {
    const project = getProjects().current
    if (!project) return
    const response = await fetch(`${API_BASE}/projects/${project.id}/versions/${version.id}`, { method: 'DELETE', headers: authHeader() })
    if (!response.ok) throw new Error('Could not remove this saved version.')
  }

  async function confirm() {
    const action = pending
    if (!action) return
    await run(async () => {
      if (action.kind === 'restore') await restoreVersion(action.version)
      else await removeVersion(action.version)
      pending = null
      await refresh()
    })
  }

  return {
    load: () => run(refresh),
    save: () => run(save),
    confirm,
    requestRestore: (version: Version) => { pending = { kind: 'restore', version } },
    requestRemove: (version: Version) => { pending = { kind: 'remove', version } },
    dismiss: () => { if (!busy) pending = null },
    get versions() { return versions },
    get name() { return name },
    set name(value: string) { name = value },
    get busy() { return busy },
    get phase() { return phase },
    get pending() { return pending },
  }
}
