<script lang="ts">
  import { useInspectorFactory } from '../composables/useInspectorFactory.svelte'

  let { showClipInspector = true, showEffectInspector = true, showTextInspector = true }: {
    showClipInspector?: boolean
    showEffectInspector?: boolean
    showTextInspector?: boolean
  } = $props()

  const factory = useInspectorFactory(() => showClipInspector, () => showEffectInspector, () => showTextInspector)
</script>

{#if factory.activeInspector}
  {@const InspectorComponent = factory.activeInspector}
  <div class="inspector-overlay">
    <InspectorComponent />
  </div>
{/if}

<style>
  .inspector-overlay {
    position: absolute; inset: 0 0 0 auto; z-index: var(--layer-overlay);
    display: flex;
    width: var(--panel-sm); max-width: 92vw;
    box-shadow: var(--shadow-overlay);
  }

  @media (max-width: 1024px) {
    .inspector-overlay { width: 100%; max-width: none; }
  }
</style>
