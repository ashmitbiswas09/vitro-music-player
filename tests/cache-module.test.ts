import { describe, it, expect, vi } from 'vitest';
import {
  ok,
  TestClock,
  ParseError,
  StreamError,
} from '@/backend/core';
import {
  MemorySqlDatabase,
} from '@/backend/platform';
import { NodeSqliteDatabase } from './helpers/node-sqlite-database';
import {
  CacheManager,
  LruCache,
  SqlCacheStore,
  InFlightDeduper,
  PrefetchPlanner,
  CacheKeyBuilder,
} from '@/backend/cache';
import { MusicRepository } from '@/backend/services/music-repository';
import type { InnertubeClient } from '@/backend/innertube';
import type { StreamResolver, ResolvedStream } from '@/backend/streaming';

describe('Phase 4: Cache Module', () => {
  describe('LruCache', () => {
    it('evicts least recently used items when maxEntries is exceeded', () => {
      const lru = new LruCache<string>({ maxEntries: 3 });
      lru.set('a', 'alpha', 10);
      lru.set('b', 'beta', 10);
      lru.set('c', 'gamma', 10);

      expect(lru.size()).toBe(3);
      expect(lru.get('a')).toBe('alpha'); // 'a' accessed, LRU order is now: b, c, a

      lru.set('d', 'delta', 10); // Should evict 'b'
      expect(lru.size()).toBe(3);
      expect(lru.get('b')).toBeUndefined();
      expect(lru.get('a')).toBe('alpha');
      expect(lru.get('c')).toBe('gamma');
      expect(lru.get('d')).toBe('delta');
      expect(lru.evictions()).toBe(1);
    });

    it('evicts entries when maxSizeBytes is exceeded', () => {
      const lru = new LruCache<string>({ maxSizeBytes: 100 });
      lru.set('item1', 'A'.repeat(40), 40);
      lru.set('item2', 'B'.repeat(40), 40);
      expect(lru.totalSizeBytes()).toBe(80);

      // Adding 40 bytes exceeds 100 limit, should evict oldest (item1)
      lru.set('item3', 'C'.repeat(40), 40);
      expect(lru.get('item1')).toBeUndefined();
      expect(lru.get('item2')).toBeDefined();
      expect(lru.get('item3')).toBeDefined();
      expect(lru.totalSizeBytes()).toBe(80);
      expect(lru.evictions()).toBe(1);
    });

    it('clears all items and resets metrics', () => {
      const lru = new LruCache<string>({ maxEntries: 5 });
      lru.set('k1', 'v1', 10);
      lru.set('k2', 'v2', 20);
      expect(lru.size()).toBe(2);
      expect(lru.totalSizeBytes()).toBe(30);

      lru.clear();
      expect(lru.size()).toBe(0);
      expect(lru.totalSizeBytes()).toBe(0);
      expect(lru.evictions()).toBe(0);
    });
  });

  describe('SqlCacheStore (Real SQLite vs Memory Fake Contract Tests)', () => {
    const databases = [
      { name: 'MemorySqlDatabase (in-memory fake)', createDb: () => new MemorySqlDatabase() },
      {
        name: 'NodeSqliteDatabase (real SQLite via node:sqlite)',
        createDb: () => new NodeSqliteDatabase(':memory:'),
      },
    ];

    databases.forEach(({ name, createDb }) => {
      describe(name, () => {
        it('initializes schema and persists entries', async () => {
          const db = createDb();
          const store = new SqlCacheStore(db);

          await store.init();
          await store.set({
            key: 'test:1',
            dataType: 'search',
            scope: 'guest',
            value: { query: 'rock' },
            sizeBytes: 25,
            createdAt: 1000,
            freshUntil: 2000,
            staleUntil: 5000,
          });

          const entry = await store.get<{ query: string }>('test:1');
          expect(entry).toBeDefined();
          expect(entry?.key).toBe('test:1');
          expect(entry?.dataType).toBe('search');
          expect(entry?.value).toEqual({ query: 'rock' });
          expect(await store.count()).toBe(1);
        });

        it('replaces existing entry on primary key collision', async () => {
          const db = createDb();
          const store = new SqlCacheStore(db);
          await store.init();

          await store.set({
            key: 'item:1',
            dataType: 'album',
            scope: 'guest',
            value: { title: 'Old Title' },
            sizeBytes: 10,
            createdAt: 100,
            freshUntil: 200,
            staleUntil: 500,
          });

          await store.set({
            key: 'item:1',
            dataType: 'album',
            scope: 'guest',
            value: { title: 'New Title' },
            sizeBytes: 10,
            createdAt: 200,
            freshUntil: 300,
            staleUntil: 600,
          });

          const entry = await store.get<{ title: string }>('item:1');
          expect(entry?.value.title).toBe('New Title');
          expect(await store.count()).toBe(1);
        });

        it('prunes expired entries based on staleUntil threshold', async () => {
          const db = createDb();
          const store = new SqlCacheStore(db);
          await store.init();

          await store.set({
            key: 'old:1',
            dataType: 'home',
            scope: 'guest',
            value: {},
            sizeBytes: 2,
            createdAt: 100,
            freshUntil: 200,
            staleUntil: 500,
          });

          await store.set({
            key: 'fresh:1',
            dataType: 'home',
            scope: 'guest',
            value: {},
            sizeBytes: 2,
            createdAt: 600,
            freshUntil: 800,
            staleUntil: 1500,
          });

          const pruned = await store.deleteExpired(600);
          expect(pruned).toBe(1);
          expect(await store.get('old:1')).toBeNull();
          expect(await store.get('fresh:1')).not.toBeNull();
        });

        it('clears user-scoped entries while keeping guest entries intact', async () => {
          const db = createDb();
          const store = new SqlCacheStore(db);
          await store.init();

          await store.set({
            key: 'browse:home:auth:guest',
            dataType: 'home',
            scope: 'guest',
            value: { feed: 'guest' },
            sizeBytes: 10,
            createdAt: 100,
            freshUntil: 500,
            staleUntil: 1000,
          });

          await store.set({
            key: 'browse:home:auth:user:123',
            dataType: 'home',
            scope: 'user:123',
            value: { feed: 'user' },
            sizeBytes: 10,
            createdAt: 100,
            freshUntil: 500,
            staleUntil: 1000,
          });

          const removed = await store.clearUserScoped();
          expect(removed).toBe(1);
          expect(await store.get('browse:home:auth:guest')).not.toBeNull();
          expect(await store.get('browse:home:auth:user:123')).toBeNull();
          expect(await store.count()).toBe(1);
        });
      });
    });
  });

  describe('InFlightDeduper', () => {
    it('coalesces multiple concurrent identical requests into one execution', async () => {
      const deduper = new InFlightDeduper();
      let executionCount = 0;

      const fetcher = async () => {
        executionCount++;
        await new Promise((res) => setTimeout(res, 20));
        return ok('fetched-value');
      };

      const [res1, res2, res3] = await Promise.all([
        deduper.dedupe('key1', fetcher),
        deduper.dedupe('key1', fetcher),
        deduper.dedupe('key1', fetcher),
      ]);

      expect(executionCount).toBe(1);
      expect(res1).toEqual(ok('fetched-value'));
      expect(res2).toEqual(ok('fetched-value'));
      expect(res3).toEqual(ok('fetched-value'));
    });
  });

  describe('CacheManager (SWR, Expiry, Sub-100ms, Observability)', () => {
    it('returns fresh data instantly (<100ms) without invoking fetcher', async () => {
      const clock = new TestClock(1000);
      const db = new MemorySqlDatabase();
      const manager = new CacheManager({ clock, sqlDatabase: db });

      let fetchCount = 0;
      const fetcher = async () => {
        fetchCount++;
        return ok({ results: ['track1'] });
      };

      // Cold call
      const res1 = await manager.getOrFetch('search:rock', 'search', fetcher);
      expect(res1.ok).toBe(true);
      expect(fetchCount).toBe(1);

      // Warm call at T=1050 (fresh TTL is 5 min = 300,000 ms)
      clock.advanceBy(50);
      const startMs = Date.now();
      const res2 = await manager.getOrFetch('search:rock', 'search', fetcher);
      const elapsedMs = Date.now() - startMs;

      expect(res2.ok).toBe(true);
      expect(fetchCount).toBe(1); // Fetcher NOT called again
      expect(elapsedMs).toBeLessThan(100);

      const stats = await manager.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });

    it('serves stale data immediately and triggers background revalidation notifying subscriber', async () => {
      const clock = new TestClock(1000);
      const db = new MemorySqlDatabase();
      const manager = new CacheManager({
        clock,
        sqlDatabase: db,
        policies: {
          home: { freshTtlMs: 500, staleTtlMs: 2000 },
        },
      });

      let fetchCount = 0;
      let returnVal = 'initial-data';
      const fetcher = async () => {
        fetchCount++;
        return ok({ feed: returnVal });
      };

      // Cold call at T=1000
      await manager.getOrFetch('browse:home', 'home', fetcher);
      expect(fetchCount).toBe(1);

      // Advance clock to T=1600 (past fresh 500ms, but within stale 2000ms)
      clock.advanceBy(600);

      // Subscribe to background updates
      let notifiedData: unknown = null;
      const unsubscribe = manager.subscribe('browse:home', (fresh) => {
        notifiedData = fresh;
      });

      // Update what fetcher will return on revalidation
      returnVal = 'updated-fresh-data';

      // SWR call: must return stale data immediately
      const swrResult = await manager.getOrFetch('browse:home', 'home', fetcher);
      expect(swrResult.ok).toBe(true);
      if (swrResult.ok) {
        expect(swrResult.value).toEqual({ feed: 'initial-data' });
      }

      // Wait a tick for background revalidation promise to complete
      await new Promise((res) => setTimeout(res, 30));

      expect(fetchCount).toBe(2);
      expect(notifiedData).toEqual({ feed: 'updated-fresh-data' });

      // Clean up subscription
      unsubscribe();
    });

    it('expires completely past stale TTL and treats as cache miss', async () => {
      const clock = new TestClock(1000);
      const manager = new CacheManager({
        clock,
        policies: {
          search: { freshTtlMs: 100, staleTtlMs: 300 },
        },
      });

      let callCount = 0;
      const fetcher = async () => {
        callCount++;
        return ok('val-' + callCount);
      };

      await manager.getOrFetch('q:test', 'search', fetcher);
      expect(callCount).toBe(1);

      // Advance past stale TTL (300ms)
      clock.advanceBy(350);

      const res = await manager.getOrFetch('q:test', 'search', fetcher);
      expect(res).toEqual(ok('val-2'));
      expect(callCount).toBe(2);
    });

    it('persists and restores data across multiple CacheManager instances via SqlDatabase', async () => {
      const clock = new TestClock(1000);
      const sharedDb = new MemorySqlDatabase();

      const manager1 = new CacheManager({ clock, sqlDatabase: sharedDb });
      await manager1.getOrFetch('album:MPREb_123', 'album', async () =>
        ok({ title: 'OK Computer' }),
      );

      // Create a second manager with the same SQLite DB but empty L1 LRU
      const manager2 = new CacheManager({ clock, sqlDatabase: sharedDb });
      const getResult = await manager2.get<{ title: string }>('album:MPREb_123');

      expect(getResult.isHit).toBe(true);
      expect(getResult.isStale).toBe(false);
      expect(getResult.data?.title).toBe('OK Computer');
    });

    it('clears all tiers and resets metrics', async () => {
      const sharedDb = new MemorySqlDatabase();
      const manager = new CacheManager({ sqlDatabase: sharedDb });

      await manager.getOrFetch('key:1', 'search', async () => ok('data'));
      let stats = await manager.getStats();
      expect(stats.inMemoryCount).toBe(1);
      expect(stats.sqlCount).toBe(1);

      await manager.clear();
      stats = await manager.getStats();
      expect(stats.inMemoryCount).toBe(0);
      expect(stats.sqlCount).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });

    it('keeps stream URLs in in-memory tier only and never persists them to SQLite', async () => {
      const db = new NodeSqliteDatabase(':memory:');
      const manager = new CacheManager({ sqlDatabase: db });

      const streamKey = CacheKeyBuilder.stream('9RfVp-GhKfs');
      await manager.put(
        streamKey,
        'stream',
        { url: 'https://googlevideo.com/videoplayback?ip=1.2.3.4' },
        { expiresAt: Date.now() + 3600_000 },
      );

      // Present in L1 memory
      const memRes = await manager.get(streamKey);
      expect(memRes.isHit).toBe(true);

      // Initialize a persistent entry to ensure SQLite schema is created
      await manager.put('search:test', 'search', { ok: true });
      const stats = await manager.getStats();
      expect(stats.sqlCount).toBe(1); // Only search:test is in SQLite, not stream!

      // Never persisted to L2 SQLite because signed stream URLs are IP-bound
      const sqlRows = await db.query('SELECT * FROM cache_entries WHERE key = ?', [streamKey]);
      expect(sqlRows.ok).toBe(true);
      if (sqlRows.ok) {
        expect(sqlRows.value.length).toBe(0);
      }
    });

    it('invalidates stream entry so subsequent call triggers re-resolution', async () => {
      const manager = new CacheManager();
      const videoId = '9RfVp-GhKfs';
      const streamKey = CacheKeyBuilder.stream(videoId);

      await manager.put(streamKey, 'stream', { url: 'https://initial-stream.com' });
      expect((await manager.get(streamKey)).isHit).toBe(true);

      // Invalidate stream
      await manager.invalidateStream(videoId);
      expect((await manager.get(streamKey)).isHit).toBe(false);
    });

    it('clears user-scoped data across memory and SQLite on logout while keeping guest cache intact', async () => {
      const db = new NodeSqliteDatabase(':memory:');
      const manager = new CacheManager({ sqlDatabase: db });

      // Add guest entry
      const guestKey = CacheKeyBuilder.home('guest');
      await manager.put(guestKey, 'home', { feed: 'guest-feed' }, { scope: 'guest' });

      // Add user entry
      const userKey = CacheKeyBuilder.home('user:alice');
      await manager.put(userKey, 'home', { feed: 'alice-feed' }, { scope: 'user:alice' });

      expect((await manager.get(guestKey)).isHit).toBe(true);
      expect((await manager.get(userKey)).isHit).toBe(true);

      // Logout: clear user-scoped data
      await manager.clearUserScopedData();

      // Guest remains warm in cache
      expect((await manager.get(guestKey)).isHit).toBe(true);
      // User data is purged from memory and SQLite
      expect((await manager.get(userKey)).isHit).toBe(false);

      const userSqlRows = await db.query('SELECT * FROM cache_entries WHERE key = ?', [userKey]);
      expect(userSqlRows.ok).toBe(true);
      if (userSqlRows.ok) {
        expect(userSqlRows.value.length).toBe(0);
      }
    });

    it('clears memory tier only, enabling cold start simulation restored from SQLite', async () => {
      const db = new NodeSqliteDatabase(':memory:');
      const manager = new CacheManager({ sqlDatabase: db });

      await manager.put('search:test:filter:all', 'search', { results: [1, 2, 3] });
      let stats = await manager.getStats();
      expect(stats.inMemoryCount).toBe(1);
      expect(stats.sqlCount).toBe(1);

      // Clear memory tier only
      manager.clearMemoryTier();
      stats = await manager.getStats();
      expect(stats.inMemoryCount).toBe(0);
      expect(stats.sqlCount).toBe(1); // SQLite persists!

      // Fetch restores from SQLite into L1 memory
      const restored = await manager.get('search:test:filter:all');
      expect(restored.isHit).toBe(true);
      stats = await manager.getStats();
      expect(stats.inMemoryCount).toBe(1); // Restored into memory!
    });
  });

  describe('CacheKeyBuilder (Strict Validation & Auth Isolation)', () => {
    it('isolates guest vs authenticated user home feed cache keys', () => {
      const guestKey = CacheKeyBuilder.home('guest');
      const userKey1 = CacheKeyBuilder.home('user:alice');
      const userKey2 = CacheKeyBuilder.home('user:bob');

      expect(guestKey).toBe('browse:home:auth:guest');
      expect(userKey1).toBe('browse:home:auth:user:alice');
      expect(userKey2).toBe('browse:home:auth:user:bob');
      expect(guestKey).not.toEqual(userKey1);
      expect(userKey1).not.toEqual(userKey2);
    });

    it('builds canonical search keys with normalized parameters', () => {
      const key1 = CacheKeyBuilder.search('  Radiohead Creep  ', 'songs');
      const key2 = CacheKeyBuilder.search('radiohead creep', 'songs');
      expect(key1).toBe('search:radiohead creep:filter:songs');
      expect(key1).toBe(key2);
    });

    it('enforces exact shape checks for albums, artists, playlists, and tracks', () => {
      expect(CacheKeyBuilder.album('MPREb_yXhSI4FCUo6')).toBe('album:MPREb_yXhSI4FCUo6');
      expect(CacheKeyBuilder.album('OLAK5uy_kbcj7')).toBe('album:OLAK5uy_kbcj7');
      expect(() => CacheKeyBuilder.album('invalid_id')).toThrow(/Invalid album ID shape/);

      expect(CacheKeyBuilder.artist('UCr_iyUANcn9OX_yy9piYoLw')).toBe(
        'artist:UCr_iyUANcn9OX_yy9piYoLw',
      );
      expect(() => CacheKeyBuilder.artist('not_uc_id')).toThrow(/Invalid artist ID shape/);

      expect(CacheKeyBuilder.playlist('PL4fGSI1pDJn6O1LS0XSdF3RyO0Rq_LDeI')).toBe(
        'playlist:PL4fGSI1pDJn6O1LS0XSdF3RyO0Rq_LDeI',
      );
      expect(() => CacheKeyBuilder.playlist('invalid_pl')).toThrow(/Invalid playlist ID shape/);

      expect(CacheKeyBuilder.stream('9RfVp-GhKfs')).toBe('stream:9RfVp-GhKfs');
      expect(() => CacheKeyBuilder.stream('short')).toThrow(/Invalid track videoId shape/);
    });
  });

  describe('PrefetchPlanner', () => {
    it('prefetches audio streams for the next 1-2 tracks in queue', async () => {
      const clock = new TestClock(1000);
      const manager = new CacheManager({ clock });

      const resolvedMap = new Map<string, ResolvedStream>();
      const mockResolver: StreamResolver = {
        resolve: vi.fn(async (videoId: string) => {
          const res: ResolvedStream = {
            stream: {
              url: `https://googlevideo.com/audio_${videoId}`,
              mimeType: 'audio/webm; codecs="opus"',
              codec: 'opus',
              bitrate: 160000,
              expiresAt: clock.now() + 6 * 3600 * 1000, // 6h expiry
              sampleRate: 48000,
              loudnessDb: -1.2,
            },
            strategyName: 'android-vr',
            requestHeaders: { 'User-Agent': 'Test' },
          };
          resolvedMap.set(videoId, res);
          return ok(res);
        }),
        verify: vi.fn(),
        resolveAndVerify: vi.fn(),
        verifyFull: vi.fn(),
      };

      const planner = new PrefetchPlanner(manager, mockResolver, clock);

      // Queue of 4 tracks (all valid 11-char videoIds)
      const queue = ['track000001', 'track000002', 'track000003', 'track000004'];

      // Prefetch for currentIndex = 0: should prefetch track 1 and track 2
      const prefetched = await planner.prefetchForQueue(queue, 0, 2);
      expect(prefetched).toEqual(['track000002', 'track000003']);
      expect(mockResolver.resolve).toHaveBeenCalledTimes(2);

      // Verifying track 1 is now warm in cache
      const cachedTrack2 = await manager.get(CacheKeyBuilder.stream('track000002'));
      expect(cachedTrack2.isHit).toBe(true);
      expect(cachedTrack2.isStale).toBe(false);

      // Running prefetch again should skip already-cached fresh tracks
      const secondPrefetch = await planner.prefetchForQueue(queue, 0, 2);
      expect(secondPrefetch).toEqual([]);
      expect(mockResolver.resolve).toHaveBeenCalledTimes(2); // no extra calls
    });

    it('proactively re-resolves stream when close to expiry threshold', async () => {
      const clock = new TestClock(1000);
      const manager = new CacheManager({ clock });

      let resolveCount = 0;
      const mockResolver: StreamResolver = {
        resolve: vi.fn(async (videoId: string) => {
          resolveCount++;
          const res: ResolvedStream = {
            stream: {
              url: `https://googlevideo.com/audio_${videoId}`,
              mimeType: 'audio/webm',
              codec: 'opus',
              bitrate: 160000,
              // Stream expires in 4 minutes (less than the 5-minute prefetch threshold)
              expiresAt: clock.now() + 240_000,
              sampleRate: 48000,
            },
            strategyName: 'android-vr',
            requestHeaders: {},
          };
          return ok(res);
        }),
        verify: vi.fn(),
        resolveAndVerify: vi.fn(),
        verifyFull: vi.fn(),
      };

      const planner = new PrefetchPlanner(manager, mockResolver, clock);

      // Initial prefetch
      await planner.prefetchTrack('track000001');
      expect(resolveCount).toBe(1);

      // Calling reResolveIfExpiring: since expiresAt is within 5 minutes, it should proactively re-resolve
      const reResolved = await planner.reResolveIfExpiring('track000001', 300_000);
      expect(reResolved).toBe(true);
      expect(resolveCount).toBe(2);
    });
  });

  describe('MusicRepository Layer Over InnertubeClient', () => {
    it('prevents callers from calling client directly and validates id shapes defensively', async () => {
      const clock = new TestClock(1000);
      const manager = new CacheManager({ clock });

      const mockInnertube: InnertubeClient = {
        search: vi.fn(),
        getAlbum: vi.fn(),
        getArtist: vi.fn(),
        getPlaylist: vi.fn(),
        getNext: vi.fn(),
        getHome: vi.fn(),
        getSearchSuggestions: vi.fn(),
      } as unknown as InnertubeClient;

      const mockResolver: StreamResolver = {
        resolve: vi.fn(),
        verify: vi.fn(),
        resolveAndVerify: vi.fn(),
        verifyFull: vi.fn(),
      };

      const repo = new MusicRepository({
        innertube: mockInnertube,
        streamResolver: mockResolver,
        cache: manager,
      });

      // Invalid album ID rejection
      const invalidAlbum = await repo.getAlbum('invalid_album_id');
      expect(invalidAlbum.ok).toBe(false);
      if (!invalidAlbum.ok) {
        expect(invalidAlbum.error).toBeInstanceOf(ParseError);
        expect(invalidAlbum.error.message).toContain('Invalid album ID shape');
      }
      expect(mockInnertube.getAlbum).not.toHaveBeenCalled();

      // Invalid stream ID rejection
      const invalidStream = await repo.resolveStream('invalid_track');
      expect(invalidStream.ok).toBe(false);
      if (!invalidStream.ok) {
        expect(invalidStream.error).toBeInstanceOf(StreamError);
      }
      expect(mockResolver.resolve).not.toHaveBeenCalled();
    });

    it('caches successful responses and returns warm cached responses on subsequent calls', async () => {
      const clock = new TestClock(1000);
      const manager = new CacheManager({ clock });

      let albumCallCount = 0;
      const mockInnertube: InnertubeClient = {
        getAlbum: vi.fn(async (albumId: string) => {
          albumCallCount++;
          return ok({
            album: {
              browseId: albumId,
              title: 'OK Computer',
              artists: [{ name: 'Radiohead', browseId: 'UCr_iyUANcn9OX_yy9piYoLw' }],
              year: '1997',
              trackCount: 12,
              durationSeconds: 3180,
              tracks: [],
            },
            parseDurationMs: 5,
            responseSizeBytes: 2048,
          });
        }),
      } as unknown as InnertubeClient;

      const mockResolver: StreamResolver = {
        resolve: vi.fn(),
      } as unknown as StreamResolver;

      const repo = new MusicRepository({
        innertube: mockInnertube,
        streamResolver: mockResolver,
        cache: manager,
      });

      // Call 1: cold
      const res1 = await repo.getAlbum('MPREb_yXhSI4FCUo6');
      expect(res1.ok).toBe(true);
      expect(albumCallCount).toBe(1);

      // Call 2: warm
      const res2 = await repo.getAlbum('MPREb_yXhSI4FCUo6');
      expect(res2.ok).toBe(true);
      expect(albumCallCount).toBe(1); // Innertube was NOT called a second time!

      const stats = await repo.getCacheStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });
  });
});
