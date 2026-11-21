export class QueueFullError extends Error {
  constructor() { super('Scene queue is full; retry later'); }
}

export class WorkQueue {
  #active = 0;
  #pending = [];

  constructor(concurrency = 1, backlog = 8) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || !Number.isInteger(backlog) || backlog < 0) throw new Error('Invalid scene queue limits');
    this.concurrency = concurrency;
    this.backlog = backlog;
  }

  async acquire(signal) {
    signal?.throwIfAborted();
    if (this.#active < this.concurrency) {
      this.#active++;
      return this.#release();
    }
    if (this.#pending.length >= this.backlog) throw new QueueFullError();
    await new Promise((resolve, reject) => {
      const entry = { resolve, reject, cleanup: () => signal?.removeEventListener('abort', abort) };
      const abort = () => {
        const index = this.#pending.indexOf(entry);
        if (index >= 0) this.#pending.splice(index, 1);
        entry.cleanup();
        reject(signal.reason);
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.#pending.push(entry);
    });
    return this.#release();
  }

  #release() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.#pending.shift();
      if (next) { next.cleanup(); next.resolve(); }
      else this.#active--;
    };
  }
}
