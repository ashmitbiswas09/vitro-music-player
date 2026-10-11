/**
 * In-memory LRU Cache with maximum entry and byte size limits.
 * Performs sub-millisecond retrieval and evicts least recently used items.
 */

export interface LruCacheOptions {
  maxEntries?: number;
  maxSizeBytes?: number;
}

interface LruNode<T> {
  value: T;
  sizeBytes: number;
}

export class LruCache<T = unknown> {
  private readonly maxEntries: number;
  private readonly maxSizeBytes: number;
  private readonly map = new Map<string, LruNode<T>>();
  private currentSizeBytes = 0;
  private evictionCount = 0;

  constructor(options: LruCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 200;
    this.maxSizeBytes = options.maxSizeBytes ?? 20 * 1024 * 1024; // 20 MB default
  }

  get(key: string): T | undefined {
    const node = this.map.get(key);
    if (!node) return undefined;

    // Refresh access order (move to MRU position at end of Map)
    this.map.delete(key);
    this.map.set(key, node);
    return node.value;
  }

  peek(key: string): T | undefined {
    return this.map.get(key)?.value;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  set(key: string, value: T, sizeBytes?: number): void {
    const calculatedSize = sizeBytes ?? this.estimateSize(value);

    // If key already exists, replace and adjust size
    if (this.map.has(key)) {
      const existing = this.map.get(key)!;
      this.currentSizeBytes -= existing.sizeBytes;
      this.map.delete(key);
    }

    // Evict while exceeding entry or byte limits
    while (
      (this.map.size >= this.maxEntries ||
        this.currentSizeBytes + calculatedSize > this.maxSizeBytes) &&
      this.map.size > 0
    ) {
      this.evictLru();
    }

    this.map.set(key, { value, sizeBytes: calculatedSize });
    this.currentSizeBytes += calculatedSize;
  }

  delete(key: string): boolean {
    const node = this.map.get(key);
    if (!node) return false;

    this.currentSizeBytes -= node.sizeBytes;
    this.map.delete(key);
    return true;
  }

  clear(): void {
    this.map.clear();
    this.currentSizeBytes = 0;
  }

  size(): number {
    return this.map.size;
  }

  totalSizeBytes(): number {
    return this.currentSizeBytes;
  }

  evictions(): number {
    return this.evictionCount;
  }

  keys(): string[] {
    return Array.from(this.map.keys());
  }

  private evictLru(): string | undefined {
    const lruKey = this.map.keys().next().value;
    if (lruKey !== undefined) {
      const node = this.map.get(lruKey);
      if (node) {
        this.currentSizeBytes -= node.sizeBytes;
      }
      this.map.delete(lruKey);
      this.evictionCount++;
      return lruKey;
    }
    return undefined;
  }

  private estimateSize(value: unknown): number {
    if (typeof value === 'string') return value.length * 2;
    if (typeof value === 'number') return 8;
    if (typeof value === 'boolean') return 4;
    try {
      return JSON.stringify(value).length * 2;
    } catch {
      return 1024;
    }
  }
}
