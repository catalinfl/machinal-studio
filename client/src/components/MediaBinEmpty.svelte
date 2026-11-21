<script lang="ts">
  import type { useMediaBin } from '../composables/useMediaBin.svelte'

  let { bin, needsLogin, showSkeletons }: {
    bin: ReturnType<typeof useMediaBin>
    needsLogin: boolean
    showSkeletons: boolean
  } = $props()
</script>

{#if needsLogin}
  <div class="library-empty login-required">
    <svg class="empty-art" viewBox="0 0 48 48" aria-hidden="true"><rect x="7" y="22" width="34" height="20" rx="3" /><path d="M15 22v-8a9 9 0 0 1 18 0v8M24 30v5" /></svg>
    <h3>Server media needs an account</h3>
    <p>Log in to browse and upload server files. Local files still work.</p>
    <a href="/login" class="empty-import">Log in</a>
    <button type="button" class="empty-secondary" onclick={bin.selectWasmMode}>Use local files</button>
  </div>
{:else if showSkeletons}
  <span class="sr-only" role="status">Loading media from the server…</span>
  {#each [0, 1, 2, 3, 4, 5] as index (index)}
    <div class="bin-skeleton" aria-hidden="true"><div class="bin-skeleton-thumb"></div><span class="skel-name"></span><span class="skel-sub"></span></div>
  {/each}
{:else if bin.items.length === 0}
  <div class="library-empty">
    <svg class="empty-art" viewBox="0 0 48 48" aria-hidden="true"><path d="M5 14a3 3 0 0 1 3-3h11l5 5h16a3 3 0 0 1 3 3v20a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3zM24 24v11M18.5 29.5h11" /></svg>
    <h3>Add your first files</h3>
    <p>Bring in video, audio or images.<br />Drop files here to start your edit.</p>
    <button type="button" class="empty-import" onclick={bin.openFilePicker} disabled={bin.mediaProcessing.active || !!bin.importProgress}>Choose files<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg></button>
    <span class="empty-note">{bin.scrubMode === 'proxy' ? 'Imports save to your server storage' : 'Imports stay in this browser session'}</span>
  </div>
{:else if bin.filteredItems.length === 0}
  <div class="library-empty filtered-empty">
    <svg class="empty-art" viewBox="0 0 48 48" aria-hidden="true"><circle cx="20" cy="20" r="12" /><path d="m29 29 12 12M16 20h8" /></svg>
    <h3>{bin.filter === 'renders' ? 'No renders yet.' : 'No matching media.'}</h3>
    <p>{bin.filter === 'renders' ? 'Server exports land here and stay available after logout. Render the project to create one.' : 'Try another name or show all media.'}</p>
    <button type="button" class="empty-secondary" onclick={bin.clearFilters}>{bin.filter === 'renders' ? 'Show all media' : 'Clear filters'}</button>
  </div>
{/if}
