/**
 * In-flight request deduplicator (coalescing).
 * Merges concurrent requests for the identical cache key onto a single Promise.
 */

export class InFlightDeduper {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  async dedupe<T>(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    const promise = (async () => {
      try {
        return await factory();
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }

  isInFlight(key: string): boolean {
    return this.inFlight.has(key);
  }

  activeCount(): number {
    return this.inFlight.size;
  }

  clear(): void {
    this.inFlight.clear();
  }
}
