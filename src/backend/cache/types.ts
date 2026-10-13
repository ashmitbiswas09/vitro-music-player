/**
 * Cache module types, policy definitions, and key builder utilities.
 */

import { z } from 'zod';

export type CacheDataType =
  | 'home'
  | 'search'
  | 'album'
  | 'artist'
  | 'playlist'
  | 'stream'
  | 'suggest';

export interface CachePolicy {
  /** Duration in ms that cached data is considered fresh (returned immediately without revalidation) */
  freshTtlMs: number;
  /** Duration in ms that cached data can be served stale while refreshing in the background */
  staleTtlMs: number;
  /**
   * Whether entries under this policy should be persisted to SQLite. Default: true.
   * Ephemeral or IP-tied data (such as signed stream URLs) MUST be false to remain in-memory only.
   */
  persistToSql?: boolean;
}

export const DEFAULT_CACHE_POLICIES: Record<CacheDataType, CachePolicy> = {
  home: {
    freshTtlMs: 10 * 60 * 1000, // 10 minutes
    staleTtlMs: 24 * 60 * 60 * 1000, // 24 hours
  },
  search: {
    freshTtlMs: 5 * 60 * 1000, // 5 minutes
    staleTtlMs: 60 * 60 * 1000, // 1 hour
  },
  album: {
    freshTtlMs: 24 * 60 * 60 * 1000, // 24 hours
    staleTtlMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
  artist: {
    freshTtlMs: 12 * 60 * 60 * 1000, // 12 hours
    staleTtlMs: 3 * 24 * 60 * 60 * 1000, // 3 days
  },
  playlist: {
    freshTtlMs: 15 * 60 * 1000, // 15 minutes
    staleTtlMs: 24 * 60 * 60 * 1000, // 24 hours
  },
  suggest: {
    freshTtlMs: 30 * 60 * 1000, // 30 minutes
    staleTtlMs: 2 * 60 * 60 * 1000, // 2 hours
  },
  stream: {
    // Expiry-aware: dynamic safety window before stream URL expires.
    // In-memory tier ONLY: signed stream URLs contain client IP bindings (ip=...)
    // and fail with HTTP 403 upon network change (e.g. Wi-Fi <-> Cellular).
    freshTtlMs: 5 * 60 * 1000, // 5 minutes default
    staleTtlMs: 10 * 60 * 1000, // 10 minutes default
    persistToSql: false,
  },
};

export interface CacheEntry<T = unknown> {
  key: string;
  dataType: CacheDataType;
  value: T;
  scope: string; // 'guest' or 'user:<id>'
  createdAt: number;
  freshUntil: number;
  staleUntil: number;
  sizeBytes: number;
}

export type CacheHitStatus = 'fresh' | 'stale' | 'miss';
export type CacheDataSource = 'network' | 'memory' | 'sqlite';
export type CacheFreshness = 'fresh' | 'stale' | 'none';

export interface CacheFetchMeta {
  source: CacheDataSource;
  freshness: CacheFreshness;
}

export interface CacheGetResult<T> {
  status: CacheHitStatus;
  data?: T;
  ageMs?: number;
  freshUntil?: number;
  staleUntil?: number;
  isHit: boolean;
  isStale: boolean;
  source?: 'memory' | 'sqlite';
}

export interface CacheStats {
  hits: number;
  misses: number;
  staleHits: number;
  revalidations: number;
  evictions: number;
  inMemoryCount: number;
  inMemorySizeBytes: number;
  sqlCount: number;
}

export interface GetOrFetchOptions {
  /** Force network bypass of existing cache */
  forceRefresh?: boolean;
  /** Skip writing to or reading from cache */
  skipCache?: boolean;
  /** Auth/user scope ('guest' or 'user:<id>') */
  scope?: string;
  /** Override TTL configuration for this specific call */
  ttl?: Partial<CachePolicy>;
  /** Optional stream expiry timestamp (ms) for expiry-aware TTL calculation */
  expiresAt?: number;
}

/**
 * Cache key builder guaranteeing keys are built only from validated real IDs
 * and parameters, preventing auth-leakage and collision.
 */
export const CacheKeyBuilder = {
  home(scope = 'guest'): string {
    const cleanScope = scope === 'guest' ? 'guest' : scope.startsWith('user:') ? scope : `user:${scope}`;
    return `browse:home:auth:${cleanScope}`;
  },
  search(query: string, filter = 'all', scope = 'guest'): string {
    const normalized = query.trim().toLowerCase().replace(/\s+/g, ' ');
    const cleanScope = scope === 'guest' ? 'guest' : scope.startsWith('user:') ? scope : `user:${scope}`;
    const prefix = cleanScope === 'guest' ? 'search' : `auth:${cleanScope}:search`;
    return `${prefix}:${normalized}:filter:${filter}`;
  },
  album(albumId: string): string {
    if (!albumId.startsWith('MPREb_') && !albumId.startsWith('OLAK5uy_')) {
      throw new Error(`Invalid album ID shape "${albumId}": must start with MPREb_ or OLAK5uy_`);
    }
    return `album:${albumId}`;
  },
  artist(artistId: string): string {
    if (!artistId.startsWith('UC') || artistId.length !== 24) {
      throw new Error(`Invalid artist ID shape "${artistId}": must start with UC and be 24 characters`);
    }
    return `artist:${artistId}`;
  },
  playlist(playlistId: string): string {
    if (!playlistId.startsWith('VL') && !playlistId.startsWith('PL') && !playlistId.startsWith('RD')) {
      throw new Error(`Invalid playlist ID shape "${playlistId}": must start with VL, PL, or RD`);
    }
    return `playlist:${playlistId}`;
  },
  next(videoId: string): string {
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      throw new Error(`Invalid videoId shape "${videoId}": must be 11 characters`);
    }
    return `next:${videoId}`;
  },
  suggest(query: string): string {
    return `suggest:${query.trim().toLowerCase()}`;
  },
  stream(videoId: string): string {
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      throw new Error(`Invalid track videoId shape "${videoId}": must be 11 characters`);
    }
    return `stream:${videoId}`;
  },
};

export const CacheEntrySchema = z.object({
  key: z.string().min(1),
  dataType: z.enum(['home', 'search', 'album', 'artist', 'playlist', 'stream', 'suggest']),
  value: z.unknown(),
  scope: z.string().default('guest'),
  createdAt: z.number().nonnegative(),
  freshUntil: z.number().nonnegative(),
  staleUntil: z.number().nonnegative(),
  sizeBytes: z.number().nonnegative(),
});
