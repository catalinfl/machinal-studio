<script lang="ts">
  import type { SceneGeneration } from '../composables/useSceneGeneration.svelte'

  let { generation }: { generation: SceneGeneration } = $props()
</script>

{#if generation.editDraft}
  <form class="scene-edit" aria-label="Edit current scene" aria-busy={generation.busy} onsubmit={(event) => { event.preventDefault(); void generation.editSelected() }}>
    <label for="scene-edit-prompt">What should change?
      <textarea id="scene-edit-prompt" bind:value={generation.editDraft.prompt} required maxlength="4000" rows="3" disabled={generation.busy} placeholder="Keep the animation, make the background warmer and add a final zoom…"></textarea>
    </label>
    <div class="edit-controls">
      <label for="scene-edit-duration">Scene length (seconds)
        <input id="scene-edit-duration" type="number" min="1" max="60" step="any" required bind:value={generation.editDraft.duration} disabled={generation.busy} />
      </label>
      <div class="edit-actions">
        <button type="button" disabled={generation.busy} onclick={() => generation.closeEdit()}>Cancel edit</button>
        <button type="submit" class="primary" disabled={!generation.canEdit}>{generation.busy ? 'Editing scene…' : 'Update scene'}</button>
      </div>
    </div>
    <p>Edits this component, keeping its images and voice. Review the updated preview before adding it to your timeline.</p>
  </form>
{/if}

<style>
  .scene-edit { display:grid; gap:var(--space-5); margin-top:var(--space-6); padding-top:var(--space-6); border-top:1px solid var(--border); }
  label { display:grid; gap:var(--space-3); font-size:var(--text-xs); font-weight:var(--weight-semibold); }
  textarea, input { box-sizing:border-box; width:100%; min-width:0; padding:var(--space-4) var(--space-5); border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--input); color:var(--foreground); font:var(--text-sm)/var(--leading-copy) var(--font-sans); caret-color:var(--primary); }
  textarea { resize:vertical; }
  textarea::placeholder { color:var(--muted-foreground); }
  input { font-family:var(--font-mono); font-variant-numeric:tabular-nums; }
  .edit-controls { display:flex; align-items:end; flex-wrap:wrap; gap:var(--space-5); }
  .edit-controls label { flex:1 1 150px; }
  .edit-actions { display:flex; flex-wrap:wrap; gap:var(--space-3); }
  button { min-height:40px; padding:var(--space-4) var(--space-6); border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--secondary); color:var(--secondary-foreground); font:var(--weight-semibold) var(--text-xs)/1.4 var(--font-sans); cursor:pointer; }
  .primary { background:var(--primary); border-color:var(--primary); color:var(--primary-foreground); }
  button:hover:not(:disabled) { background:var(--surface-muted); }
  .primary:hover:not(:disabled) { background:var(--primary-hover); }
  button:focus-visible, input:focus-visible, textarea:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }
  button:disabled, textarea:disabled, input:disabled { opacity:.55; cursor:not-allowed; }
  p { margin:0; color:var(--muted-foreground); font-size:var(--text-xs); line-height:var(--leading-copy); }
</style>
