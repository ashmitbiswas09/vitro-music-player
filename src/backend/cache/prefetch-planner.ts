/**
 * Prefetch planner for track playback queue.
 * Proactively prefetches stream URLs for the next 1-2 tracks and re-resolves
 * streams approaching expiration before playback is interrupted.
 */

import {
  isOk,
  type Result,
  type Clock,
  SystemClock,
  logger,
  type Track,
} from '@/backend/core';
import type { CacheManager } from './swr-cache-manager';
import { CacheKeyBuilder } from './types';

export interface StreamResolutionTarget {
  stream: {
    url: string;
    expiresAt: number;
  };
}

export interface StreamResolverLike {
  resolve(
    videoId: string,
    options?: unknown,
  ): Promise<Result<StreamResolutionTarget, { message: string }>>;
}

export interface PrefetchOptions {
  /** How many upcoming tracks to prefetch (default: 2, max: 5) */
  prefetchCount?: number;
  /** Re-resolve if stream expires within this window in ms (default: 5 minutes) */
  reResolveThresholdMs?: number;
}

export interface PrefetchPlanResult {
  prefetched: string[];
  alreadyFresh: string[];
  failed: { videoId: string; error: string }[];
}

export class PrefetchPlanner {
  private readonly clock: Clock;

  constructor(
    private readonly cacheManager: CacheManager,
    private readonly streamResolver: StreamResolverLike,
    clock?: Clock,
  ) {
    this.clock = clock ?? new SystemClock();
  }

  /**
   * Plans and executes prefetching for the next 1-2 tracks in the playback queue.
   */
  async planQueuePrefetch(
    queue: (Track | string)[],
    currentIndex: number,
    options: PrefetchOptions = {},
  ): Promise<PrefetchPlanResult> {
    const prefetchCount = Math.min(Math.max(options.prefetchCount ?? 2, 1), 5);
    const thresholdMs = options.reResolveThresholdMs ?? 5 * 60 * 1000; // 5 minutes
    const now = this.clock.now();

    const result: PrefetchPlanResult = {
      prefetched: [],
      alreadyFresh: [],
      failed: [],
    };

    const targetIndices: number[] = [];
    for (let i = 1; i <= prefetchCount; i++) {
      const idx = currentIndex + i;
      if (idx < queue.length) {
        targetIndices.push(idx);
      }
    }

    for (const idx of targetIndices) {
      const item = queue[idx];
      const videoId = typeof item === 'string' ? item : item.id;

      if (!videoId || videoId.length !== 11) {
        continue;
      }

      const cacheKey = CacheKeyBuilder.stream(videoId);
      const cached = await this.cacheManager.get<StreamResolutionTarget>(cacheKey);

      let needsResolution = false;

      if (cached.status === 'miss' || !cached.data) {
        needsResolution = true;
      } else {
        const stream = cached.data.stream;
        // Check if stream URL is expiring soon
        const remainingLifetimeMs = stream.expiresAt - now;
        if (remainingLifetimeMs <= thresholdMs) {
          needsResolution = true;
          logger.debug(`[PrefetchPlanner] Stream ${videoId} expiring in ${Math.round(remainingLifetimeMs / 1000)}s - re-resolving`);
        } else {
          result.alreadyFresh.push(videoId);
        }
      }

      if (needsResolution) {
        try {
          const res = await this.streamResolver.resolve(videoId);
          if (isOk(res)) {
            await this.cacheManager.put(
              cacheKey,
              'stream',
              res.value,
              { expiresAt: res.value.stream.expiresAt },
            );
            result.prefetched.push(videoId);
            logger.debug(`[PrefetchPlanner] Prefetched stream for ${videoId}`);
          } else {
            result.failed.push({ videoId, error: res.error.message });
          }
        } catch (err) {
          result.failed.push({ videoId, error: String(err) });
        }
      }
    }

    return result;
  }

  /**
   * Convenience helper to prefetch upcoming tracks and return the list of prefetched videoIds.
   */
  async prefetchForQueue(
    queue: (Track | string)[],
    currentIndex: number,
    count = 2,
  ): Promise<string[]> {
    const result = await this.planQueuePrefetch(queue, currentIndex, { prefetchCount: count });
    return result.prefetched;
  }

  /**
   * Convenience helper to prefetch a single track by videoId.
   */
  async prefetchTrack(videoId: string): Promise<boolean> {
    const result = await this.planQueuePrefetch([videoId], -1, { prefetchCount: 1 });
    return result.prefetched.includes(videoId) || result.alreadyFresh.includes(videoId);
  }

  /**
   * Re-resolves a stream if it is close to expiring.
   */
  async reResolveIfExpiring(
    videoId: string,
    thresholdMs = 5 * 60 * 1000,
  ): Promise<boolean> {
    return this.checkAndReResolveExpiring(videoId, thresholdMs);
  }

  /**
   * Checks if an individual track's cached stream is expiring and re-resolves if necessary.
   */
  async checkAndReResolveExpiring(
    videoId: string,
    thresholdMs = 5 * 60 * 1000,
  ): Promise<boolean> {
    const cacheKey = CacheKeyBuilder.stream(videoId);
    const cached = await this.cacheManager.get<StreamResolutionTarget>(cacheKey);

    if (!cached.data) return false;

    const remainingLifetimeMs = cached.data.stream.expiresAt - this.clock.now();
    if (remainingLifetimeMs <= thresholdMs) {
      const res = await this.streamResolver.resolve(videoId);
      if (isOk(res)) {
        await this.cacheManager.put(
          cacheKey,
          'stream',
          res.value,
          { expiresAt: res.value.stream.expiresAt },
        );
        return true;
      }
    }

    return false;
  }
}

