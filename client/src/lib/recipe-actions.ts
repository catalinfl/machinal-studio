import { parseDocument, stringify } from 'yaml'
import { parseProjectFile } from './composition-file'
import { DEFAULT_CLIP_TRANSFORM } from './clip-transform'
import { createRecipeAction, recipeActionError, type RecipeAction, type RecipeActionKind } from './recipe-action-fields'
import type { CompositionInput, EditDocument } from './composition-types'

type Job = NonNullable<EditDocument['before']>[number]
type Section = 'before' | 'after' | 'texts'
export type RecipeActionRef = { section: Section; id: string }
export type RecipeActionEntry = { ref: RecipeActionRef; action: RecipeAction }
export type RecipeActionInspection = { actions: RecipeActionEntry[]; advancedCount: number; clipCount: number; error: string | null }

function recipeSource(source: string) {
  const project = parseProjectFile(source)
  const root = parseDocument(source)
  const definition = project.recipe ?? project.document
  const nested = typeof definition === 'string' ? parseDocument(definition) : null
  if (nested?.errors.length) throw new Error(nested.errors[0].message)
  if (typeof definition === 'string') parseProjectFile(definition)
  const document = nested ? nested.toJS() : definition
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('The recipe document must be a mapping.')
  for (const key of ['before', 'after', 'texts', 'placements', 'jobs', 'tracks', 'commands', 'rules'] as const) {
    if (document[key] !== undefined && !Array.isArray(document[key])) throw new Error(`${key} must be a list. Fix it in Code DSL.`)
  }
  return { project, root, document: document as EditDocument, definition }
}

function seconds(value: number | string | undefined, fallback = 0): number {
  if (value === undefined) return fallback
  if (typeof value === 'number') return value
  const match = /^(-?\d+(?:\.\d+)?)(ms|s)?$/.exec(value)
  if (!match) throw new Error(`Invalid time “${value}”. Use seconds or explicit s/ms units.`)
  return Number(match[1]) / (match[2] === 'ms' ? 1000 : 1)
}

function jobAction(job: Job, document: EditDocument): RecipeAction | null {
  const kind = job.type === 'image.generate' ? 'image' : job.type === 'scene.generate' || job.type === 'scene.edit' ? 'scene' : job.type === 'speech.generate' ? 'voice' : job.type === 'captions.generate' ? 'captions' : null
  if (!kind) return null
  const action = createRecipeAction(kind, job.id, 0)
  const placements = (document.placements ?? []).filter((item) => item.job === job.id)
  if (placements.length > 1) return null
  const placement = placements[0]
  if (action.kind === 'image') {
    return { ...action, prompt: job.prompt ?? '', model: job.model ?? action.model, aspect: job.aspect ?? action.aspect,
      background: job.background ?? action.background, imageStyle: job.imageStyle ?? '',
      destination: placement ? 'timeline' : 'media-bin', start: seconds(placement?.start), duration: seconds(placement?.duration ?? job.duration, 5),
      transform: { ...DEFAULT_CLIP_TRANSFORM, ...placement?.transform } }
  }
  if (action.kind === 'scene') {
    return { ...action, operation: job.type === 'scene.edit' ? 'edit' : 'generate', prompt: job.prompt ?? '', assetId: job.assetId ?? '',
      model: job.model ?? '', aspect: job.aspect ?? '', destination: placement ? 'timeline' : 'media-bin', start: seconds(placement?.start), duration: seconds(job.duration, 8) }
  }
  if (action.kind === 'voice') {
    return { ...action, text: job.text ?? job.input ?? '', model: job.model ?? action.model, voice: job.voice ?? action.voice,
      voiceMode: job.referenceName ? 'clone' : 'preset', referenceName: job.referenceName ?? '', referenceTranscript: job.referenceTranscript ?? '',
      destination: placement ? 'timeline' : 'media-bin', start: seconds(placement?.start) }
  }
  if (action.kind === 'captions') return { ...action, language: job.language || 'auto', maxWords: job.maxWords ?? 4,
    preset: job.preset ?? '', assetId: job.assetId ?? '', style: job.style ?? {} }
  return null
}

