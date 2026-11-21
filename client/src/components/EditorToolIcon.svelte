<script lang="ts">
  import type { EditorPanel } from '../composables/useEditorPage.svelte'
  let { tool }: { tool: EditorPanel } = $props()
  const paths: Record<EditorPanel, string> = {
    media: 'M3 6h6l2 2h10v12H3zM3 6V4h7l2 2',
    text: 'M5 5h14M12 5v14M8 19h8',
    effects: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
    presets: 'M12 3a9 9 0 1 0 9 9c0-2-3-2-4-1s-3 0-2-2 0-6-3-6zM7 10h.01M9 6h.01M6 14h.01',
    transitions: 'M3 7h15m-4-4 4 4-4 4M21 17H6m4-4-4 4 4 4',
    speech: 'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0zM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8',
    image: 'M3 3h18v18H3zM3 17l6-6 4 4 3-3 5 5M16 7h.01',
    ai: 'M4 6h8M4 12h6M4 18h10m3-12 1.2 3.8L22 11l-3.8 1.2L17 16l-1.2-3.8L12 11l3.8-1.2z',
  }
</script>

<svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[tool]} /></svg>

<style>
  svg { width: 21px; height: 21px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0; }
</style>
