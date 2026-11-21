<script lang="ts">
  import type { NativePort } from '../../lib/native-gallery-catalog'

  let {
    ports,
    categories,
    selectedId,
    query,
    category,
    total,
    onSelect,
    onQueryChange,
    onCategoryChange,
  }: {
    ports: NativePort[]
    categories: string[]
    selectedId: string
    query: string
    category: string
    total: number
    onSelect: (id: string) => void
    onQueryChange: (value: string) => void
    onCategoryChange: (value: string) => void
  } = $props()
</script>

<aside class="ng-index" aria-label="Native Svelte ports">
  <div class="ng-index-heading">
    <h2>Native ports</h2>
    <span>{ports.length} <span class="ng-index-total">/ {total}</span></span>
  </div>

  <label class="ng-search">
    <span>Find a port</span>
    <input
      type="search"
      placeholder="Name, ID, or description"
      value={query}
      oninput={event => onQueryChange(event.currentTarget.value)}
    />
  </label>

  <div class="ng-category-filter" role="group" aria-label="Filter ports by category">
    {#each categories as item}
      <button
        type="button"
        class:active={category === item}
        aria-pressed={category === item}
        onclick={() => onCategoryChange(item)}
      >{item === 'all' ? 'All' : item}</button>
    {/each}
  </div>

  <nav class="ng-port-list" aria-label="Port results">
    {#if ports.length}
      {#each ports as port, index (port.id)}
        <button
          class="ng-port-row"
          class:selected={selectedId === port.id}
          aria-current={selectedId === port.id ? 'true' : undefined}
          onclick={() => onSelect(port.id)}
        >
          <span class="ng-port-number">{String(index + 1).padStart(3, '0')}</span>
          <span class="ng-port-copy">
            <strong>{port.label}</strong>
            <span>{port.id}</span>
          </span>
          <span class="ng-port-mode">{port.visualMode}</span>
        </button>
      {/each}
    {:else}
      <p class="ng-no-results">No ports match this search.</p>
    {/if}
  </nav>

  <p class="ng-index-footnote">Original HTML is reference material. Previews here mount the native Svelte ports.</p>
</aside>
