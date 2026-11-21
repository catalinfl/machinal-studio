import { filterNativePorts, nativeCategories, nativePorts, type NativeAspect } from '../lib/native-gallery-catalog'

export class NativeGallery {
  query = $state('')
  category = $state('all')
  selectedId = $state(nativePorts[0]?.id ?? '')
  aspect = $state<NativeAspect>('landscape')
  categories = nativeCategories
  total = nativePorts.length

  filtered = $derived.by(() => filterNativePorts(nativePorts, this.query, this.category))
  selected = $derived(nativePorts.find(port => port.id === this.selectedId) ?? null)
  selectedIndex = $derived(this.filtered.findIndex(port => port.id === this.selectedId))

  setQuery(query: string): void {
    this.query = query
    this.selectVisibleFirst()
  }

  setCategory(category: string): void {
    this.category = category
    this.selectVisibleFirst()
  }

  select(id: string): void {
    if (this.filtered.some(port => port.id === id)) this.selectedId = id
  }

  stepSelection(direction: -1 | 1): void {
    const next = this.filtered[this.selectedIndex + direction]
    if (next) this.selectedId = next.id
  }

  private selectVisibleFirst(): void {
    if (this.filtered.some(port => port.id === this.selectedId)) return
    this.selectedId = this.filtered[0]?.id ?? ''
  }
}
