/**
 * LibraryService - Unified manager for user playlists, liked songs, playback history,
 * optimistic updates, and offline mutation queue.
 */

import {
  ok,
  err,
  type Result,
  type AppError,
  AuthError,
  createLogger,
  type Logger,
  type Track,
} from '@/backend/core';
import type { SqlDatabase } from '@/backend/platform';
import type { AuthService, AuthSession } from '@/backend/auth';
import type { InnertubeClient } from '@/backend/innertube';
import { CacheKeyBuilder, type CacheManager } from '@/backend/cache';
import { MutationQueue } from './mutation-queue';
import type {
  UserPlaylistsResult,
  LikedSongsResult,
  HistoryResult,
  LibraryFetchOptions,
  LikeStatus,
  OptimisticMutationResult,
  SetLikePayload,
  AddPlaylistTrackPayload,
  RemovePlaylistTrackPayload,
  PendingMutation,
} from './types';

export interface LibraryServiceOptions {
  innertube: InnertubeClient;
  authService: AuthService;
  db: SqlDatabase;
  cache?: CacheManager;
  logger?: Logger;
}

export class LibraryService {
  private readonly innertube: InnertubeClient;
  private readonly authService: AuthService;
  private readonly cache?: CacheManager;
  private readonly mutationQueue: MutationQueue;
  private readonly logger: Logger;

  constructor(options: LibraryServiceOptions) {
    this.innertube = options.innertube;
    this.authService = options.authService;
    this.cache = options.cache;
    this.logger = options.logger ?? createLogger({ prefix: 'LibraryService' });
    this.mutationQueue = new MutationQueue(options.db, this.logger);
  }

  get queue(): MutationQueue {
    return this.mutationQueue;
  }

  /**
   * Defensive auth session checker.
   * Every library method requires an authenticated session.
   */
  private async getRequiredSession(): Promise<Result<AuthSession, AuthError>> {
    const sessionRes = await this.authService.getSession();
    if (!sessionRes.ok) {
      return err(sessionRes.error);
    }
    if (!sessionRes.value) {
      return err(
        new AuthError(
          'Authentication required: user is not signed in',
          'MISSING_SESSION',
        ),
      );
    }
    return ok(sessionRes.value);
  }

  // --- Read Operations ---

  /**
   * Fetches user's playlists (browseId: "FEmusic_liked_playlists").
   */
  async fetchUserPlaylists(
    options: LibraryFetchOptions = {},
  ): Promise<Result<UserPlaylistsResult, AppError>> {
    const sessionRes = await this.getRequiredSession();
    if (!sessionRes.ok) return sessionRes;

    const accountId = sessionRes.value.accountId;
    const cacheKey = CacheKeyBuilder.libraryPlaylists(accountId, options.continuation);
    const scope = `user:${accountId}`;

    // 1. Check Cache
    if (this.cache && !options.forceFresh) {
      const cached = await this.cache.get<UserPlaylistsResult>(cacheKey);
      if (cached.isHit && !cached.isStale && cached.data) {
        this.logger.debug(`[Cache Hit: Fresh] User Playlists for ${accountId}`);
        return ok(cached.data);
      }
    }

    // 2. Fetch Network
    this.logger.debug(`Fetching User Playlists from network for ${accountId}`);
    const netRes = await this.innertube.getUserPlaylists({
      continuation: options.continuation,
      signal: options.signal,
    });

    if (!netRes.ok) {
      // Stale fallback
      if (this.cache) {
        const cached = await this.cache.get<UserPlaylistsResult>(cacheKey);
        if (cached.isHit && cached.data) {
          this.logger.info(`[Cache Fallback] Serving stale user playlists`);
          return ok(cached.data);
        }
      }
      return netRes;
    }

    const result: UserPlaylistsResult = {
      playlists: netRes.value.playlists,
      continuationToken: netRes.value.continuationToken,
    };

    // 3. Write to Cache
    if (this.cache) {
      await this.cache.set(cacheKey, 'library', result, { scope });
    }

    return ok(result);
  }

