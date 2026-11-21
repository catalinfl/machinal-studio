<script lang="ts">
  import { untrack } from 'svelte'
  import { LiveScenePlayer, type LiveSceneSource } from '../lib/live-scene'
  import { mediaSourceUrl } from '../lib/api'

  let { source }: { source: LiveSceneSource } = $props()
  let host = $state<HTMLDivElement>()
  let time = $state(0)
  let playing = $state(false)
  let phase = $state<'loading' | 'ready' | 'error'>('loading')
  let error = $state('')
  let audio = $state<HTMLAudioElement>()
  let player: LiveScenePlayer | undefined
  const duration = $derived(source.config.durationInFrames / source.config.fps)

  $effect(() => {
    if (!host) return
    phase = 'loading'
    error = ''
    time = 0
    playing = false
    const current = new LiveScenePlayer(source, host)
    player = current
    let cancelled = false

    const fail = (cause: Error) => {
      if (cancelled) return
      error = cause.message
      phase = 'error'
      playing = false
    }

    const scale = () => {
      const width = host!.clientWidth
      current.iframe.style.transform = `scale(${width / source.config.width})`
      current.setPreviewSize(width, width * source.config.height / source.config.width)
      void current.present(untrack(() => time), untrack(() => playing)).catch(fail)
    }

    const observer = new ResizeObserver(scale)
    observer.observe(host)
    scale()
    current.ready().then(() => { if (!cancelled) phase = 'ready' }).catch(fail)
    return () => { cancelled = true; player = undefined; observer.disconnect(); current.dispose() }
  })

  $effect(() => {
    if (!playing || phase !== 'ready') return
    let raf = 0
    const started = performance.now() - untrack(() => time) * 1000
    const tick = (now: number) => {
      time = Math.min(duration, (now - started) / 1000)
      void player?.present(time, time < duration).catch(cause => { error = cause.message; phase = 'error'; playing = false })
      if (time >= duration) { playing = false; audio?.pause() }
      else raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  })

  function seek(value: number): void {
    playing = false
    audio?.pause()
    time = value
    if (audio && source.audio) audio.currentTime = source.audio.start + value
    void player?.present(value).catch(cause => { error = cause.message; phase = 'error' })
  }

  function toggle(): void {
    if (time >= duration) seek(0)
    playing = !playing
    if (!playing) void player?.present(time).catch(cause => { error = cause.message; phase = 'error' })
    if (audio && source.audio) {
      audio.currentTime = source.audio.start + time
      if (playing) void audio.play().catch(() => {})
      else audio.pause()
    }
  }
</script>

<div class="live-preview" aria-label="Live scene preview" aria-busy={phase === 'loading'}>
  <div class="frame" class:transparent={source.config.transparent} bind:this={host} style:aspect-ratio="{source.config.width}/{source.config.height}"></div>
  {#if source.config.transparent}<p class="transparency-note">Transparent background · The checkerboard is not part of your video.</p>{/if}
  {#if source.audio}<audio bind:this={audio} src={mediaSourceUrl(source.audio.file)} preload="metadata"></audio>{/if}
  {#if phase === 'error'}<p role="alert">{error}</p>
  {:else}
    <div class="controls">
      <button type="button" onclick={toggle} disabled={phase !== 'ready'}>{playing ? 'Pause scene' : 'Play scene'}</button>
      <input type="range" aria-label="Scene preview time" min="0" max={duration} step={1 / source.config.fps} value={time} oninput={event => seek(Number(event.currentTarget.value))} disabled={phase !== 'ready'} />
      <span>{phase === 'loading' ? 'Loading preview…' : `${time.toFixed(2)} / ${duration.toFixed(2)} s`}</span>
    </div>
  {/if}
</div>

<style>
  .frame { position:relative; width:100%; overflow:hidden; background:var(--preview-surface,#17171c); }
  .frame.transparent { background-color:var(--surface-muted); background-image:conic-gradient(var(--border) 25%, transparent 0 50%, var(--border) 0 75%, transparent 0); background-size:16px 16px; }
  .frame :global(iframe) { position:absolute; inset:0; }
  .controls { display:flex; align-items:center; gap:var(--space-4); padding-block:var(--space-4); }
  button { min-height:36px; padding:var(--space-3) var(--space-5); border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--secondary); color:var(--foreground); cursor:pointer; font:inherit; font-size:var(--text-xs); }
  button:hover:not(:disabled) { background:var(--surface-muted); }
  button:disabled { opacity:.55; cursor:not-allowed; }
  button:focus-visible, input:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }
  input { min-width:0; flex:1; accent-color:var(--primary); }
  span { white-space:nowrap; font:var(--text-2xs)/1.4 var(--font-mono); color:var(--muted-foreground); font-variant-numeric:tabular-nums; }
  p { color:var(--destructive); font-size:var(--text-xs); }
  .transparency-note { margin:var(--space-4) 0 0; color:var(--muted-foreground); line-height:var(--leading-copy); }
  @media (max-width:760px) { .controls { flex-wrap:wrap; } }
</style>
