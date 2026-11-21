import { onDestroy } from 'svelte'
import { DEMO_CLIP_DURATION, DEMO_OVERLAP, demoDuration, demoLayout, demoRecipe, type DemoProject, type DemoSceneId } from '../lib/landing'

type Playback = { kind: 'paused' } | { kind: 'playing'; until: number }
const TRANSITION_PREVIEW_MARGIN = 0.2

export function useLandingEditor() {
  let project = $state<DemoProject>({
    clips: [{ id: 'opening', look: null, effect: null }],
    selected: 'opening',
    time: 1,
    title: null,
    transition: null,
  })

  let playback = $state<Playback>({ kind: 'paused' })
  let message = $state('Try it: add a scene, then give it a style.')
  let frame = 0
  let lastTime = 0
  const layout = $derived(demoLayout(project))
  const duration = $derived(demoDuration(project))
  const selected = $derived(project.clips.find(clip => clip.id === project.selected)!)
  const recipe = $derived(demoRecipe(project))

  function pause() {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    playback = { kind: 'paused' }
  }

  function seek(time: number) {
    project.time = Math.max(0, Math.min(duration - 0.001, time))
  }

  function tick(now: number) {
    if (playback.kind !== 'playing') return
    const delta = Math.min(0.1, (now - lastTime) / 1000)
    lastTime = now
    if (project.time + delta >= playback.until) {
      seek(playback.until)
      pause()
      return
    }
    project.time += delta
    frame = requestAnimationFrame(tick)
  }

  function playUntil(until: number) {
    playback = { kind: 'playing', until }
    lastTime = performance.now()
    frame = requestAnimationFrame(tick)
  }

  function togglePlayback() {
    if (playback.kind === 'playing') return pause()
    if (project.time >= duration - 0.01) project.time = 0
    playUntil(duration)
  }

  function select(id: DemoSceneId) {
    pause()
    project.selected = id
    const clip = layout.find(clip => clip.id === id)
    if (clip) seek(clip.start + Math.min(1, DEMO_CLIP_DURATION / 2))
  }

  function addScene(id: DemoSceneId) {
    if (project.clips.some(clip => clip.id === id)) return select(id)
    project.clips.push({ id, look: null, effect: null })
    select(id)
    message = 'Scene added. Select a style or effect to change the preview.'
  }

  function applyPreset(kind: 'look' | 'effect', id: string | null) {
    selected[kind] = id
    select(project.selected)
    message = id ? `${kind === 'look' ? 'Style' : 'Effect'} applied to the selected clip. Your YAML updated, too.` : 'Selected clip reset.'
  }

  function applyTransition(id: string | null) {
    if (project.clips.length < 2) return
    pause()
    project.transition = id
    if (id) previewTransition(project.selected)
    else seek(DEMO_CLIP_DURATION)
    message = id ? 'Transition added. Click an FX marker to replay a cut, or play the full edit.' : 'Transitions removed.'
  }

  function previewTransition(incomingId: DemoSceneId) {
    if (!project.transition || layout.length < 2) return
    pause()
    const index = Math.max(1, layout.findIndex(clip => clip.id === incomingId))
    seek(layout[index].start - TRANSITION_PREVIEW_MARGIN)
    playUntil(layout[index].start + DEMO_OVERLAP + TRANSITION_PREVIEW_MARGIN)
  }

  function toggleTitle() {
    project.title = project.title === null ? 'Your story starts here.' : null
    message = project.title === null ? 'Title removed.' : 'Title added to the text track. You can edit the words.'
  }

  function moveClip(id: DemoSceneId, offset: number) {
    const index = project.clips.findIndex(clip => clip.id === id)
    const destination = Math.max(0, Math.min(project.clips.length - 1, index + offset))
    if (index === destination) return
    const clips = [...project.clips]
    const [clip] = clips.splice(index, 1)
    clips.splice(destination, 0, clip)
    project.clips = clips
    select(id)
    message = 'Clip order changed. The preview and YAML follow your timeline.'
  }

  function reset() {
    pause()
    project = { clips: [{ id: 'opening', look: null, effect: null }], selected: 'opening', time: 1, title: null, transition: null }
    message = 'Sandbox reset. Add a scene to start again.'
  }

  function drop(event: DragEvent, target?: DemoSceneId) {
    event.preventDefault()
    event.stopPropagation()
    const source = event.dataTransfer?.getData('application/x-direction-demo')
    if (!source) return
    const [kind, id] = source.split(':')
    if (kind === 'scene' && ['opening', 'next', 'finish'].includes(id)) addScene(id as DemoSceneId)
    if (kind === 'clip' && target) {
      const from = project.clips.findIndex(clip => clip.id === id)
      const to = project.clips.findIndex(clip => clip.id === target)
      if (from >= 0 && to >= 0) moveClip(id as DemoSceneId, to - from)
    }
  }

  onDestroy(pause)

  return {
    addScene,
    select,
    seek,
    applyPreset,
    applyTransition,
    previewTransition,
    toggleTitle,
    moveClip,
    togglePlayback,
    pause,
    reset,
    drop,
    get project() { return project },
    get selected() { return selected },
    get layout() { return layout },
    get duration() { return duration },
    get playback() { return playback.kind },
    get message() { return message },
    get recipe() { return recipe },
  }
}

export type LandingEditor = ReturnType<typeof useLandingEditor>