  /**
   * Fetches user's liked songs (browseId: "FEmusic_liked_videos")
   * Merges local optimistic likes.
   */
  async fetchLikedSongs(
    options: LibraryFetchOptions = {},
  ): Promise<Result<LikedSongsResult, AppError>> {
    const sessionRes = await this.getRequiredSession();
    if (!sessionRes.ok) return sessionRes;

    const accountId = sessionRes.value.accountId;
    const cacheKey = CacheKeyBuilder.libraryLikedSongs(accountId, options.continuation);
    const scope = `user:${accountId}`;

    const applyOptimisticLikes = async (rawTracks: Track[]): Promise<Track[]> => {
      const optimisticLikesRes = await this.mutationQueue.getAllOptimisticLikes(accountId);
      if (!optimisticLikesRes.ok) return rawTracks;
      const optimisticMap = optimisticLikesRes.value;

      // Filter out any track optimistically unliked / disliked
      return rawTracks.filter((track) => {
        const status = optimisticMap.get(track.id);
        if (status === 'DISLIKE' || status === 'INDIFFERENT') {
          return false;
        }
        return true;
      });
    };

    // 1. Check Cache
    if (this.cache && !options.forceFresh) {
      const cached = await this.cache.get<LikedSongsResult>(cacheKey);
      if (cached.isHit && !cached.isStale && cached.data) {
        this.logger.debug(`[Cache Hit: Fresh] Liked Songs for ${accountId}`);
        const mergedTracks = await applyOptimisticLikes(cached.data.tracks);
        return ok({
          ...cached.data,
          tracks: mergedTracks,
        });
      }
    }

    // 2. Fetch Network
    this.logger.debug(`Fetching Liked Songs from network for ${accountId}`);
    const netRes = await this.innertube.getLikedSongs({
      continuation: options.continuation,
      signal: options.signal,
    });

    if (!netRes.ok) {
      // Stale fallback
      if (this.cache) {
        const cached = await this.cache.get<LikedSongsResult>(cacheKey);
        if (cached.isHit && cached.data) {
          this.logger.info(`[Cache Fallback] Serving stale liked songs`);
          const mergedTracks = await applyOptimisticLikes(cached.data.tracks);
          return ok({
            ...cached.data,
            tracks: mergedTracks,
          });
        }
      }
      return netRes;
    }

    const mergedTracks = await applyOptimisticLikes(netRes.value.tracks);
    const result: LikedSongsResult = {
      tracks: mergedTracks,
      totalCount: netRes.value.totalCount,
      continuationToken: netRes.value.continuationToken,
    };

    // 3. Write to Cache
    if (this.cache) {
      await this.cache.set(cacheKey, 'library', result, { scope });
    }

    return ok(result);
  }

  /**
   * Fetches user's playback history (browseId: "FEmusic_history").
   */
  async fetchHistory(
    options: LibraryFetchOptions = {},
  ): Promise<Result<HistoryResult, AppError>> {
    const sessionRes = await this.getRequiredSession();
    if (!sessionRes.ok) return sessionRes;

    const accountId = sessionRes.value.accountId;
    const cacheKey = CacheKeyBuilder.libraryHistory(accountId, options.continuation);
    const scope = `user:${accountId}`;

    // 1. Check Cache
    if (this.cache && !options.forceFresh) {
      const cached = await this.cache.get<HistoryResult>(cacheKey);
      if (cached.isHit && !cached.isStale && cached.data) {
        this.logger.debug(`[Cache Hit: Fresh] History for ${accountId}`);
        return ok(cached.data);
      }
    }

    // 2. Fetch Network
    this.logger.debug(`Fetching History from network for ${accountId}`);
    const netRes = await this.innertube.getHistory({
      continuation: options.continuation,
      signal: options.signal,
    });

    if (!netRes.ok) {
      if (this.cache) {
        const cached = await this.cache.get<HistoryResult>(cacheKey);
        if (cached.isHit && cached.data) {
          this.logger.info(`[Cache Fallback] Serving stale history`);
          return ok(cached.data);
        }
      }
      return netRes;
    }

    const result: HistoryResult = {
      items: netRes.value.items,
      continuationToken: netRes.value.continuationToken,
    };

    // 3. Write to Cache
    if (this.cache) {
      await this.cache.set(cacheKey, 'library', result, { scope });
    }

    return ok(result);
  }

  // --- Optimistic Mutations & Offline Queue ---

