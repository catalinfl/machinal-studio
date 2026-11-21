<script lang="ts">
  import { useToolkit } from '../../composables/useToolkit.svelte'
  import { useClipboardFeedback } from '../../composables/useClipboardFeedback.svelte'
  import { toolkitKinds } from '../../lib/toolkit'
  import LandingIcon from '../home/LandingIcon.svelte'

  const toolkit = useToolkit()
  const clipboard = useClipboardFeedback()
</script>

<div class="library">
  <div class="library-tabs" role="group" aria-label="Toolkit categories">{#each toolkitKinds as item}<button class:active={toolkit.filters.kind === item.id} aria-pressed={toolkit.filters.kind === item.id} onclick={() => toolkit.setKind(item.id)}>{item.label}<span class="measurement">{item.count}</span></button>{/each}</div>
  <div class="library-filters"><label class="field search-field">Find your next move<input type="search" placeholder="Search names, styles or techniques…" aria-label="Search the toolkit" bind:value={toolkit.filters.query} /></label><label class="field">Category<select aria-label="Filter toolkit category" bind:value={toolkit.filters.category}><option value="">All categories</option>{#each toolkit.categories as category}<option>{category}</option>{/each}</select></label><span class="result-count" role="status">{toolkit.entries.length} presets</span></div>
  <div class="library-workspace">
    <div class="preset-register" role="group" aria-label="Preset library">
      {#if !toolkit.entries.length}<div class="empty-library"><h2>No matching presets.</h2><p>Try another name or clear the filters to see the whole category.</p><button class="quiet-button" onclick={toolkit.clearFilters}>Clear filters</button></div>{/if}
      {#each toolkit.entries as entry (entry.id)}<button class="preset-entry" class:selected={toolkit.selected?.id === entry.id} aria-pressed={toolkit.selected?.id === entry.id} onclick={() => toolkit.select(entry.id)}><span><strong>{entry.label}</strong><small>{entry.category}</small></span><LandingIcon name="direction" size={16} /></button>{/each}
    </div>
    <section class="preset-inspector" aria-label="Selected preset details">
      {#if toolkit.selected}<div class="inspector-title"><h2>{toolkit.selected.label}</h2><span>{toolkit.selected.category}</span></div><p class="description">{toolkit.selected.description}</p><code class="preset-id">{toolkit.selected.id}</code>
        {#if toolkit.selected.parameters?.length}<div class="parameter-list"><h3>Your controls</h3>{#each toolkit.selected.parameters as parameter}<div><span>{parameter.label}<small>{parameter.description}</small></span><span class="measurement">{parameter.min}–{parameter.max}{parameter.unit ? ` ${parameter.unit}` : ''}</span></div>{/each}</div>{:else}<p class="usage-note">{toolkit.filters.kind === 'transitions' ? 'Apply to existing clip junctions. Choose overlap and duration in the editor.' : toolkit.filters.kind === 'text' ? 'Edit the words, typography, placement and timing in the text inspector.' : 'Use this preset in the editor, or keep it in a reusable recipe.'}</p>{/if}
        <div class="snippet-heading"><span>Keep it in YAML</span><button class="quiet-button" onclick={() => clipboard.copy(toolkit.recipe, 'Preset YAML copied.')}>Copy YAML</button></div><pre><code>{toolkit.recipe}</code></pre><p class="status-note" role="status">{clipboard.status || 'Modify-mode examples apply to a captured timeline.'}</p><a class="text-link" href="/editor">Open the full editor <LandingIcon name="direction" size={16} /></a>
      {:else}<p class="description">Choose a preset to inspect its controls and recipe.</p>{/if}
    </section>
  </div>
</div>

<style>
  .library { border: 1px solid var(--home-rule); background: var(--home-surface); }
  .library-tabs { display: flex; border-bottom: 1px solid var(--home-rule); }
  .library-tabs button { display: flex; align-items: center; justify-content: center; gap: 15px; flex: 1; padding: 17px 14px; border: 0; border-right: 1px solid var(--home-rule); background: transparent; color: var(--home-muted); font-size: 13px; cursor: pointer; }
  .library-tabs button:last-child { border-right: 0; }
  .library-tabs button.active { background: var(--home-tint); color: var(--home-accent); }
  .library-tabs button span { font-size: 11px; }
  .library-filters { display: grid; grid-template-columns: 1fr 230px auto; gap: 20px; align-items: end; padding: 18px 20px; border-bottom: 1px solid var(--home-rule); }
  .result-count { color: var(--home-muted); font-size: 11px; padding-bottom: 12px; }
  .library-workspace { display: grid; grid-template-columns: .85fr 1.15fr; }
  .preset-register { max-height: 620px; overflow-y: auto; scrollbar-color: var(--home-rule) var(--home-surface); border-right: 1px solid var(--home-rule); }
  .preset-entry { display: flex; align-items: center; justify-content: space-between; gap: 25px; padding: 17px 22px; width: 100%; text-align: left; color: var(--home-ink); background: none; border: 0; border-bottom: 1px solid var(--home-rule); cursor: pointer; }
  .preset-entry strong { font-size: 15px; font-weight: 500; }
  .preset-entry small { display: block; margin-top: 5px; color: var(--home-muted); font-size: 10px; }
  .preset-entry > :global(svg) { color: var(--home-accent); flex-shrink: 0; }
  .preset-entry:hover, .preset-entry.selected { background: var(--home-tint); color: var(--home-accent); }
  .preset-inspector { min-width: 0; padding: 27px; }
  .inspector-title { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 15px; }
  .inspector-title h2 { font-size: 29px; letter-spacing: -.025em; line-height: 1.15; font-weight: 500; margin: 0; }
  .inspector-title > span { color: var(--home-muted); font-size: 11px; }
  .description { font-size: 13px; color: var(--home-muted); line-height: 1.75; max-width: 60ch; }
  .preset-id { color: var(--home-accent); font: 11px var(--font-mono); }
  .usage-note { font-size: 12px; color: var(--home-muted); line-height: 1.75; border-top: 1px solid var(--home-rule); padding-top: 17px; margin-top: 22px; }
  .parameter-list { margin-top: 22px; }
  .parameter-list h3 { font-size: 13px; font-weight: 500; margin-bottom: 10px; }
  .parameter-list > div { display: flex; justify-content: space-between; gap: 20px; padding: 11px 0; border-top: 1px solid var(--home-rule); font-size: 12px; }
  .parameter-list small { display: block; font-size: 10px; color: var(--home-muted); max-width: 46ch; line-height: 1.6; margin-top: 4px; }
  .parameter-list .measurement { font-size: 10px; color: var(--home-accent); flex-shrink: 0; }
  .snippet-heading { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin: 22px 0 12px; font-size: 12px; }
  pre { padding: 20px; background: var(--home-code); color: var(--home-code-ink); margin: 0; font-size: 11px; line-height: 1.75; white-space: pre-wrap; overflow-wrap: anywhere; }
  .preset-inspector .status-note { margin-top: 11px; font-size: 10px; }
  .preset-inspector .text-link { margin-top: 22px; font-size: 12px; }
  .empty-library { padding: 28px; }
  .empty-library h2 { font-size: 23px; font-weight: 500; margin-top: 0; }
  .empty-library p { color: var(--home-muted); font-size: 12px; line-height: 1.7; }
  @media (max-width: 850px) { .library-filters { grid-template-columns: 1fr 180px; } .result-count { grid-column: 1 / -1; padding-bottom: 0; } }
  @media (max-width: 640px) { .library-tabs { flex-wrap: wrap; } .library-tabs button { flex: 1 1 30%; padding: 13px 10px; border-bottom: 1px solid var(--home-rule); font-size: 12px; gap: 9px; } .library-filters { grid-template-columns: 1fr; gap: 13px; padding-inline: 15px; } .library-workspace { grid-template-columns: 1fr; } .preset-register { max-height: 265px; border-right: 0; border-bottom: 1px solid var(--home-rule); } .preset-entry { padding: 14px 17px; } .preset-inspector { padding: 22px 17px; } .inspector-title h2 { font-size: 26px; } }
</style>
