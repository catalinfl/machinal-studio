<script lang="ts">
  let { kind, width = 166 }: { kind: 'video' | 'image' | 'result'; width?: number } = $props()
  const id = $props.id()
  const mountains = '/images/home/direction-mountains-ai.png'
  const coast = '/images/home/direction-coast-ai.png'
</script>

<svg {width} height={width * 126 / 180} viewBox="0 0 180 126" overflow="visible" aria-hidden="true">
  <defs><clipPath id={id}><rect x="1" y="1" width="178" height="94" rx="5" /></clipPath></defs>
  <rect class="media-sheet" width="180" height="126" rx="6" />
  <g clip-path={`url(#${id})`}>
    <image class:finished-picture={kind === 'result'} href={kind === 'image' ? coast : mountains} x="1" y="1" width="178" height="94" preserveAspectRatio="xMidYMid slice" />
    {#if kind === 'result'}
      <image class="motion film-second-scene finished-picture" href={coast} x="1" y="1" width="178" height="94" preserveAspectRatio="xMidYMid slice" />
      <rect x="8" y="61" width="164" height="26" rx="2" fill="#33273f" />
      <text x="15" y="78" fill="#faf9f6" font-size="14" font-weight="500">Scenic route</text>
      <path d="M9 9h6m-6 0v6m156-6h6v6M9 80v6h6m156-6v6h-6" stroke="#faf9f6" stroke-width="1" />
    {:else if kind === 'video'}
      <circle cx="90" cy="47" r="14" fill="#faf9f6" />
      <path d="m87 41 9 6-9 6z" fill="#59446f" />
    {/if}
  </g>
  {#if kind === 'result'}
    <path d="m9 108 6 4-6 4z" fill="currentColor" />
    <text x="23" y="116" class="file-name">your-story.mp4</text>
    <rect x="139" y="103" width="32" height="15" rx="3" fill="#c6adff" />
    <text x="155" y="113.5" text-anchor="middle" font-size="8" font-weight="600" fill="#33273f">MP4</text>
    <path d="M1 95h178" stroke="#59446f" stroke-opacity=".25" />
    <path class="motion film-playhead" d="M1 95h178" stroke="#7047c7" stroke-width="2" />
  {:else}
    <g transform="translate(10 105)" fill="none" stroke="currentColor" stroke-width="1.2">
      {#if kind === 'video'}<path d="M0 0h10v10H0zM3 0v10m4-10v10M0 3h10M0 7h10" />
      {:else}<path d="M0 0h10v10H0zM1 8l3-3 3 3 2-2M3 3h.1" />{/if}
    </g>
    <text x="27" y="115" class="file-name">{kind === 'video' ? 'mountains.mp4' : 'coast.png'}</text>
  {/if}
</svg>