  /**
   * Sets liked status on a video: 'LIKE' | 'DISLIKE' | 'INDIFFERENT'
   * Persists optimistically in SQLite, enqueues in offline queue, and drains via network.
   */
  async setLiked(
    videoId: string,
    status: LikeStatus,
  ): Promise<Result<OptimisticMutationResult, AppError>> {
    const sessionRes = await this.getRequiredSession();
    if (!sessionRes.ok) return sessionRes;

    const accountId = sessionRes.value.accountId;
    const prevStatusRes = await this.mutationQueue.getOptimisticLike(accountId, videoId);
    const previousStatus = prevStatusRes.ok ? (prevStatusRes.value ?? 'INDIFFERENT') : 'INDIFFERENT';

    // 1. Persist optimistic like state in SQLite
    await this.mutationQueue.setOptimisticLike(accountId, videoId, status);

    // 2. Enqueue mutation
    const enqueueRes = await this.mutationQueue.enqueue(accountId, 'SET_LIKE', {
      videoId,
      status,
      previousStatus,
    } satisfies SetLikePayload);

    if (!enqueueRes.ok) {
      return enqueueRes;
    }

    const mutation = enqueueRes.value;

    // 3. Update memory/cache optimistically if cached liked songs exists
    if (this.cache) {
      const cacheKey = CacheKeyBuilder.libraryLikedSongs(accountId);
      const cached = await this.cache.get<LikedSongsResult>(cacheKey);
      if (cached.isHit && cached.data) {
        let updatedTracks = [...cached.data.tracks];
        if (status === 'DISLIKE' || status === 'INDIFFERENT') {
          updatedTracks = updatedTracks.filter((t) => t.id !== videoId);
        }
        await this.cache.set(
          cacheKey,
          'library',
          { ...cached.data, tracks: updatedTracks },
          { scope: `user:${accountId}` },
        );
      }
    }

    // 4. Attempt immediate network execution
    let netRes: Result<unknown, AppError>;
    if (status === 'LIKE') {
      netRes = await this.innertube.like(videoId);
    } else if (status === 'DISLIKE') {
      netRes = await this.innertube.dislike(videoId);
    } else {
      netRes = await this.innertube.removelike(videoId);
    }

    if (netRes.ok) {
      await this.mutationQueue.remove(mutation.id);
      this.logger.debug(`Like mutation executed successfully on network: [${mutation.id}]`);
      return ok({ success: true, queued: false, mutationId: mutation.id });
    }

    // If fatal rejection (e.g. 400 Bad Request or 404), rollback optimistic state
    if (this.isFatalRejection(netRes.error)) {
      this.logger.warn(`Fatal rejection for mutation [${mutation.id}], rolling back: ${netRes.error.message}`);
      await this.mutationQueue.setOptimisticLike(accountId, videoId, previousStatus);
      await this.mutationQueue.markFailed(mutation.id, netRes.error.message, mutation.retryCount);
      return netRes;
    }

    // Transient failure (network/offline): keep in offline queue for background drain
    this.logger.info(`Mutation [${mutation.id}] preserved in offline queue (transient error)`);
    return ok({ success: true, queued: true, mutationId: mutation.id });
  }

  /**
   * Adds track to user playlist.
   */
  async addTrackToPlaylist(
    playlistId: string,
    videoId: string,
  ): Promise<Result<OptimisticMutationResult, AppError>> {
    const sessionRes = await this.getRequiredSession();
    if (!sessionRes.ok) return sessionRes;

    const accountId = sessionRes.value.accountId;

    // 1. Enqueue mutation
    const enqueueRes = await this.mutationQueue.enqueue(accountId, 'ADD_PLAYLIST_TRACK', {
      playlistId,
      videoId,
    } satisfies AddPlaylistTrackPayload);

    if (!enqueueRes.ok) return enqueueRes;
    const mutation = enqueueRes.value;

    // 2. Execute on network
    const netRes = await this.innertube.editPlaylist(playlistId, [
      { action: 'ACTION_ADD_VIDEO', addedVideoId: videoId },
    ]);

    if (netRes.ok) {
      await this.mutationQueue.remove(mutation.id);
      return ok({ success: true, queued: false, mutationId: mutation.id });
    }

    if (this.isFatalRejection(netRes.error)) {
      await this.mutationQueue.markFailed(mutation.id, netRes.error.message, mutation.retryCount);
      return netRes;
    }

    return ok({ success: true, queued: true, mutationId: mutation.id });
  }

  /**
   * Removes track from user playlist.
   */
  async removeTrackToPlaylist(
    playlistId: string,
    videoId: string,
    setVideoId?: string,
  ): Promise<Result<OptimisticMutationResult, AppError>> {
    return this.removeTrackFromPlaylist(playlistId, videoId, setVideoId);
  }

