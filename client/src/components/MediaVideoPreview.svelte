<script lang="ts">
  let { src, width, height }: { src: string | null; width?: number; height?: number } = $props()
  let status = $state<'loading' | 'ready' | 'error'>('loading')
  const aspect = $derived(width && height && width > 0 && height > 0 ? width / height : 16 / 9)
</script>

<div class="video-frame" style:--video-aspect={aspect} aria-busy={status === 'loading'}>
  <!-- svelte-ignore a11y_media_has_caption -->
  <video {src} controls preload="auto" playsinline class:loading={status !== 'ready'}
    onloadeddata={() => { status = 'ready' }} onerror={() => { status = 'error' }}></video>
  {#if status === 'loading'}
    <div class="video-skeleton" role="status" aria-label="Loading video preview"></div>
  {:else if status === 'error'}
    <div class="video-error" role="alert">Video preview could not load.</div>
  {/if}
</div>

<style>
  .video-frame {
    position: relative;
    width: min(100%, calc(min(65dvh, 680px) * var(--video-aspect)));
    aspect-ratio: var(--video-aspect);
    flex-shrink: 0;
  }

  video, .video-skeleton, .video-error { position: absolute; inset: 0; width: 100%; height: 100%; }
  video { display: block; object-fit: contain; }
  video.loading { visibility: hidden; }

  .video-skeleton { overflow: hidden; background: var(--surface-muted); }

  .video-skeleton::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent, var(--surface-elevated), transparent);
    transform: translateX(-100%);
    animation: shimmer 1.4s ease-in-out infinite;
  }

  .video-error { display: grid; place-items: center; padding: var(--space-6); color: var(--foreground); background: var(--surface-muted); }
  @keyframes shimmer { to { transform: translateX(100%); } }
  @media (prefers-reduced-motion: reduce) { .video-skeleton::after { animation: none; } }
  @media (max-width: 600px) { .video-frame { width: min(100%, calc((100dvh - 148px) * var(--video-aspect))); } }
</style>
