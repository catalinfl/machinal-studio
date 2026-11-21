import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'
import { createRecipeAction, recipeActionError } from '../../lib/recipe-action-fields'
import { inspectRecipeActions, nextRecipeActionID, removeRecipeAction, saveRecipeAction, withRecipeDefinition } from '../../lib/recipe-actions'
import { parseProjectFile } from '../../lib/composition-file'
import type { EditDocument } from '../../lib/composition-types'

const base = `# Keep the project header
document:
  version: 1
  mode: assemble
  tracks:
    - id: video
      type: video
      clips: [{id: clip, assetId: source, start: 0, inPoint: 0, outPoint: 5}]
  texts: [{id: fixed-title, text: Fixed, start: 0, duration: 2, rotation: 8, fontFamily: montserrat}]
bindings: {}
assets: [{id: source, file: original.mp4, kind: video, version: hash, duration: 5}]
`

describe('visual recipe actions', () => {
  it('adds deferred image generation and transformed placement without losing the timeline or comments', () => {
    const action = createRecipeAction('image', 'image-1', 2)
    if (action.kind !== 'image') throw new Error('Expected image action')
    action.prompt = 'A coastal town'
    action.transform.positionX = -24
    const source = saveRecipeAction(base, action)
    const project = parseProjectFile(source)
    const document = project.document as EditDocument
    expect(document.version).toBe(1)
    expect(document.tracks?.[0].clips[0].id).toBe('clip')
    expect(document.texts?.[0]).toMatchObject({ text: 'Fixed', rotation: 8 })
    expect(document.before?.[0]).toMatchObject({ type: 'image.generate', prompt: 'A coastal town', duration: 5, model: action.model })
    expect(document.before?.[0].resultAssetId).toBeUndefined()
    expect(document.placements?.[0]).toMatchObject({ job: 'image-1', start: 2, duration: 5, transform: { positionX: -24, zoomX: 0.62 } })
    expect(project.assets).toHaveLength(1)
    expect(source).toContain('# Keep the project header')
  })

  it('edits imported actions with time units and preserves custom generation fields and placement roles', () => {
    const source = `mode: modify
before:
  - {id: cover, type: image.generate, prompt: Old, aspect: '16:9', model: 'openai/gpt-image-2.6-sunburst', resultAssetId: old-result}
placements:
  - {job: cover, track: {type: video, role: custom-layer}, start: 2500ms, duration: 3s, transform: {rotation: 8}}
after:
  - {id: captions, type: captions.generate, maxWords: 4, input: montage, style: {fontSize: 72, y: 820}}
`
    const inspection = inspectRecipeActions(source)
    expect(inspection.error).toBeNull()
    const entry = inspection.actions[0]
    expect(entry.action).toMatchObject({ start: 2.5, duration: 3, transform: { rotation: 8 } })
    if (entry.action.kind !== 'image') throw new Error('Expected image action')
    entry.action.prompt = 'New description'
    const updated = parseDocument(saveRecipeAction(source, entry.action, entry.ref)).toJS()
    expect(updated.before[0].resultAssetId).toBeUndefined()
    expect(updated.placements[0].track.role).toBe('custom-layer')
    expect(updated.placements[0].transform.rotation).toBe(8)
    const captions = inspectRecipeActions(saveRecipeAction(source, entry.action, entry.ref)).actions[1]
    if (captions.action.kind !== 'captions') throw new Error('Expected captions action')
    captions.action.maxWords = 3
    const result = parseDocument(saveRecipeAction(source, captions.action, captions.ref)).toJS()
    expect(result.after[0]).toMatchObject({ input: 'montage', maxWords: 3, style: { fontSize: 72, y: 820 } })
  })

  it('removes an image and its placements without removing other actions', () => {
    const action = createRecipeAction('image', 'image-1', 0)
    if (action.kind !== 'image') throw new Error('Expected image action')
    action.prompt = 'Coast'
    const source = saveRecipeAction(saveRecipeAction(base, action), createRecipeAction('captions', 'captions-1', 0))
    const removed = parseDocument(removeRecipeAction(source, { section: 'before', id: action.id })).toJS()
    expect(removed.document.before).toEqual([])
    expect(removed.document.placements).toEqual([])
    expect(removed.document.after[0].id).toBe('captions-1')
    expect(removed.document.texts[0].text).toBe('Fixed')
  })

  it('preserves existing text styling while changing its content and timing', () => {
    const entry = inspectRecipeActions(base).actions[0]
    if (entry.action.kind !== 'text') throw new Error('Expected text action')
    entry.action.text = 'New title'
    entry.action.start = 1
    const document = parseDocument(saveRecipeAction(base, entry.action, entry.ref)).toJS().document
    expect(document.texts[0]).toMatchObject({ text: 'New title', start: 1, rotation: 8, fontFamily: 'montserrat' })
  })

  it('promotes the saved reusable definition when editing and invalidates prepared text', () => {
    const source = `document: {version: 2, mode: assemble, tracks: [], jobs: [{id: voice, type: speech.generate, resultAssetId: generated}]}
recipe:
  version: 2
  mode: assemble
  before: [{id: voice, type: speech.generate, text: Original, model: 'google/gemini-3.1-flash-tts-preview', voice: Zephyr}]
  placements: [{job: voice, track: {type: audio, role: narration}, start: 0}]
bindings: {}
assets: []
preparedText: {key: stale, overlays: []}
`
    const entry = inspectRecipeActions(source).actions[0]
    if (entry.action.kind !== 'voice') throw new Error('Expected voice action')
    entry.action.text = 'Updated'
    const result = parseDocument(saveRecipeAction(source, entry.action, entry.ref)).toJS()
    expect(result.document.before[0].text).toBe('Updated')
    expect(result.document.jobs).toBeUndefined()
    expect(result.recipe).toBeUndefined()
    expect(result.preparedText).toBeUndefined()
  })

  it('keeps advanced rules and multi-placement jobs in DSL while allowing other actions', () => {
    const source = `mode: modify
rules: [{id: style, target: {kind: video}, apply: {look: raw-story}}]
before: [{id: cover, type: image.generate, prompt: Coast}]
placements:
  - {job: cover, track: {type: video, role: a}, start: 0, duration: 2}
  - {job: cover, track: {type: video, role: b}, start: 3, duration: 2}
`
    expect(inspectRecipeActions(source)).toMatchObject({ actions: [], advancedCount: 2, error: null })
    const result = parseDocument(saveRecipeAction(source, createRecipeAction('captions', 'captions-1', 0))).toJS()
    expect(result.rules[0].id).toBe('style')
    expect(result.placements).toHaveLength(2)
  })

  it('reports invalid YAML and rejects invalid input before changing the source', () => {
    expect(inspectRecipeActions('document: [')).toMatchObject({ actions: [], error: expect.any(String) })
    const action = createRecipeAction('image', 'image-1', 0)
    expect(recipeActionError(action)).toContain('Describe')
    expect(() => saveRecipeAction(base, action)).toThrow('Describe')
    if (action.kind !== 'image') throw new Error('Expected image action')
    action.prompt = 'Coast'
    action.duration = Number.NaN
    expect(() => saveRecipeAction(base, action)).toThrow('duration')
  })

  it('allocates stable unique IDs and retains the reusable definition for assembly', () => {
    const first = createRecipeAction('voice', 'voice-1', 0)
    if (first.kind !== 'voice') throw new Error('Expected voice action')
    first.text = 'Hello'
    const source = saveRecipeAction(base, first)
    expect(nextRecipeActionID(source, 'voice')).toBe('voice-2')
    const project = withRecipeDefinition(parseProjectFile(source))
    expect(project.recipe).toMatchObject({ mode: 'assemble', before: [{ text: 'Hello' }] })
    expect(project.bindings).toEqual({})
  })

  it('round-trips scene generation and edits without changing the DSL version', () => {
    const action = createRecipeAction('scene', 'scene-1', 3)
    if (action.kind !== 'scene') throw new Error('Expected scene action')
    action.prompt = 'Animate a growing tree'
    action.duration = 12
    const source = saveRecipeAction(base, action)
    const document = parseDocument(source).toJS().document
    expect(document.version).toBe(1)
    expect(document.before[0]).toMatchObject({ type: 'scene.generate', prompt: action.prompt, duration: 12 })
    expect(document.placements[0]).toMatchObject({ job: action.id, track: { type: 'video' }, start: 3 })
    const entry = inspectRecipeActions(source).actions.find(entry => entry.action.kind === 'scene')!
    if (entry.action.kind !== 'scene') throw new Error('Expected scene action')
    entry.action.operation = 'edit'
    entry.action.assetId = 'existing-scene'
    entry.action.prompt = 'Change only the colors'
    const edited = parseDocument(saveRecipeAction(source, entry.action, entry.ref)).toJS().document
    expect(edited.version).toBe(1)
    expect(edited.before[0]).toMatchObject({ type: 'scene.edit', assetId: 'existing-scene', duration: 12 })
    expect(inspectRecipeActions(saveRecipeAction(source, entry.action, entry.ref)).advancedCount).toBe(0)
  })

  it('reads image duration from before and keeps an omitted version omitted', () => {
    const source = `mode: assemble\nbefore: [{id: cover, type: image.generate, prompt: Coast, duration: 3s}]\nplacements: [{job: cover, track: {type: video, role: cover}, start: 2s}]\n`
    const entry = inspectRecipeActions(source).actions[0]
    expect(entry.action).toMatchObject({ duration: 3, start: 2 })
    expect(parseDocument(saveRecipeAction(source, entry.action, entry.ref)).toJS().version).toBeUndefined()
  })
})