  async removeTrackFromPlaylist(
    playlistId: string,
    videoId: string,
    setVideoId?: string,
  ): Promise<Result<OptimisticMutationResult, AppError>> {
    const sessionRes = await this.getRequiredSession();
    if (!sessionRes.ok) return sessionRes;

    const accountId = sessionRes.value.accountId;

    const enqueueRes = await this.mutationQueue.enqueue(accountId, 'REMOVE_PLAYLIST_TRACK', {
      playlistId,
      videoId,
      setVideoId,
    } satisfies RemovePlaylistTrackPayload);

    if (!enqueueRes.ok) return enqueueRes;
    const mutation = enqueueRes.value;

    const action = setVideoId
      ? { action: 'ACTION_REMOVE_VIDEO_BY_POST_ID', setVideoId }
      : { action: 'ACTION_REMOVE_VIDEO', removedVideoId: videoId };

    const netRes = await this.innertube.editPlaylist(playlistId, [action]);

    if (netRes.ok) {
      await this.mutationQueue.remove(mutation.id);
      return ok({ success: true, queued: false, mutationId: mutation.id });
    }

    if (this.isFatalRejection(netRes.error)) {
      await this.mutationQueue.markFailed(mutation.id, netRes.error.message, mutation.retryCount);
      return netRes;
    }

    return ok({ success: true, queued: true, mutationId: mutation.id });
  }

  /**
   * Drains the offline mutation queue for the current authenticated user.
   * Processes mutations in strict FIFO order; stops on first transient error to preserve ordering.
   */
  async drainQueue(): Promise<Result<{ processed: number; remaining: number }, AppError>> {
    const sessionRes = await this.getRequiredSession();
    if (!sessionRes.ok) return sessionRes;

    const accountId = sessionRes.value.accountId;
    const pendingRes = await this.mutationQueue.getPending(accountId);
    if (!pendingRes.ok) return pendingRes;

    const mutations = pendingRes.value;
    let processed = 0;

    for (const mutation of mutations) {
      await this.mutationQueue.markInFlight(mutation.id);

      const success = await this.executeMutation(mutation);
      if (success) {
        await this.mutationQueue.remove(mutation.id);
        processed++;
      } else {
        // Stop draining to maintain FIFO integrity when offline / connection fails
        await this.mutationQueue.revertToPending(mutation.id, mutation.retryCount);
        break;
      }
    }

    const remainingRes = await this.mutationQueue.getPending(accountId);
    const remaining = remainingRes.ok ? remainingRes.value.length : 0;

    return ok({ processed, remaining });
  }

  private async executeMutation(mutation: PendingMutation): Promise<boolean> {
    try {
      const payload = JSON.parse(mutation.payload) as Record<string, unknown>;

      if (mutation.type === 'SET_LIKE') {
        const { videoId, status } = payload as unknown as SetLikePayload;
        let res: Result<unknown, AppError>;
        if (status === 'LIKE') {
          res = await this.innertube.like(videoId);
        } else if (status === 'DISLIKE') {
          res = await this.innertube.dislike(videoId);
        } else {
          res = await this.innertube.removelike(videoId);
        }
        return res.ok;
      }

      if (mutation.type === 'ADD_PLAYLIST_TRACK') {
        const { playlistId, videoId } = payload as unknown as AddPlaylistTrackPayload;
        const res = await this.innertube.editPlaylist(playlistId, [
          { action: 'ACTION_ADD_VIDEO', addedVideoId: videoId },
        ]);
        return res.ok;
      }

      if (mutation.type === 'REMOVE_PLAYLIST_TRACK') {
        const { playlistId, videoId, setVideoId } = payload as unknown as RemovePlaylistTrackPayload;
        const action = setVideoId
          ? { action: 'ACTION_REMOVE_VIDEO_BY_POST_ID', setVideoId }
          : { action: 'ACTION_REMOVE_VIDEO', removedVideoId: videoId };
        const res = await this.innertube.editPlaylist(playlistId, [action]);
        return res.ok;
      }

      return false;
    } catch {
      return false;
    }
  }

  private isFatalRejection(err: AppError): boolean {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 500 && statusCode !== 408) {
      return true;
    }
    return false;
  }

  /**
   * Purges user library tables (pending mutations and optimistic likes) from SQLite.
   * Called during logout to prevent data leaking across accounts.
   */
  async clearUserData(accountId?: string): Promise<void> {
    if (accountId) {
      await this.mutationQueue.clearForAccount(accountId);
    } else {
      await this.mutationQueue.clearAll();
    }
    this.logger.info('Cleared user library SQLite tables on logout', { accountId });
  }
}
