/**
 * Cache module public API.
 * SWR caching, TTL policies, LRU memory cache, SQLite persistence,
 * in-flight request deduplication, and prefetch planner.
 */

export const CACHE_MODULE_NAME = 'cache' as const;

export * from './types';
export * from './lru-cache';
export * from './sql-cache-store';
export * from './in-flight-deduper';
export * from './swr-cache-manager';
export * from './prefetch-planner';
