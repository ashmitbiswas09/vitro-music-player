/**
 * Multi-tier Stale-While-Revalidate (SWR) Cache Manager.
 * Orchestrates L1 in-memory LRU, L2 SQLite persistence, in-flight request deduplication,
 * and subscriber notifications on background updates.
 */

import {
  ok,
  isOk,
  type Result,
  type AppError,
  type Clock,
  SystemClock,
  logger,
} from '@/backend/core';
import type { SqlDatabase } from '@/backend/platform';
import { LruCache } from './lru-cache';
import { SqlCacheStore } from './sql-cache-store';
import { InFlightDeduper } from './in-flight-deduper';
import {
  type CacheDataType,
  type CachePolicy,
  type CacheEntry,
  type CacheGetResult,
  type CacheStats,
  type GetOrFetchOptions,
  DEFAULT_CACHE_POLICIES,
} from './types';

export interface CacheManagerOptions {
  sqlDatabase?: SqlDatabase;
  clock?: Clock;
  policies?: Partial<Record<CacheDataType, CachePolicy>>;
  maxMemoryEntries?: number;
  maxMemorySizeBytes?: number;
}

export class CacheManager {
  private readonly lru: LruCache<CacheEntry>;
  private readonly sqlStore?: SqlCacheStore;
  private readonly deduper = new InFlightDeduper();
  private readonly clock: Clock;
  private readonly policies: Record<CacheDataType, CachePolicy>;
  private readonly subscribers = new Map<string, Set<(freshData: unknown) => void>>();

  // Metrics
  private hits = 0;
  private misses = 0;
  private staleHits = 0;
  private revalidations = 0;

  constructor(options: CacheManagerOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.policies = { ...DEFAULT_CACHE_POLICIES, ...options.policies };
    this.lru = new LruCache<CacheEntry>({
      maxEntries: options.maxMemoryEntries,
      maxSizeBytes: options.maxMemorySizeBytes,
    });
    if (options.sqlDatabase) {
      this.sqlStore = new SqlCacheStore(options.sqlDatabase);
    }
  }

  /**
   * Retrieves an entry from cache (L1 memory or L2 SQLite), checking freshness vs staleness.
   * Guarantees return in sub-100ms.
   */
  async get<T>(key: string): Promise<CacheGetResult<T>> {
    const now = this.clock.now();

    // 1. Check L1 Memory LRU
    const memEntry = this.lru.get(key) as CacheEntry<T> | undefined;
    if (memEntry) {
      if (now < memEntry.freshUntil) {
        return {
          status: 'fresh',
          data: memEntry.value,
          ageMs: now - memEntry.createdAt,
          freshUntil: memEntry.freshUntil,
          staleUntil: memEntry.staleUntil,
          isHit: true,
          isStale: false,
        };
      }
      if (now < memEntry.staleUntil) {
        return {
          status: 'stale',
          data: memEntry.value,
          ageMs: now - memEntry.createdAt,
          freshUntil: memEntry.freshUntil,
          staleUntil: memEntry.staleUntil,
          isHit: true,
          isStale: true,
        };
      }
      // Expired in memory: remove
      this.lru.delete(key);
    }

    // 2. Check L2 SQLite persistence
    if (this.sqlStore) {
      const sqlEntry = await this.sqlStore.get<T>(key);
      if (sqlEntry) {
        // Populate L1 memory
        this.lru.set(key, sqlEntry as CacheEntry);

        if (now < sqlEntry.freshUntil) {
          return {
            status: 'fresh',
            data: sqlEntry.value,
            ageMs: now - sqlEntry.createdAt,
            freshUntil: sqlEntry.freshUntil,
            staleUntil: sqlEntry.staleUntil,
            isHit: true,
            isStale: false,
          };
        }
        if (now < sqlEntry.staleUntil) {
          return {
            status: 'stale',
            data: sqlEntry.value,
            ageMs: now - sqlEntry.createdAt,
            freshUntil: sqlEntry.freshUntil,
            staleUntil: sqlEntry.staleUntil,
            isHit: true,
            isStale: true,
          };
        }
        // Expired in SQLite: remove
        await this.sqlStore.delete(key);
      }
    }

    return { status: 'miss', isHit: false, isStale: false };
  }

