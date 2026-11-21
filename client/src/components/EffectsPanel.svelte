<script lang="ts">
  import { useEffectsPanel } from '../composables/useEffectsPanel.svelte'
  import EffectsPalette from './EffectsPalette.svelte'
  import BrowserPanel from './BrowserPanel.svelte'

  const panel = useEffectsPanel()
</script>

<BrowserPanel id="effects-panel" ariaLabel="Effects browser" title="Effects" subtitle="Add effects at the playhead">
  {#if panel.targetChannelId}
    <EffectsPalette targetChannelId={panel.targetChannelId} />
  {:else}
    <div class="empty">Add a video track first (+V).</div>
  {/if}
</BrowserPanel>

<style>
  .empty { padding: var(--space-24) var(--space-8); color: var(--muted-foreground); font-size: var(--text-xs); text-align: center; line-height: var(--leading-copy); }
</style>