export function inspectRecipeActions(source: string): RecipeActionInspection {
  try {
    const { document } = recipeSource(source)
    const actions: RecipeActionEntry[] = []
    let advancedCount = (document.commands?.length ?? 0) + (document.rules?.length ?? 0) + (document.jobs?.length ?? 0)
    for (const section of ['before', 'after'] as const) {
      for (const job of document[section] ?? []) {
        if (!job || typeof job.id !== 'string') throw new Error(`${section} actions need an ID. Fix it in Code DSL.`)
        const action = jobAction(job, document)
        if (!action || (section === 'before' ? action.kind === 'captions' : action.kind !== 'captions')) advancedCount++
        else actions.push({ ref: { section, id: job.id }, action })
      }
    }
    for (const text of document.texts ?? []) {
      if (!text || typeof text.id !== 'string') throw new Error('Text items need an ID. Fix it in Code DSL.')
      if (text.isCaption) continue
      const defaults = createRecipeAction('text', text.id, 0)
      if (defaults.kind !== 'text') continue
      actions.push({ ref: { section: 'texts', id: text.id }, action: { ...defaults, text: text.text,
        start: seconds(text.start), duration: seconds(text.duration), preset: text.preset ?? '',
        x: text.x ?? 960, y: text.y ?? 540, fontSize: text.fontSize ?? 40, color: text.color ?? '#ffffff' } })
    }
    return { actions, advancedCount, clipCount: (document.tracks ?? []).reduce((count, track) => count + (track.clips?.length ?? 0), 0), error: null }
  } catch (error) {
    return { actions: [], advancedCount: 0, clipCount: 0, error: error instanceof Error ? error.message : 'The recipe could not be read.' }
  }
}

export function nextRecipeActionID(source: string, kind: RecipeActionKind): string {
  const { document } = recipeSource(source)
  const ids = new Set([...(document.before ?? []), ...(document.after ?? []), ...(document.jobs ?? []), ...(document.texts ?? [])].map((item) => item.id))
  let index = 1
  while (ids.has(`${kind}-${index}`)) index++
  return `${kind}-${index}`
}

function writeRecipe(source: string, update: (document: EditDocument) => void): string {
  const { root, project, document, definition } = recipeSource(source)
  const previous = JSON.stringify(document)
  update(document)
  if (!root.has('document')) {
    const before = JSON.parse(previous) as Record<string, unknown>
    for (const key of new Set([...Object.keys(before), ...Object.keys(document)])) {
      const value = document[key as keyof EditDocument]
      if (JSON.stringify(before[key]) === JSON.stringify(value)) continue
      if (value === undefined) root.delete(key)
      else root.set(key, value)
    }
  } else if (project.recipe || typeof definition === 'string') {
    root.set('document', typeof definition === 'string' ? stringify(document, { lineWidth: 0 }) : document)
  } else {
    const before = JSON.parse(previous) as Record<string, unknown>
    for (const key of new Set([...Object.keys(before), ...Object.keys(document)])) {
      const value = document[key as keyof EditDocument]
      if (JSON.stringify(before[key]) === JSON.stringify(value)) continue
      if (value === undefined) root.deleteIn(['document', key])
      else root.setIn(['document', key], value)
    }
  }
  root.delete('recipe')
  root.delete('preparedText')
  return root.toString({ lineWidth: 0 })
}

function sectionFor(action: RecipeAction): Section {
  return action.kind === 'text' ? 'texts' : action.kind === 'captions' ? 'after' : 'before'
}

