<script module lang="ts">
  export interface UiSelectOption {
    value: string
    label: string
    disabled?: boolean
    previewStyle?: string
  }

  export interface UiSelectGroup {
    label: string
    options: UiSelectOption[]
  }
</script>

<script lang="ts">
  import { tick } from 'svelte'

  interface Props {
    id?: string
    label: string
    value: string
    options?: UiSelectOption[]
    groups?: UiSelectGroup[]
    placeholder?: string
    searchable?: boolean
    searchPlaceholder?: string
    disabled?: boolean
    onChange: (value: string) => void
  }

  let {
    id, label, value, options = [], groups = [], placeholder,
    searchable = false, searchPlaceholder = 'Search options...', disabled = false, onChange,
  }: Props = $props()

  let open = $state(false)
  let query = $state('')
  let wrap: HTMLDivElement | undefined = $state()
  let trigger: HTMLButtonElement | undefined = $state()
  let searchInput: HTMLInputElement | undefined = $state()

  const flat = $derived([...options, ...groups.flatMap((group) => group.options)])
  const selected = $derived(flat.find((option) => option.value === value && !option.disabled))
  const display = $derived(selected?.label ?? (value === '' ? (placeholder ?? '') : value))
  const listId = $derived(id ? `${id}-list` : undefined)
  const searchTerm = $derived(searchable ? normalizeSearch(query.trim()) : '')
  const filteredOptions = $derived(options.filter(matchesSearch))

  const filteredGroups = $derived(groups
    .map((group) => ({ ...group, options: group.options.filter(matchesSearch) }))
    .filter((group) => group.options.length > 0))

  const noResults = $derived(filteredOptions.length === 0 && filteredGroups.length === 0)

  function normalizeSearch(text: string): string {
    return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  }

  function matchesSearch(option: UiSelectOption): boolean {
    return normalizeSearch(`${option.label} ${option.value}`).includes(searchTerm)
  }

  async function openMenu(): Promise<void> {
    if (disabled) return
    query = ''
    open = true
    if (!searchable) return
    await tick()
    if (open) searchInput?.focus()
  }

  function toggle(): void {
    if (open) open = false
    else void openMenu()
  }

  function choose(optionValue: string): void {
    onChange(optionValue)
    open = false
    trigger?.focus()
  }

  function closeOutside(event: MouseEvent): void {
    if (open && wrap && !wrap.contains(event.target as Node)) open = false
  }

  function wrapFocusOut(event: FocusEvent): void {
    if (open && wrap && !wrap.contains(event.relatedTarget as Node)) open = false
  }

  function triggerKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
      if (!open) {
        event.preventDefault()
        void openMenu()
      }
    } else if (event.key === 'Escape') {
      open = false
    }
  }

  function menuKeydown(event: KeyboardEvent): void {
    if (event.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      open = false
      trigger?.focus()
      return
    }
    const buttons = [...(wrap?.querySelectorAll('.ui-select-option:not(:disabled)') ?? [])] as HTMLButtonElement[]
    if (event.key === 'Enter' && event.target === searchInput) {
      event.preventDefault()
      buttons[0]?.click()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    if (buttons.length === 0) return
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    event.preventDefault()
    if (searchable && index === 0 && event.key === 'ArrowUp') {
      searchInput?.focus()
      return
    }
    const next = event.key === 'ArrowDown'
      ? (index + 1) % buttons.length
      : (index < 0 ? buttons.length - 1 : (index - 1 + buttons.length) % buttons.length)
    buttons[next]?.focus()
  }
</script>

<svelte:window onclick={closeOutside} />

{#snippet optionItem(option: UiSelectOption)}
  <li role="option" aria-selected={option.value === value} aria-disabled={option.disabled ?? false}>
    <button
      type="button"
      class="ui-select-option"
      data-selected={option.value === value}
      disabled={option.disabled ?? false}
      style={option.previewStyle}
      onclick={() => choose(option.value)}
    >{option.label}</button>
  </li>
{/snippet}

<div class="ui-select" bind:this={wrap} onfocusout={wrapFocusOut}>
  <button
    type="button"
    {id}
    class="ui-select-trigger"
    role="combobox"
    aria-label={label}
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-controls={listId}
    data-value={value}
    {disabled}
    onclick={toggle}
    onkeydown={triggerKeydown}
    bind:this={trigger}
  >
    <span class="ui-select-value" class:is-placeholder={!selected}>{display}</span>
    <svg viewBox="0 0 16 16" aria-hidden="true" class:is-open={open}><path d="m4 6 4 4 4-4" /></svg>
  </button>
  {#if open}
    <div class="ui-select-menu">
      {#if searchable}
        <div class="ui-select-search">
          <input
            type="search"
            aria-label={searchPlaceholder}
            aria-controls={listId}
            placeholder={searchPlaceholder}
            autocomplete="off"
            bind:value={query}
            bind:this={searchInput}
            onkeydown={menuKeydown}
          />
        </div>
      {/if}
      <ul class="ui-select-options" role="listbox" id={listId} aria-label={label} onkeydown={menuKeydown}>
        {#if placeholder && !searchTerm}
          <li role="option" aria-selected="false" aria-disabled="true">
            <button type="button" class="ui-select-option" disabled>{placeholder}</button>
          </li>
        {/if}
        {#each filteredOptions as option (option.value)}
          {@render optionItem(option)}
        {/each}
        {#each filteredGroups as group (group.label)}
          <li class="ui-select-group" role="group" aria-label={group.label}>
            <span class="ui-select-group-label" aria-hidden="true">{group.label}</span>
            <ul>
              {#each group.options as option (option.value)}
                {@render optionItem(option)}
              {/each}
            </ul>
          </li>
        {/each}
      </ul>
      {#if searchable && noResults}
        <p class="ui-select-empty" role="status">No matches. Try another name.</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .ui-select { position: relative; min-width: 0; font-family: var(--font-sans); }
  .ui-select-trigger {
    display: flex; align-items: center; justify-content: space-between; gap: var(--space-6);
    width: 100%; min-height: var(--height-control);
    padding: 0 var(--space-6);
    border: 1px solid var(--border); border-radius: var(--radius-sm);
    background-color: var(--input); color: var(--foreground);
    font-family: inherit; font-size: var(--text-2xs); line-height: var(--leading-ui); text-align: left;
    cursor: pointer;
    transition: border-color 140ms ease, box-shadow 140ms ease, background-color 140ms ease;
  }
  .ui-select-trigger:hover:not(:disabled) { border-color: var(--border-strong); }
  .ui-select-trigger:focus-visible { outline: none; border-color: var(--ring); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ring) 22%, transparent); }
  .ui-select-trigger:disabled { opacity: 0.45; cursor: not-allowed; }
  .ui-select-value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ui-select-value.is-placeholder { color: var(--muted-foreground); }
  .ui-select-trigger svg {
    width: var(--icon-sm); height: var(--icon-sm); flex: 0 0 auto;
    fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round;
    transition: transform 140ms ease;
  }
  .ui-select-trigger svg.is-open { transform: rotate(180deg); }
  .ui-select-menu {
    position: absolute; z-index: var(--layer-popover); top: calc(100% + 4px); left: 0; right: 0;
    margin: 0; padding: var(--space-1); list-style: none;
    border: 1px solid var(--border-strong); border-radius: var(--radius-md);
    background: var(--surface-elevated); box-shadow: var(--shadow-popover);
  }
  .ui-select-options { margin: 0; padding: 0; list-style: none; max-height: 240px; overflow: auto; }
  .ui-select-search { padding: var(--space-3); border-bottom: 1px solid var(--border); }
  .ui-select-search input {
    box-sizing: border-box; width: 100%; min-height: var(--height-control); padding: 0 var(--space-4);
    border: 1px solid var(--border); border-radius: var(--radius-sm);
    background: var(--input); color: var(--foreground); caret-color: var(--primary);
    font-family: inherit; font-size: var(--text-2xs); line-height: var(--leading-ui);
  }
  .ui-select-search input::placeholder { color: var(--muted-foreground); }
  .ui-select-search input:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
  .ui-select-empty { margin: 0; padding: var(--space-4) var(--space-6); color: var(--muted-foreground); font-size: var(--text-2xs); }
  .ui-select-menu li { margin: 0; padding: 0; }
  .ui-select-option {
    display: block; width: 100%; text-align: left;
    padding: var(--space-4) var(--space-6);
    border: 0; border-radius: var(--radius-sm);
    background: transparent; color: var(--foreground);
    font-family: inherit; font-size: var(--text-2xs); line-height: var(--leading-ui);
    cursor: pointer;
  }
  .ui-select-option:hover:not(:disabled) { background: var(--primary-subtle); color: var(--foreground); }
  .ui-select-option[data-selected='true'] { background: var(--primary-subtle); color: var(--primary); font-weight: var(--weight-semibold); }
  .ui-select-option[data-selected='true']:hover:not(:disabled) { background: var(--primary-subtle); color: var(--primary); }
  .ui-select-option:focus-visible { outline: none; background: var(--primary); color: var(--primary-foreground); }
  .ui-select-option:disabled { opacity: 0.55; cursor: default; }
  .ui-select-group > ul { margin: 0; padding: 0; list-style: none; }
  .ui-select-group-label {
    display: block; padding: var(--space-4) var(--space-6) var(--space-1);
    color: var(--muted-foreground); font-size: var(--text-2xs);
    font-weight: var(--weight-semibold); letter-spacing: var(--tracking-label); text-transform: uppercase;
  }
</style>
