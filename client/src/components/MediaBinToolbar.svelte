<script lang="ts">
  import { tick } from 'svelte'
  import type { useMediaBin } from '../composables/useMediaBin.svelte'
  import { auth } from '../stores/auth.svelte'
  import MediaBinPopover from './MediaBinPopover.svelte'

  let { bin, needsLogin, view = $bindable<'list' | 'grid'>('list') }: { bin: ReturnType<typeof useMediaBin>; needsLogin: boolean; view?: 'list' | 'grid' } = $props()

  let searchInput = $state<HTMLInputElement>()
  let searchButton: HTMLButtonElement | undefined
  let searchExpanded = $state(false)
  const searchVisible = $derived(searchExpanded || !!bin.search)
  const importBusy = $derived(bin.mediaProcessing.active || !!bin.importProgress)
  const sourceModes = $derived(auth.isLogged ? ['proxy', 'wasm'] as const : ['wasm', 'proxy'] as const)
  const filters = [
    { id: 'all', label: 'All files', title: 'All source files' },
    { id: 'video', label: 'Video', title: 'Video sources' },
    { id: 'audio', label: 'Audio', title: 'Audio sources' },
    { id: 'image', label: 'Images', title: 'Still images' },
    { id: 'ai', label: 'AI generated', title: 'AI-generated sources' },
    { id: 'renders', label: 'Renders', title: 'Final exports saved in your local Docker volume' },
  ]
  const currentFilter = $derived(filters.find(option => option.id === bin.filter) ?? filters[0])

  async function toggleSearch(): Promise<void> {
    if (searchVisible) return closeSearch()
    searchExpanded = true
    await tick()
    searchInput?.focus()
  }

  function clearSearch(): void {
    bin.search = ''
    searchInput?.focus()
  }

  function closeSearch(): void {
    bin.search = ''
    searchExpanded = false
    searchButton?.focus()
  }

  function handleSearchKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    if (bin.search) clearSearch()
    else closeSearch()
  }
</script>

<header class="library-head">
  <h2>Media bin</h2>
  <div class="library-head-actions">
    <button type="button" class="library-search-toggle" class:active={searchVisible} bind:this={searchButton}
      onclick={toggleSearch} aria-label="Open media search" aria-expanded={searchVisible} aria-controls="media-bin-search" title="Search files">
      <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5" /><path d="m12.2 12.2 4 4" /></svg>
    </button>
    <button type="button" class="library-import" onclick={bin.openFilePicker} disabled={importBusy || needsLogin} aria-label="Upload media" title={needsLogin ? 'Log in to upload to the server' : `Import video, audio or image files ${bin.scrubMode === 'proxy' ? 'to the server' : 'in this browser'}`}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>Import
    </button>
  </div>
  <input bind:this={bin.fileInput} type="file" accept="video/*,audio/*,image/*" multiple onchange={bin.handleUpload} disabled={importBusy || needsLogin} hidden />
</header>

