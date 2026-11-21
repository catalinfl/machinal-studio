<script lang="ts">
  import { nativePreviewSize, type NativeAspect, type NativePort } from '../../lib/native-gallery-catalog'
  import { useNativeScenePreview } from '../../composables/useNativeScenePreview.svelte'

  let { port, aspect }: { port: NativePort | null; aspect: NativeAspect } = $props()
  const preview = useNativeScenePreview(() => port, () => aspect)
  const size = $derived(nativePreviewSize(aspect))
</script>

<section class="ng-preview" aria-label="Native Svelte preview">
  <div class="ng-preview-meta">
    <span class="ng-preview-label">Live component</span>
    <span>{size.width} × {size.height} <i>·</i> {size.fps} fps</span>
  </div>

  <div class="ng-stage" class:ng-checkerboard={preview.checkerboard} bind:this={preview.stage}>
    <div class="ng-scene-host" bind:this={preview.host}></div>

    {#if preview.phase.kind === 'loading'}
      <div class="ng-stage-message" role="status"><span class="ng-loader"></span>Loading native scene…</div>
    {:else if preview.phase.kind === 'error'}
      <div class="ng-stage-error" role="alert">
        <strong>Preview could not start</strong>
        <p>{preview.phase.message}</p>
        <button type="button" onclick={preview.retry}>Try again</button>
      </div>
    {:else if !port}
      <div class="ng-stage-message">Choose a port to preview it.</div>
    {/if}

    {#if port && (port.requiredImages.length || port.requiredVideos.length)}
      <span class="ng-fixture-stamp">Synthetic fixture media</span>
    {/if}
  </div>

  <div class="ng-transport">
    <div class="ng-transport-actions">
      <button type="button" onclick={preview.togglePlayback} disabled={preview.phase.kind !== 'ready'}>
        {preview.transport.playing ? 'Pause' : 'Play'}
      </button>
      <button type="button" class="ng-secondary-button" onclick={preview.reset} disabled={preview.phase.kind === 'idle'}>Reset</button>
      <label class="ng-speed">
        <span>Speed</span>
        <select value={preview.transport.speed} onchange={event => preview.setSpeed(Number(event.currentTarget.value))}>
          <option value="0.5">0.5×</option>
          <option value="1">1×</option>
          <option value="2">2×</option>
        </select>
      </label>
      <button
        type="button"
        class="ng-secondary-button ng-checker-toggle"
        aria-pressed={preview.checkerboard}
        onclick={() => preview.checkerboard = !preview.checkerboard}
      >{preview.checkerboard ? 'Dark background' : 'Checkerboard'}</button>
    </div>

    <label class="ng-scrubber">
      <span class="ng-sr-only">Scene time</span>
      <input
        type="range"
        min="0"
        max={preview.duration}
        step={1 / size.fps}
        value={preview.transport.time}
        disabled={preview.phase.kind !== 'ready'}
        oninput={event => preview.seek(Number(event.currentTarget.value))}
      />
      <output>{preview.transport.time.toFixed(2)} <span>/</span> {preview.duration.toFixed(2)} s</output>
    </label>
  </div>
</section>
