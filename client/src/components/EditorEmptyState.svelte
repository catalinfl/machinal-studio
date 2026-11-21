<script lang="ts">
  let { onAddMedia, onGenerateScenes }: { onAddMedia: () => void; onGenerateScenes?: () => void } = $props()
</script>

<div class="preview-onboarding">
  <svg class="empty-composition" viewBox="0 0 48 48" aria-hidden="true"><rect x="5" y="9" width="38" height="30" rx="1" /><path d="M5 17h38M13 9l5 8M25 9l5 8m-10 6 10 6-10 6z" /></svg>
  <h2>Make room for your next idea.</h2>
  <p>Bring in your media, or create a scene.<br />Arrange clips below. See your edit take shape here.</p>
  <div class="start-actions">
    <button type="button" class="start-media" onclick={onAddMedia}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>Open media library</button>
    {#if onGenerateScenes}<button type="button" class="start-scene" onclick={onGenerateScenes}>Create a scene<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12m-5-5 5 5-5 5" /></svg></button>{/if}
  </div>
</div>