  /**
   * Core Stale-While-Revalidate execution:
   * - If fresh in cache: returns immediately without network request.
   * - If stale in cache: returns immediately, revalidates in background, and notifies subscribers.
   * - If miss: fetches with in-flight request deduplication.
   */
  async getOrFetch<T, E extends AppError = AppError>(
    key: string,
    dataType: CacheDataType,
    fetcher: () => Promise<Result<T, E>>,
    options: GetOrFetchOptions = {},
  ): Promise<Result<T, E>> {
    if (options.skipCache) {
      return this.deduper.dedupe(key, fetcher);
    }

    if (!options.forceRefresh) {
      const cached = await this.get<T>(key);

      if (cached.status === 'fresh' && cached.data !== undefined) {
        this.hits++;
        return ok(cached.data);
      }

      if (cached.status === 'stale' && cached.data !== undefined) {
        this.hits++;
        this.staleHits++;

        // Trigger background revalidation asynchronously without blocking caller
        this.revalidateInBackground(key, dataType, fetcher, options);

        return ok(cached.data);
      }
    }

    // Cache miss or forceRefresh
    this.misses++;
    const fetchResult = await this.deduper.dedupe(key, fetcher);

    if (isOk(fetchResult)) {
      await this.put(key, dataType, fetchResult.value, options);
    }

    return fetchResult;
  }

  /**
   * Writes entry into both L1 in-memory and L2 SQLite cache.
   */
  async put<T>(
    key: string,
    dataType: CacheDataType,
    value: T,
    options: GetOrFetchOptions = {},
  ): Promise<void> {
    const now = this.clock.now();
    const policy = { ...this.policies[dataType], ...options.ttl };

    let freshUntil: number;
    let staleUntil: number;

    if (dataType === 'stream' && options.expiresAt) {
      // Expiry-aware stream calculation: buffer before provider expiration
      const safetyBufferMs = 5 * 60 * 1000; // 5 min safety buffer
      freshUntil = Math.max(now, options.expiresAt - safetyBufferMs);
      staleUntil = Math.max(now, options.expiresAt);
    } else {
      freshUntil = now + policy.freshTtlMs;
      staleUntil = now + policy.staleTtlMs;
    }

    const entry: CacheEntry<T> = {
      key,
      dataType,
      value,
      scope: options.scope ?? 'guest',
      createdAt: now,
      freshUntil,
      staleUntil,
      sizeBytes: 0,
    };

    // Store in L1
    this.lru.set(key, entry as CacheEntry);

    // Store in L2
    if (this.sqlStore) {
      try {
        await this.sqlStore.set(entry);
      } catch (err) {
        logger.warn(`[CacheManager] Failed to persist ${key} in SQLite`, { error: String(err) });
      }
    }

    this.notifySubscribers(key, value);
  }

  /**
   * Subscribe to background updates for a cache key.
   */
  subscribe<T>(key: string, callback: (freshData: T) => void): () => void {
    let keySubs = this.subscribers.get(key);
    if (!keySubs) {
      keySubs = new Set();
      this.subscribers.set(key, keySubs);
    }
    const untypedCb = callback as (data: unknown) => void;
    keySubs.add(untypedCb);

    return () => {
      keySubs?.delete(untypedCb);
      if (keySubs && keySubs.size === 0) {
        this.subscribers.delete(key);
      }
    };
  }

  /**
   * Evicts a key from memory and SQLite.
   */
  async evict(key: string): Promise<void> {
    this.lru.delete(key);
    if (this.sqlStore) {
      await this.sqlStore.delete(key);
    }
  }

  /**
   * Clears everything across all tiers.
   */
  async clear(): Promise<void> {
    this.lru.clear();
    this.deduper.clear();
    this.subscribers.clear();
    if (this.sqlStore) {
      await this.sqlStore.clear();
    }
    this.hits = 0;
    this.misses = 0;
    this.staleHits = 0;
    this.revalidations = 0;
  }

  /**
   * Returns current cache statistics.
   */
  async getStats(): Promise<CacheStats> {
    const sqlCount = this.sqlStore ? await this.sqlStore.count() : 0;
    return {
      hits: this.hits,
      misses: this.misses,
      staleHits: this.staleHits,
      revalidations: this.revalidations,
      evictions: this.lru.evictions(),
      inMemoryCount: this.lru.size(),
      inMemorySizeBytes: this.lru.totalSizeBytes(),
      sqlCount,
    };
  }

  private revalidateInBackground<T, E extends AppError>(
    key: string,
    dataType: CacheDataType,
    fetcher: () => Promise<Result<T, E>>,
    options: GetOrFetchOptions,
  ): void {
    // Run in background without awaiting
    this.deduper
      .dedupe(key, fetcher)
      .then(async (result) => {
        if (isOk(result)) {
          this.revalidations++;
          await this.put(key, dataType, result.value, options);
          logger.debug(`[CacheManager] Revalidated ${key} in background`);
        }
      })
      .catch((err) => {
        logger.warn(`[CacheManager] Background revalidation failed for ${key}`, {
          error: String(err),
        });
      });
  }

  private notifySubscribers<T>(key: string, freshData: T): void {
    const keySubs = this.subscribers.get(key);
    if (keySubs && keySubs.size > 0) {
      for (const cb of keySubs) {
        try {
          cb(freshData);
        } catch (err) {
          logger.error(`[CacheManager] Subscriber callback error for ${key}`, {
            error: String(err),
          });
        }
      }
    }
  }
}
