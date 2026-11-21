import type { PixiPlan } from './effects-pixi'

const SVG_NS = 'http://www.w3.org/2000/svg'

export function canPresentDirectEffects(plans: readonly PixiPlan[]): boolean {
  return plans.every(plan => plan.kind === 'colormatrix' && !plan.lut || plan.kind === 'skip')
}

export function directEffectMatrices(plans: readonly PixiPlan[]): number[][] {
  return plans.flatMap(plan => {
    if (plan.kind !== 'colormatrix') return []
    const matrix = [...plan.matrix]
    if (plan.alpha !== 1) matrix[18] = plan.alpha
    return [matrix]
  })
}

export class DirectPreviewEffects {
  #svg?: SVGSVGElement
  #entries = new Map<string, { signature: string; filter: SVGFilterElement }>()

  constructor(private parent: () => HTMLElement) {}

  filter(key: string, plans: readonly PixiPlan[]): string {
    if (!plans.some(plan => plan.kind === 'colormatrix')) return ''
    const signature = JSON.stringify(plans)
    let entry = this.#entries.get(key)
    if (!entry) {
      const filter = document.createElementNS(SVG_NS, 'filter')
      filter.id = `preview-effect-${crypto.randomUUID()}`
      filter.setAttribute('color-interpolation-filters', 'sRGB')
      filter.setAttribute('x', '0%')
      filter.setAttribute('y', '0%')
      filter.setAttribute('width', '100%')
      filter.setAttribute('height', '100%')
      if (!this.#svg) {
        this.#svg = document.createElementNS(SVG_NS, 'svg')
        this.#svg.setAttribute('aria-hidden', 'true')
        this.#svg.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;pointer-events:none'
        this.parent().appendChild(this.#svg)
      }
      this.#svg.appendChild(filter)
      entry = { signature: '', filter }
      this.#entries.set(key, entry)
    }
    if (entry.signature !== signature) {
      entry.filter.replaceChildren()
      for (const matrix of directEffectMatrices(plans)) {
        const primitive = document.createElementNS(SVG_NS, 'feColorMatrix')
        primitive.setAttribute('type', 'matrix')
        primitive.setAttribute('values', matrix.join(' '))
        entry.filter.appendChild(primitive)
      }
      entry.signature = signature
    }
    return `url("${window.location.href.split('#')[0]}#${entry.filter.id}")`
  }

  retain(keys: Set<string>): void {
    for (const [key, entry] of this.#entries) {
      if (keys.has(key)) continue
      entry.filter.remove()
      this.#entries.delete(key)
    }
  }

  dispose(): void {
    this.#entries.clear()
    this.#svg?.remove()
  }
}
