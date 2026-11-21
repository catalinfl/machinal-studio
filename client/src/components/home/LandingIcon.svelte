<script lang="ts">
  type Icon = 'arrow' | 'direction' | 'play' | 'pause' | 'check' | 'layers' | 'image' | 'voice' | 'captions' | 'key' | 'file' | 'code' | 'close' | 'transition' | 'terminal' | 'network'
  let { name = 'arrow', size = 20 }: { name?: Icon; size?: number } = $props()

  const paths: Record<Icon, string> = {
    arrow: 'M4 12h16m-6-6 6 6-6 6',
    direction: 'M4 20 20 4M4 4h16v16',
    play: 'm9 5 11 7-11 7Z',
    pause: 'M8 5v14M16 5v14',
    check: 'm5 12 4 4L19 6',
    layers: 'm12 3 10 5-10 5L2 8Zm-9 10 9 5 9-5M3 18l9 5 9-5',
    image: 'M3 4h18v16H3Zm2 13 5-5 4 4 3-3 4 4M8 8h.01',
    voice: 'M4 9v6m4-9v12m4-15v18m4-15v12m4-9v6',
    captions: 'M3 5h18v14H3Zm7 5H7v4h3m7-4h-3v4h3',
    key: 'M14 8a5 5 0 1 0-2 4l8-8 2 2-3 3-2-2',
    file: 'M5 3h9l5 5v13H5Zm9 0v5h5M8 12h8m-8 4h5',
    code: 'm8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18',
    close: 'M6 6l12 12M6 18 18 6',
    transition: 'M3 5h18v14H3Zm0 14L21 5',
    terminal: 'M3 4h18v16H3Zm4 5 3 3-3 3m6 0h4',
    network: 'M9 3h6v6H9Zm-6 12h6v6H3Zm12 0h6v6h-6ZM12 9v3M6 15v-3h12v3',
  }
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d={paths[name]} />
</svg>
