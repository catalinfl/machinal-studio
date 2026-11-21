<script lang="ts">
  import type { RecipeActionKind } from '../lib/recipe-action-fields'
  let { kind }: { kind: RecipeActionKind } = $props()
</script>

<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if kind === 'image'}
    <rect x="3" y="4" width="18" height="16" rx="1" /><path d="m5 17 5-5 4 4 3-3 4 4M8 8h.01" />
  {:else if kind === 'scene'}
    <rect x="3" y="4" width="18" height="16" rx="1" /><path d="m10 9 5 3-5 3zM3 7h18M7 4v3m5-3v3m5-3v3" />
  {:else if kind === 'voice'}
    <path d="M4 10v4m4-7v10m4-13v16m4-13v10m4-7v4" />
  {:else if kind === 'captions'}
    <rect x="3" y="5" width="18" height="14" rx="1" /><path d="M10 10H7v4h3m7-4h-3v4h3" />
  {:else}
    <path d="M5 5h14M12 5v14M8 19h8M5 5v3m14-3v3" />
  {/if}
</svg>
