<script lang="ts">
  import type { LandingEditor } from '../../composables/useLandingEditor.svelte'
  import { useLandingRenderer } from '../../composables/useLandingRenderer.svelte'
  import { DEMO_SCENES, formatDemoTime } from '../../lib/landing'
  import LandingIcon from './LandingIcon.svelte'

  let { editor }: { editor: LandingEditor } = $props()
  const renderer = useLandingRenderer(() => editor.project)
  const scene = $derived(DEMO_SCENES.find(scene => scene.id === editor.selected.id)!)
</script>

<div class="demo-preview">
  <div class="preview-heading"><span>Live preview</span><span class="measurement">16:9 / 24 fps</span></div>
  <div class="preview-stage" role="img" aria-label="Interactive composition preview">
    {#if renderer.phase.kind !== 'ready'}<div class="fallback-art" style:background={scene.ground} style:color={scene.ink}><span>{scene.words[0]}<br />{scene.words[1]}</span><LandingIcon name="direction" size={60} /></div>{/if}
    <div class="canvas-host" bind:this={renderer.host}></div>
    {#if editor.project.title !== null}<div class="user-title">{editor.project.title}</div>{/if}
  </div>
  <div class="transport">
    <button class="icon-control" aria-label={editor.playback === 'playing' ? 'Pause sandbox' : 'Play sandbox'} onclick={editor.togglePlayback}><LandingIcon name={editor.playback === 'playing' ? 'pause' : 'play'} size={18} /></button>
    <span class="measurement">{formatDemoTime(editor.project.time)} / {formatDemoTime(editor.duration)}</span>
    <input type="range" min="0" max={editor.duration} step="0.02" value={editor.project.time} oninput={(event) => editor.seek(Number(event.currentTarget.value))} aria-label="Scrub interactive timeline" />
    <button class="reset-demo" onclick={editor.reset}>Reset</button>
  </div>
  {#if renderer.phase.kind === 'error'}<p class="engine-note" role="status">{renderer.phase.message}</p>{/if}
</div>

<style>
  .preview-heading { display: flex; justify-content: space-between; align-items: center; min-height: 49px; padding: 12px 18px; color: var(--home-ink); font-size: 12px; border-bottom: 1px solid var(--home-rule); }
  .preview-heading .measurement { color: var(--home-muted); font-size: 9px; }
  .preview-stage { position: relative; aspect-ratio: 16/9; max-height: 260px; margin-inline: auto; overflow: hidden; background: #222833; }
  .fallback-art { position: absolute; inset: 0; display: flex; align-items: center; justify-content: space-between; padding: 35px; gap: 20px; }
  .fallback-art > span { font-size: clamp(30px, 4vw, 62px); line-height: 1.05; font-weight: 500; letter-spacing: -.04em; }
  .canvas-host { position: absolute; inset: 0; }
  .canvas-host :global(canvas) { display: block; width: 100%; height: 100%; object-fit: contain; }
  .user-title { position: absolute; left: 50%; bottom: 8%; transform: translateX(-50%); max-width: 85%; padding: 8px 14px; background: #faf9f6; color: #262a30; font-size: clamp(12px, 1.25vw, 18px); font-weight: 600; text-align: center; overflow-wrap: anywhere; }
  .transport { display: flex; align-items: center; gap: 12px; padding: 9px 13px; }
  .transport .measurement { color: var(--home-muted); font-size: 10px; flex-shrink: 0; }
  input { flex: 1; min-width: 0; }
  .reset-demo { border: 0; background: none; color: var(--home-muted); text-decoration: underline; font-size: 10px; cursor: pointer; padding: 6px; }
  .engine-note { padding: 0 16px; font-size: 11px; color: var(--home-muted); }
  @media (max-width: 640px) { .preview-heading { padding-inline: 12px; } .preview-heading .measurement { font-size: 8px; } .transport { gap: 8px; padding-inline: 8px; } .transport .measurement { font-size: 9px; } .fallback-art { padding: 20px; } .fallback-art > span { font-size: 30px; } }
</style>
