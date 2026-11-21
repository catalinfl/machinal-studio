export function filterPaletteItems<T>(
  items: readonly T[],
  query: string,
  searchFields: (item: T) => string[],
): readonly T[] {
  const term = query.trim().toLowerCase()
  if (!term) return items
  return items.filter((item) => searchFields(item).some((field) => field.toLowerCase().includes(term)))
}

export function filterPaletteGroups<T>(
  groups: readonly { category: string; items: readonly T[] }[],
  query: string,
  searchFields: (item: T) => string[],
): readonly { category: string; items: readonly T[] }[] {
  if (!query.trim()) return groups
  return groups
    .map((group) => ({ ...group, items: filterPaletteItems(group.items, query, searchFields) }))
    .filter((group) => group.items.length > 0)
}
