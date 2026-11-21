export function indexTimedItems<T extends { start: number; duration: number }>(items: readonly T[]) {
  const entries = items.map((item, order) => ({ item, order, start: item.start, end: item.start + item.duration }))
    .sort((left, right) => left.start - right.start || left.order - right.order)
  let end = -Infinity
  const prefixEnd = entries.map(entry => (end = Math.max(end, entry.end)))
  return { entries, prefixEnd }
}

export function activeTimedItems<T extends { start: number; duration: number }>(index: ReturnType<typeof indexTimedItems<T>>, time: number): T[] {
  let low = 0, high = index.entries.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (index.entries[middle].start <= time) low = middle + 1
    else high = middle
  }
  const active: typeof index.entries = []
  for (let at = low - 1; at >= 0 && index.prefixEnd[at] > time; at--) {
    const entry = index.entries[at]
    if (entry.end > time) active.push(entry)
  }
  return active.sort((left, right) => left.order - right.order).map(entry => entry.item)
}
