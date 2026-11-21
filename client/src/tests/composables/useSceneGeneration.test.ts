import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SceneGeneration } from '../../composables/useSceneGeneration.svelte'
import type { GeneratedScene, SceneJob } from '../../lib/scene-generation'
import { registerMediaBinSource, unregisterMediaBinSource } from '../../lib/media-bin'

const api = vi.hoisted(() => ({ create: vi.fn(), status: vi.fn(), register: vi.fn() }))

vi.mock('../../lib/scene-generation', async original => ({
  ...await original<typeof import('../../lib/scene-generation')>(),
  createSceneJob: api.create, getSceneJob: api.status, registerGeneratedScene: api.register,
}))

function scene(id: string): GeneratedScene {
  return { id, title: id, brief: 'Original animation', start: 0, end: 2, component: '<p>Original</p>', manifest: null,
    asset: { id, file: `ai_scene_${'a'.repeat(32)}_01.scene.json`, version: 'hash', kind: 'video', duration: 2 },
    source: { version: 1, component: '<p>Original</p>', javascript: 'bundle', config: { width: 320, height: 180, fps: 30, durationInFrames: 60 } } }
}

function setup(): SceneGeneration {
  const generation = new SceneGeneration()
  generation.job = { id: 'original-job', status: 'completed', message: 'Ready', progress: 1, transcript: 'Original narration', scenes: [scene('first'), scene('second')] }
  generation.selectedId = 'second'
  generation.beginEdit()
  generation.editDraft!.prompt = 'Make it blue'
  return generation
}

describe('scene editing lifecycle', () => {
  beforeEach(() => {
    api.create.mockReset().mockResolvedValue({ id: 'edit-job', status: 'queued', message: 'Queued', progress: 0, scenes: [] })
    api.status.mockReset()
    api.register.mockReset()
  })

  it('keeps the current preview while editing and replaces only the selected scene on completion', async () => {
    let complete!: (job: SceneJob) => void
    api.status.mockImplementation(() => new Promise(resolve => { complete = resolve }))
    const generation = setup()
    const pending = generation.editSelected()
    await vi.waitFor(() => expect(api.status).toHaveBeenCalled())
    expect(generation.selected?.id).toBe('second')
    expect(generation.job?.scenes.map(scene => scene.id)).toEqual(['first', 'second'])
    expect(api.create.mock.calls[0][0]).toMatchObject({ sourceFile: generation.selected!.asset.file, prompt: 'Make it blue', duration: 2 })
    complete({ id: 'edit-job', status: 'completed', message: 'Ready', progress: 1, scenes: [scene('edited')] })
    await pending
    expect(generation.job?.scenes.map(scene => scene.id)).toEqual(['first', 'edited'])
    expect(generation.selected?.id).toBe('edited')
    expect(generation.job?.transcript).toBe('Original narration')
    expect(generation.editDraft).toBeNull()
    expect(api.register).toHaveBeenCalledOnce()
  })

  it('recovers an interrupted edit without losing siblings and keeps the old scene after a terminal failure', async () => {
    const generation = setup()
    api.status.mockRejectedValueOnce(new Error('Network lost'))
    await generation.editSelected()
    expect(generation.phase).toMatchObject({ kind: 'error', jobId: 'edit-job' })
    expect(generation.selected?.id).toBe('second')
    api.status.mockResolvedValueOnce({ id: 'edit-job', status: 'completed', message: 'Ready', progress: 1, scenes: [scene('edited')] })
    await generation.retryStatus()
    expect(generation.job?.scenes.map(scene => scene.id)).toEqual(['first', 'edited'])
    generation.beginEdit()
    generation.editDraft!.prompt = 'Change again'
    api.status.mockResolvedValueOnce({ id: 'failed-job', status: 'failed', message: 'Cannot compile this edit', progress: 0, scenes: [] })
    await generation.editSelected()
    expect(generation.selected?.id).toBe('edited')
    expect(generation.phase).toMatchObject({ kind: 'error', message: 'Cannot compile this edit' })
    expect(generation.canEdit).toBe(true)
  })

  it('ignores late edit responses after reset', async () => {
    let complete!: (job: SceneJob) => void
    api.create.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    const generation = setup()
    const pending = generation.editSelected()
    generation.reset()
    complete({ id: 'late', status: 'completed', message: 'Ready', progress: 1, scenes: [scene('late')] })
    await pending
    expect(generation.job).toBeNull()
    expect(generation.phase.kind).toBe('idle')
    expect(api.status).not.toHaveBeenCalled()
  })

  it('removes a deleted scene from the dialog instead of allowing it to be reinserted', () => {
    const generation = setup()
    const selected = generation.selected!
    selected.asset.file = `ai_scene_${'b'.repeat(32)}_01.scene.json`
    registerMediaBinSource({ id: selected.id, name: selected.asset.file, kind: 'video', duration: 2, sourceMode: 'proxy' })
    unregisterMediaBinSource(selected.asset.file)
    expect(generation.job?.scenes.map(scene => scene.id)).toEqual(['first'])
    expect(generation.selected?.id).toBe('first')
    expect(generation.editDraft).toBeNull()
    expect(generation.canEdit).toBe(false)
  })

  it('keeps deleted partial results removed when a later job poll returns them again', async () => {
    const generation = new SceneGeneration()
    const generated = scene('generated')
    generation.job = { id: 'running-job', status: 'generating', message: 'Running', progress: 0.5, scenes: [generated] }
    generation.selectedId = generated.id
    generation.phase = { kind: 'error', message: 'Reconnect', jobId: 'running-job' }
    registerMediaBinSource({ id: generated.id, name: generated.asset.file, kind: 'video', duration: 2, sourceMode: 'proxy' })
    unregisterMediaBinSource(generated.asset.file)
    api.status.mockResolvedValueOnce({ ...generation.job, status: 'completed', scenes: [generated] })
    await generation.retryStatus()
    expect(generation.job?.scenes).toEqual([])
    expect(api.register).not.toHaveBeenCalled()
  })
})
