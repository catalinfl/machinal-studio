const SVG_NS = 'http://www.w3.org/2000/svg';

export class PreviewEffects {
  #filter;
  #signature = '';

  apply(target, matrices = []) {
    const signature = JSON.stringify(matrices);
    if (signature === this.#signature) return;
    if (!matrices.length) {
      target.style.filter = '';
      this.#signature = signature;
      return;
    }
    if (matrices.some(matrix => !Array.isArray(matrix) || matrix.length !== 20 || !matrix.every(Number.isFinite))) {
      throw new Error('Invalid preview color matrix.');
    }
    if (!this.#filter) {
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none';
      this.#filter = document.createElementNS(SVG_NS, 'filter');
      this.#filter.id = 'live-preview-effects';
      this.#filter.setAttribute('color-interpolation-filters', 'sRGB');
      this.#filter.setAttribute('x', '0%');
      this.#filter.setAttribute('y', '0%');
      this.#filter.setAttribute('width', '100%');
      this.#filter.setAttribute('height', '100%');
      svg.append(this.#filter);
      document.body.append(svg);
    }
    this.#filter.replaceChildren(...matrices.map(matrix => {
      const primitive = document.createElementNS(SVG_NS, 'feColorMatrix');
      primitive.setAttribute('type', 'matrix');
      primitive.setAttribute('values', matrix.join(' '));
      return primitive;
    }));
    target.style.filter = `url(#${this.#filter.id})`;
    this.#signature = signature;
  }
}