function actionJob(action: Exclude<RecipeAction, { kind: 'text' }>, original?: Job): Job {
  const job: Job = { ...original, id: action.id, type: action.kind === 'image' ? 'image.generate' : action.kind === 'scene' ? `scene.${action.operation}` : action.kind === 'voice' ? 'speech.generate' : 'captions.generate' }
  delete job.resultAssetId
  delete job.resultAudioAssetId
  delete job.audioStart
  delete job.resultTextIds
  if (action.kind === 'image') return { ...job, prompt: action.prompt.trim(), duration: action.duration, model: action.model, aspect: action.aspect, background: action.background, imageStyle: action.imageStyle }
  if (action.kind === 'scene') {
    delete job.assetId
    if (action.operation === 'edit') delete job.images
    return { ...job, prompt: action.prompt.trim(), duration: action.duration, model: action.model, aspect: action.aspect,
      ...(action.operation === 'edit' ? { assetId: action.assetId } : {}) }
  }
  if (action.kind === 'captions') {
    delete job.assetId
    delete job.preset
    return { ...job, language: action.language, maxWords: action.maxWords, style: action.style,
      ...(action.assetId ? { assetId: action.assetId } : {}), ...(action.preset ? { preset: action.preset } : {}) }
  }
  delete job.voice
  delete job.referenceName
  delete job.referenceTranscript
  return { ...job, text: action.text.trim(), model: action.model,
    ...(action.voiceMode === 'preset' ? { voice: action.voice } : { referenceName: action.referenceName, referenceTranscript: action.referenceTranscript }) }
}

export function saveRecipeAction(source: string, action: RecipeAction, ref: RecipeActionRef | null = null): string {
  const error = recipeActionError(action)
  if (error) throw new Error(error)
  return writeRecipe(source, (document) => {
    const section = sectionFor(action)
    if (ref && (ref.id !== action.id || ref.section !== section)) throw new Error('Reopen the action before changing its type.')
    const list = [...(document[section] ?? [])]
    const index = ref ? list.findIndex((item) => item.id === ref.id) : -1
    if (ref && index < 0) throw new Error('This action changed in Code DSL. Reopen it before saving.')
    if (!ref && list.some((item) => item.id === action.id)) throw new Error('An action with this ID already exists. Add a new action.')
    const original = index >= 0 ? list[index] : undefined
    const value = action.kind === 'text'
      ? { ...original, ...action.presetValues, id: action.id, text: action.text, start: action.start, duration: action.duration,
        ...(action.preset ? { preset: action.preset } : {}), x: action.x, y: action.y, fontSize: action.fontSize, color: action.color }
      : actionJob(action, original as Job | undefined)
    if (action.kind === 'text' && !action.preset) delete (value as Record<string, unknown>).preset
    if (index >= 0) list[index] = value as typeof list[number]
    else list.push(value as typeof list[number])
    Object.assign(document, { [section]: list })
    if (action.kind === 'image' || action.kind === 'scene' || action.kind === 'voice') {
      const placements = document.placements ?? []
      const existingIndex = placements.findIndex((item) => item.job === action.id)
      const placement = { ...placements[existingIndex], job: action.id,
        track: placements[existingIndex]?.track ?? { type: action.kind === 'voice' ? 'audio' as const : 'video' as const, role: action.kind === 'voice' ? 'narration' : action.kind === 'image' ? `overlay-${action.id}` : `scene-${action.id}` },
        start: action.start, ...(action.kind === 'image' ? { duration: action.duration, transform: action.transform } : {}) }
      if (action.destination === 'media-bin') document.placements = placements.filter((item) => item.job !== action.id)
      else if (existingIndex >= 0) document.placements = placements.map((item, index) => index === existingIndex ? placement : item)
      else document.placements = [...placements, placement]
    }
    delete document.revision
  })
}

export function removeRecipeAction(source: string, ref: RecipeActionRef): string {
  return writeRecipe(source, (document) => {
    const list = document[ref.section] ?? []
    if (!list.some((item) => item.id === ref.id)) throw new Error('This action changed in Code DSL. Reopen the recipe.')
    Object.assign(document, { [ref.section]: list.filter((item) => item.id !== ref.id) })
    if (ref.section === 'before') document.placements = (document.placements ?? []).filter((item) => item.job !== ref.id)
    delete document.revision
  })
}

export function withRecipeDefinition(project: CompositionInput): CompositionInput {
  const document = typeof project.document === 'string' ? parseDocument(project.document).toJS() as EditDocument : project.document
  if (document.before?.length || document.after?.length || document.rules?.length) return { ...project, recipe: structuredClone(document) }
  return project
}
