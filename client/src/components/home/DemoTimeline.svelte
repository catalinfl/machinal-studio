<script lang="ts">
  import type { LandingEditor } from '../../composables/useLandingEditor.svelte'
  import { DEMO_OVERLAP, DEMO_SCENES, formatDemoTime, type DemoSceneId } from '../../lib/landing'
  import { getEffect } from '../../lib/effects'
  import LandingIcon from './LandingIcon.svelte'

  let { editor, ontext = () => {} }: { editor: LandingEditor; ontext?: () => void } = $props()
  const selectedIndex = $derived(editor.project.clips.findIndex(clip => clip.id === editor.project.selected))
  const transitionLabel = $derived(editor.project.transition ? getEffect(editor.project.transition)?.label : undefined)

  const timelineClips = $derived(editor.layout.map((clip, index, clips) => ({
    ...clip,
    laneStart: clip.start + (editor.project.transition && index > 0 ? DEMO_OVERLAP / 2 : 0),
    laneEnd: clip.end - (editor.project.transition && index < clips.length - 1 ? DEMO_OVERLAP / 2 : 0),
  })))

  function dragClip(event: DragEvent, id: DemoSceneId) {
    event.dataTransfer?.setData('application/x-direction-demo', `clip:${id}`)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  }
</script>

<div class="demo-timeline">
  <div class="timeline-heading"><span>Timeline <small>Drag scenes here. Select a clip to style it.</small></span><div class="reorder"><button aria-label="Move selected clip earlier" disabled={selectedIndex === 0} onclick={() => editor.moveClip(editor.project.selected, -1)}><LandingIcon name="arrow" size={14} /></button><button aria-label="Move selected clip later" disabled={selectedIndex === editor.project.clips.length - 1} onclick={() => editor.moveClip(editor.project.selected, 1)}><LandingIcon name="arrow" size={14} /></button></div></div>
  <div class="ruler measurement"><span>00:00</span><span>{formatDemoTime(editor.duration / 2)}</span><span>{formatDemoTime(editor.duration)}</span></div>
  <div class="track"><span class="track-label">V1</span><div class="clip-lane" role="group" aria-label="Interactive video track" ondragover={(event) => event.preventDefault()} ondrop={(event) => editor.drop(event)}>
    {#each timelineClips as clip (clip.id)}
      {@const scene = DEMO_SCENES.find(scene => scene.id === clip.id)!}
      <button class="timeline-clip" class:selected={editor.project.selected === clip.id} style:left="{clip.laneStart / editor.duration * 100}%" style:width="{(clip.laneEnd - clip.laneStart) / editor.duration * 100}%" aria-pressed={editor.project.selected === clip.id} aria-label="Select {scene.label} timeline clip" title={scene.label} draggable="true" ondragstart={(event) => dragClip(event, clip.id)} ondragover={(event) => event.preventDefault()} ondrop={(event) => editor.drop(event, clip.id)} onclick={() => editor.select(clip.id)}>
        <LandingIcon name="direction" size={16} /><span class="clip-label">{scene.label}<small>{clip.look || clip.effect || 'Image · 4 seconds'}</small></span>
      </button>
    {/each}
    <div class="playhead" style:left="{editor.project.time / editor.duration * 100}%"></div>
  </div></div>
  {#if transitionLabel}
    <div class="track"><span class="track-label" title="Transitions">FX</span><div class="transition-lane" role="group" aria-label="Timeline transitions">
      {#each editor.layout.slice(1) as clip, index (clip.id)}
        {@const outgoing = DEMO_SCENES.find(scene => scene.id === editor.layout[index].id)!}
        {@const incoming = DEMO_SCENES.find(scene => scene.id === clip.id)!}
        <button class="transition-marker" style:left="{(clip.start + DEMO_OVERLAP / 2) / editor.duration * 100}%" style:width="{DEMO_OVERLAP / editor.duration * 100}%" aria-label="Preview {transitionLabel} between {outgoing.label} and {incoming.label}" title="{transitionLabel} · {DEMO_OVERLAP}s · {outgoing.label} to {incoming.label}" onclick={() => editor.previewTransition(clip.id)}><LandingIcon name="transition" size={16} /></button>
      {/each}
    </div></div>
  {/if}
  <div class="track"><span class="track-label">T1</span><button class="text-lane" class:has-title={editor.project.title !== null} onclick={ontext}>{#if editor.project.title !== null}<LandingIcon name="captions" size={14} />{editor.project.title || 'Untitled text'}{:else}+ Add a title to your edit{/if}</button></div>
  {#if transitionLabel}<p class="transition-note"><span>{transitionLabel}</span><span class="measurement">{DEMO_OVERLAP}s overlap</span></p>{/if}
  <p class="timeline-message" role="status">{editor.message}</p>
</div>

<style>
  .demo-timeline { border-top: 1px solid var(--home-rule); padding: 12px 17px; }
  .timeline-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 11px; }
  .timeline-heading small { margin-left: 14px; font-size: 10px; color: var(--home-muted); }
  .reorder { display: flex; gap: 5px; }
  .reorder button { width: 25px; height: 25px; display: grid; place-items: center; padding: 0; color: var(--home-ink); border: 1px solid var(--home-rule); background: none; cursor: pointer; }
  .reorder button:first-child :global(svg) { transform: rotate(180deg); }
  .reorder button:disabled { opacity: .3; cursor: not-allowed; }
  .ruler { display: flex; justify-content: space-between; margin: 12px 0 6px 28px; color: var(--home-muted); font-size: 9px; }
  .track { display: flex; align-items: center; gap: 10px; margin-top: 5px; }
  .track-label { width: 18px; flex-shrink: 0; font-size: 9px; color: var(--home-muted); }
  .clip-lane { position: relative; height: 48px; flex: 1; min-width: 0; background: var(--home-tint); border: 1px solid var(--home-rule); }
  .timeline-clip { position: absolute; top: 0; height: 100%; display: flex; align-items: center; gap: 8px; padding: 8px 12px; overflow: hidden; text-align: left; color: var(--home-ink); background: var(--home-tint); border: 1px solid var(--home-rule); cursor: grab; font-size: 11px; }
  .timeline-clip.selected { color: #262a30; background: var(--home-lilac); border-color: #7047c7; z-index: 1; }
  .clip-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .timeline-clip small { display: block; overflow: hidden; text-overflow: ellipsis; font-size: 9px; margin-top: 2px; }
  .timeline-clip > :global(svg) { flex-shrink: 0; }
  .playhead { position: absolute; top: -8px; bottom: -3px; width: 1px; background: var(--home-accent); z-index: 2; pointer-events: none; }
  .transition-lane { position: relative; flex: 1; height: 28px; min-width: 0; border-inline: 1px solid transparent; }
  .transition-lane::before { content: ''; position: absolute; inset: 50% 0 auto; border-top: 1px solid var(--home-rule); }
  .transition-marker { position: absolute; top: 0; height: 28px; min-width: 32px; transform: translateX(-50%); display: grid; place-items: center; padding: 0; border: 1px solid var(--home-accent); background: var(--home-tint); color: var(--home-accent); cursor: pointer; }
  .transition-marker:hover { background: var(--home-lilac); color: #262a30; }
  .text-lane { flex: 1; min-height: 28px; display: flex; align-items: center; gap: 8px; padding: 6px 12px; border: 1px dashed var(--home-rule); background: none; color: var(--home-muted); text-align: left; cursor: pointer; font-size: 10px; }
  .text-lane.has-title { color: var(--home-ink); background: var(--home-tint); border-style: solid; }
  .timeline-message { margin: 10px 0 0 28px; font-size: 10px; color: var(--home-muted); }
  .transition-note { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; margin: 8px 0 0 28px; font-size: 10px; color: var(--home-accent); }
  .transition-note .measurement { font-size: 9px; color: var(--home-muted); }
  @media (max-width: 640px) { .demo-timeline { padding-inline: 10px; } .timeline-heading small { display: none; } .timeline-clip { font-size: 9px; padding: 6px; gap: 5px; } .timeline-clip small { font-size: 8px; } .timeline-clip > :global(svg) { display: none; } .timeline-message { line-height: 1.5; } }
</style>
