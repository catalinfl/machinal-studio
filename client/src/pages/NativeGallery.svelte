<script lang="ts">
  import '../styles/native-gallery.css'
  import NativePortIndex from '../components/native-gallery/NativePortIndex.svelte'
  import NativeScenePreview from '../components/native-gallery/NativeScenePreview.svelte'
  import NativePortDetails from '../components/native-gallery/NativePortDetails.svelte'
  import { NativeGallery } from '../composables/useNativeGallery.svelte'

  const gallery = new NativeGallery()

  function selectPort(id: string): void {
    gallery.select(id)
  }

  function setQuery(value: string): void {
    gallery.setQuery(value)
  }

  function setCategory(value: string): void {
    gallery.setCategory(value)
  }
</script>

<svelte:head>
  <title>Native motion gallery · machinal</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="native-gallery">
  <header class="ng-topbar">
    <a class="ng-brand" href="/" aria-label="machinal home">machinal <span>/ dev lab</span></a>
    <div class="ng-local-status"><span></span>Local development</div>
    <a class="ng-back-link" href="/editor">Back to editor</a>
  </header>

  <div class="ng-workspace">
    <NativePortIndex
      ports={gallery.filtered}
      categories={gallery.categories}
      selectedId={gallery.selectedId}
      query={gallery.query}
      category={gallery.category}
      total={gallery.total}
      onSelect={selectPort}
      onQueryChange={setQuery}
      onCategoryChange={setCategory}
    />

    <main class="ng-main">
      {#if gallery.selected}
        <header class="ng-selection-header">
          <div class="ng-selection-title">
            <h1>{gallery.selected.label}</h1>
            <p><code>{gallery.selected.id}</code><span>{gallery.selected.description}</span></p>
          </div>
          <div class="ng-selection-nav">
            <span>{String(Math.max(0, gallery.selectedIndex + 1)).padStart(3, '0')} <i>/</i> {gallery.filtered.length}</span>
            <button type="button" onclick={() => gallery.stepSelection(-1)} disabled={gallery.selectedIndex <= 0}>Previous</button>
            <button type="button" onclick={() => gallery.stepSelection(1)} disabled={gallery.selectedIndex < 0 || gallery.selectedIndex >= gallery.filtered.length - 1}>Next</button>
          </div>
        </header>

        <div class="ng-preview-toolbar">
          <span>Preview format</span>
          <div class="ng-aspect-switch" role="group" aria-label="Preview aspect ratio">
            <button type="button" class:active={gallery.aspect === 'landscape'} aria-pressed={gallery.aspect === 'landscape'} onclick={() => gallery.aspect = 'landscape'}>Landscape <small>16:9</small></button>
            <button type="button" class:active={gallery.aspect === 'portrait'} aria-pressed={gallery.aspect === 'portrait'} onclick={() => gallery.aspect = 'portrait'}>Portrait <small>9:16</small></button>
          </div>
          <span class="ng-no-render-note">Direct browser preview · no render or upload</span>
        </div>

        <NativeScenePreview port={gallery.selected} aspect={gallery.aspect} />
        <NativePortDetails port={gallery.selected} />
      {:else}
        <section class="ng-empty-state">
          <h1>No matching ports</h1>
          <p>Try a different search or clear the category filter.</p>
          <button type="button" onclick={() => { gallery.setQuery(''); gallery.setCategory('all') }}>Show all ports</button>
        </section>
      {/if}
    </main>
  </div>
</div>
