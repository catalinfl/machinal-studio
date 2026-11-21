<script lang="ts">
  import { useWaveform } from '../composables/useWaveform.svelte'
  import { SERVER_UPLOAD_LIMIT_LABEL, formatClockDuration, formatMediaBytes, isVeryLargeWaveformSource } from '../lib/waveform'

  interface Props {
    src: string | null
    fileName: string
    sourceMode?: 'proxy' | 'wasm'
    sourceDuration: number
    inPoint: number
    outPoint: number
    volume?: number
    width: number
    visiblePixels?: { start: number; end: number }
    dragging?: boolean
    moveDragging?: boolean
    onBadgeVisibleChange?: (visible: boolean) => void
  }

  let { src, fileName, sourceMode, sourceDuration, inPoint, outPoint, width, visiblePixels, volume = 100, dragging = false, moveDragging = false, onBadgeVisibleChange }: Props = $props()

  const waveform = useWaveform({
    get src() { return src },
    get fileName() { return fileName },
    get sourceMode() { return sourceMode },
    get sourceDuration() { return sourceDuration },
    get inPoint() { return inPoint },
    get outPoint() { return outPoint },
    get width() { return width },
    get visiblePixels() { return visiblePixels },
    get volume() { return volume },
    get dragging() { return dragging },
    get moveDragging() { return moveDragging },
  })

  const showLargeBadge = $derived(
    waveform.status === 'unavailable'
    && (waveform.reason === 'too-long' || waveform.reason === 'too-large')
    && sourceMode !== 'proxy',
  )

  const veryLarge = $derived(isVeryLargeWaveformSource(sourceDuration, waveform.sizeBytes))

  const badgeTitle = $derived.by(() => {
    const duration = formatClockDuration(sourceDuration)
    const size = waveform.sizeBytes !== null ? ` · ${formatMediaBytes(waveform.sizeBytes)}` : ''
    if (veryLarge) {
      return `Waveform preview is off for this ${duration}${size} local file because decoding it would load the whole file into memory. Audio playback is unaffected. Server uploads are limited to ${SERVER_UPLOAD_LIMIT_LABEL}, so very large files stay local-only.`
    }
    return `Waveform preview is off for this ${duration}${size} local file. Audio playback is unaffected.`
  })

  // Tell the parent clip when the badge shows so it can hide its own
  // duration label — the two texts would otherwise overlap.
  $effect(() => {
    onBadgeVisibleChange?.(showLargeBadge)
    return () => onBadgeVisibleChange?.(false)
  })
</script>

<div class="waveform-wrap" bind:this={waveform.wrap} class:move-dragging={moveDragging}>
  {#each waveform.tiles as tile (tile.left)}
    <canvas use:waveform.attachCanvas={tile} class="waveform" style:left="{tile.left}px" style:width="{tile.width}px"></canvas>
  {/each}
  {#if showLargeBadge}
    <span
      class="waveform-large"
      class:very-large={veryLarge}
      role="img"
      aria-label={badgeTitle}
      title={badgeTitle}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h1.5M7.5 7v6M10.5 4.5v11M13.5 6.5v7M16.5 9v2"/></svg>
      <span class="waveform-large-text">Waveform off · local</span>
    </span>
  {/if}
</div>

<style>
  .waveform-wrap {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .move-dragging {
    display: none;
  }
  .waveform {
    --waveform-color: var(--audio-waveform);
    --waveform-muted: var(--audio-waveform-muted);
    --waveform-hot: var(--warning);
    opacity: var(--audio-waveform-opacity, 1);
    position: absolute;
    top: 0;
    height: 100%;
    pointer-events: none;
  }
  .waveform-large {
    position: absolute;
    left: 6px;
    bottom: 4px;
    z-index: 2;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: calc(100% - 12px);
    padding: 1px 6px 1px 4px;
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
    color: var(--muted-foreground);
    background: var(--surface-elevated);
    font-size: 9px;
    line-height: 1.5;
    white-space: nowrap;
    overflow: hidden;
    pointer-events: auto;
    cursor: help;
  }
  .waveform-large.very-large {
    border-color: var(--border-strong);
    color: var(--foreground);
  }
  .waveform-large svg {
    width: 11px;
    height: 11px;
    flex: 0 0 auto;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .waveform-large-text {
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--font-mono);
  }
</style>
