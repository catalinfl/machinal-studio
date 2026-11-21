<script lang="ts">
  import CompositionMenu from './CompositionMenu.svelte'

  let { onGenerateScenes }: { onGenerateScenes: () => void } = $props()
</script>

<div class="editor-creation-actions" role="group" aria-label="Creation tools">
  <button type="button" class="scene-action" onclick={onGenerateScenes} aria-label="Generate scenes" aria-haspopup="dialog" title="Generate scenes">
    <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="4" width="15" height="12" rx="1" /><path d="M2.5 8h15M6 4v4m4-4v4m4-4v4m-6 2 4 2-4 2z" /></svg>
    <span>Scenes</span>
  </button>
  <CompositionMenu />
</div>
