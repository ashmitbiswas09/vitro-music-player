/**
 * LyricsService orchestrating LRCLIB fetching, LRC parsing, title cleaning,
 * and two-tier caching with positive (7-day) and negative (1-hour) TTLs.
 */

import type { Result, AppError, Clock, Logger } from '@/backend/core';
import { ok, err, createLogger, SystemClock, NetworkError } from '@/backend/core';
import type { CacheManager } from '@/backend/cache';
import { CacheKeyBuilder } from '@/backend/cache';
import type { LyricsResult, LyricsSearchQuery, LyricsServiceOptions } from './types';
import { LrclibProvider } from './lrclib-provider';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export class LyricsService {
  private readonly provider: LrclibProvider;
  private readonly cacheManager: CacheManager;
  private readonly clock: Clock;
  private readonly logger: Logger;

  constructor(options: LyricsServiceOptions) {
    this.logger = options.logger ?? createLogger({ prefix: 'LyricsService' });
    this.provider = new LrclibProvider(options.httpClient, this.logger);
    this.cacheManager = options.cacheManager;
    this.clock = options.clock ?? new SystemClock();
  }

  /**
   * Fetches synchronized or plain text lyrics for a track, utilizing the
   * two-tier cache with 7-day TTL for positive hits and 1-hour negative caching.
   */
  async getLyrics(
    query: LyricsSearchQuery,
    options?: { forceRefresh?: boolean },
  ): Promise<Result<LyricsResult, AppError>> {
    const key = CacheKeyBuilder.lyrics(query.videoId);

    // 1. Check cache tier unless forceRefresh is set
    if (!options?.forceRefresh) {
      const cached = await this.cacheManager.get<LyricsResult>(key);
      if (cached.status === 'fresh' && cached.data) {
        this.logger.debug(`Cache HIT (fresh) for lyrics: "${query.videoId}"`);
        return ok(cached.data);
      }
      if (cached.status === 'stale' && cached.data) {
        this.logger.debug(`Cache HIT (stale) for lyrics: "${query.videoId}". Revalidating...`);
        // Revalidate in background
        this.fetchAndCache(query, key).catch(() => {});
        return ok(cached.data);
      }
    }

    // 2. Cache miss or forced refresh: execute network lookup
    return this.fetchAndCache(query, key);
  }

  /**
   * Subscribes to lyrics updates for a specific video ID.
   */
  observeLyrics(videoId: string, callback: (lyrics: LyricsResult) => void): () => void {
    const key = CacheKeyBuilder.lyrics(videoId);
    return this.cacheManager.subscribe(key, callback);
  }

  private async fetchAndCache(
    query: LyricsSearchQuery,
    key: string,
  ): Promise<Result<LyricsResult, AppError>> {
    try {
      this.logger.info(`Fetching lyrics from LRCLIB for [${query.videoId}] "${query.trackTitle}"...`);
      const result = await this.provider.fetchLyrics(query);

      if (result && (result.syncType !== 'NONE' || result.plainText || result.instrumental)) {
        // Positive caching: 7 days fresh, 14 days stale
        await this.cacheManager.put<LyricsResult>(key, 'lyrics', result, {
          scope: 'guest',
          ttl: {
            freshTtlMs: SEVEN_DAYS_MS,
            staleTtlMs: FOURTEEN_DAYS_MS,
            persistToSql: true,
          },
        });
        return ok(result);
      }

      // Negative caching: lyrics not found or empty
      const negativeResult: LyricsResult = {
        videoId: query.videoId,
        source: 'LRCLIB',
        syncType: 'NONE',
        syncedLines: [],
        plainText: null,
        instrumental: false,
      };

      // Cache empty result for 1 hour to prevent hammering LRCLIB
      await this.cacheManager.put<LyricsResult>(key, 'lyrics', negativeResult, {
        scope: 'guest',
        ttl: {
          freshTtlMs: ONE_HOUR_MS,
          staleTtlMs: TWO_HOURS_MS,
          persistToSql: true,
        },
      });

      return ok(negativeResult);
    } catch (caught) {
      this.logger.error(`Failed to fetch lyrics for "${query.videoId}": ${String(caught)}`);
      return err(
        new NetworkError(
          `Failed to fetch lyrics: ${caught instanceof Error ? caught.message : String(caught)}`,
        ),
      );
    }
  }
}
