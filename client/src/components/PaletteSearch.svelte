<script lang="ts">
  import { tick } from 'svelte'

  interface Props {
    label: string
    count: number
    query?: string
  }

  let { label, count, query = $bindable('') }: Props = $props()
  let open = $state(false)
  let input = $state<HTMLInputElement>()

  async function openSearch(): Promise<void> {
    query = ''
    open = true
    await tick()
    input?.focus()
  }

  function closeSearch(): void {
    open = false
    query = ''
  }
</script>

{#if !open}
  <div class="search-bar">
    <span class="search-hint">{count} {label}</span>
    <button type="button" class="search-toggle" onclick={openSearch} aria-label="Search {label}" aria-expanded={open} title="Search {label}"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5"/><path d="m12.2 12.2 4 4"/></svg></button>
  </div>
{:else}
  <div class="search-row">
    <label class="search-field">
      <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5"/><path d="m12.2 12.2 4 4"/></svg>
      <span class="sr-only">Search {label}</span>
      <input bind:this={input} type="search" bind:value={query} placeholder="Search {label}…" aria-label="Search {label}" />
      <button type="button" class="search-close" onclick={closeSearch} aria-label="Close {label} search" title="Close search"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8m0-8-8 8" /></svg></button>
    </label>
  </div>
{/if}

<style>
  .search-bar { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); padding: var(--space-4) var(--space-8); }
  .search-hint { color: var(--muted-foreground); font-size: var(--text-2xs); font-weight: var(--weight-medium); }
  .search-toggle, .search-close {
    display: grid; place-items: center;
    width: var(--height-control); height: var(--height-control); flex: 0 0 var(--height-control);
    padding: 0; border: 1px solid transparent; border-radius: var(--radius-sm);
    color: var(--muted-foreground); background: transparent; cursor: pointer;
  }
  .search-toggle:hover { border-color: var(--primary-border); color: var(--primary); background: var(--primary-subtle); }
  .search-close:hover { border-color: transparent; color: var(--foreground); background: transparent; }
  .search-toggle:focus-visible, .search-close:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  .search-toggle svg, .search-close svg, .search-field > svg { width: var(--icon-sm); height: var(--icon-sm); fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; }
  .search-row { display: flex; min-width: 0; padding: var(--space-4) var(--space-8); }
  .search-field { position: relative; display: flex; align-items: center; flex: 1; min-width: 0; }
  .search-field > svg { position: absolute; left: var(--space-5); stroke: var(--muted-foreground); pointer-events: none; }
  .search-field input {
    width: 100%; height: var(--height-control);
    padding: 0 calc(var(--space-8) + var(--icon-sm)) 0 calc(var(--space-8) + var(--icon-sm));
    border: 1px solid var(--border); border-radius: var(--radius-sm); outline: 0;
    color: var(--foreground); background: var(--input); font: var(--text-xs)/1 var(--font-sans);
  }
  .search-field input::placeholder { color: var(--muted-foreground); }
  .search-field input:focus-visible { border-color: var(--ring); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ring) 22%, transparent); }
  .search-close { position: absolute; right: var(--space-2); border-color: transparent; background: transparent; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
</style>