{#if searchVisible}
  <div class="library-controls">
    <div id="media-bin-search" class="library-search">
      <input bind:this={searchInput} type="search" bind:value={bin.search} placeholder="Search files…" aria-label="Search media" onkeydown={handleSearchKeydown} />
      <button type="button" class="search-clear" onclick={closeSearch} aria-label="Close media search" title="Close search"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" /></svg></button>
    </div>
  </div>
{/if}

<div class="library-register" class:selecting={bin.selecting}>
  <div class="library-browse-summary">
    <MediaBinPopover label="Filter media" title="Filter media files" active={bin.filter !== 'all'}>
      {#snippet trigger()}
        <span>{currentFilter.label}</span><svg class="disclosure-chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="m2 4 4 4 4-4" /></svg>
      {/snippet}
      {#snippet children(close)}
        {#each filters as option (option.id)}
          <button type="button" class="library-filter-option" class:active={bin.filter === option.id} class:render-filter={option.id === 'renders'}
            aria-pressed={bin.filter === option.id} aria-controls="media-bin-list" data-filter={option.id} title={option.title}
            onclick={event => { bin.selectFilter(event); close() }}>{option.label}<span>{bin.filterCount(option.id)}</span></button>
        {/each}
      {/snippet}
    </MediaBinPopover>
    <span class="library-count" aria-live="polite">{#if bin.selecting}{bin.selectedCount} selected{:else}{bin.filteredItems.length} {bin.filteredItems.length === 1 ? 'file' : 'files'}{/if}</span>
  </div>
  <MediaBinPopover label="Media bin options" iconOnly align="end">
    {#snippet trigger()}<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="4" cy="10" r="1" /><circle cx="10" cy="10" r="1" /><circle cx="16" cy="10" r="1" /></svg>{/snippet}
    {#snippet children(close)}
      <div class="library-option-group">
        <span class="library-option-label">Import to</span>
        <div class="library-source" role="group" aria-label="Preview mode">
          {#each sourceModes as mode (mode)}
            <button type="button" class:active={bin.scrubMode === mode} onclick={() => { if (mode === 'proxy') bin.selectProxyMode(); else bin.selectWasmMode(); close() }} disabled={importBusy} aria-label={mode === 'proxy' ? 'Use server scrub' : 'Use local scrub'} aria-pressed={bin.scrubMode === mode} title={mode === 'proxy' ? 'Import and preview with server storage' : 'Import and preview in this browser'}>
              <svg viewBox="0 0 20 20" aria-hidden="true">{#if mode === 'proxy'}<rect x="3" y="3.5" width="14" height="5" rx="1" /><rect x="3" y="11.5" width="14" height="5" rx="1" /><path d="M6 6h.01M6 14h.01" />{:else}<rect x="2.5" y="3.5" width="15" height="10" rx="1" /><path d="M10 13.5v3M6.5 16.5h7" />{/if}</svg>
              {mode === 'proxy' ? 'Server' : 'Local'}
            </button>
          {/each}
        </div>
      </div>
      <div class="library-option-group">
        <span class="library-option-label">Display</span>
        <div class="media-view-switch" role="group" aria-label="Media display">
          <button type="button" aria-label="List view" aria-pressed={view === 'list'} onclick={() => { view = 'list'; close() }}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h2m3 0h9M3 10h2m3 0h9M3 15h2m3 0h9" /></svg>List</button>
          <button type="button" aria-label="Grid view" aria-pressed={view === 'grid'} onclick={() => { view = 'grid'; close() }}><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3" width="5" height="5" /><rect x="12" y="3" width="5" height="5" /><rect x="3" y="12" width="5" height="5" /><rect x="12" y="12" width="5" height="5" /></svg>Grid</button>
        </div>
      </div>
      <div class="library-option-actions">
        {#if !bin.selecting}
          <button type="button" onclick={() => { bin.enterSelection(); close() }} disabled={bin.selectionBusy} aria-label="Select media to delete" aria-pressed="false" aria-controls="media-bin-list">
            <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3.5" y="3.5" width="13" height="13" rx="2" /><path d="m6.5 10 2.5 2.5 4.5-5" /></svg>Select files
          </button>
        {/if}
        <button type="button" onclick={() => { bin.refresh(); close() }} disabled={importBusy || needsLogin} aria-label="Reload scrub list"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.5 7A6 6 0 1 0 16 11M15.5 7V3.5M15.5 7H12" /></svg>Refresh library</button>
      </div>
    {/snippet}
  </MediaBinPopover>
</div>
{#if bin.selecting}
  <div class="library-selection-actions">
    <button type="button" class="danger" onclick={bin.requestDelete} disabled={bin.selectedCount === 0 || bin.deleting}>Delete {#if bin.selectedCount > 0}({bin.selectedCount}){/if}</button>
    <button type="button" onclick={bin.exitSelection} disabled={bin.deleting} aria-label="Close media selection">Close</button>
  </div>
{/if}
