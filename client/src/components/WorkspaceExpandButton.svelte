<script lang="ts">
  let { target, expanded = false, onToggle }: {
    target: 'preview' | 'timeline'
    expanded?: boolean
    onToggle: () => void
  } = $props()
</script>

<button class="workspace-expand" type="button" onclick={onToggle} aria-label={expanded ? `Restore ${target} layout` : `Expand ${target}`} aria-pressed={expanded} title={expanded ? 'Restore layout (Esc)' : `Expand ${target}`}>
  <svg viewBox="0 0 20 20" aria-hidden="true"><path d={expanded ? 'M7 3v4H3M13 3v4h4M7 17v-4H3M13 17v-4h4' : 'M7 3H3v4M13 3h4v4M3 13v4h4M17 13v4h-4'} /></svg>
  <span>{expanded ? 'Restore' : 'Expand'}</span>
</button>
