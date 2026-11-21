export class BundleCache {
  #entries = new Map();
  #pending = new Map();
  #bytes = 0;

  constructor(maxBytes = 32 * 1024 * 1024) { this.maxBytes = maxBytes; }

  async get(key, generate) {
    const existing = this.#entries.get(key);
    if (existing) {
      this.#entries.delete(key);
      this.#entries.set(key, existing);
      return existing;
    }
    if (this.#pending.has(key)) return this.#pending.get(key);
    const pending = this.#generate(key, generate);
    this.#pending.set(key, pending);
    try { return await pending; }
    finally { this.#pending.delete(key); }
  }

  async #generate(key, generate) {
    const value = await generate();
    if (value.byteLength > this.maxBytes) return value;
    while (this.#bytes + value.byteLength > this.maxBytes && this.#entries.size) {
      const oldest = this.#entries.keys().next().value;
      this.#bytes -= this.#entries.get(oldest).byteLength;
      this.#entries.delete(oldest);
    }
    this.#entries.set(key, value);
    this.#bytes += value.byteLength;
    return value;
  }
}
