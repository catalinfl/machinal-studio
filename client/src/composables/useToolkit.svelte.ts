import { filterToolkit, toolkitEntries, toolkitRecipe, type ToolkitKind } from '../lib/toolkit'

export function useToolkit() {
  let filters = $state({ kind: 'styles' as ToolkitKind, query: '', category: '' })
  let selectedId = $state('')
  const entries = $derived(filterToolkit(filters.kind, filters.query, filters.category))
  const categories = $derived([...new Set(toolkitEntries.filter(entry => entry.kind === filters.kind).map(entry => entry.category))])
  const selected = $derived(entries.find(entry => entry.id === selectedId) ?? entries[0])
  const recipe = $derived(selected ? toolkitRecipe(selected) : '')

  function setKind(kind: ToolkitKind) {
    filters = { kind, query: '', category: '' }
    selectedId = ''
  }

  function clearFilters() {
    filters.query = ''
    filters.category = ''
  }

  function select(id: string) {
    selectedId = id
  }

  return {
    setKind,
    clearFilters,
    select,
    get filters() { return filters },
    get entries() { return entries },
    get categories() { return categories },
    get selected() { return selected },
    get recipe() { return recipe },
  }
}
