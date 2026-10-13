/**
 * Cache-aware repository layer over InnertubeClient and StreamResolver.
 * Callers interact solely with this repository instead of calling InnerTube directly.
 * All cache keys are built strictly from real validated IDs and parameters.
 */

import {
  err,
  type Result,
  type AppError,
  StreamError,
  ParseError,
} from '@/backend/core';
import {
  type InnertubeClient,
  type SearchOptions,
  type SearchResponse,
  type HomeFeedResponse,
  type AlbumDetailResponse,
  type ArtistDetailResponse,
  type PlaylistDetailResponse,
  type NextQueueResponse,
  type SearchSuggestionsResponse,
  type EndpointOptions,
  type NextOptions,
  isValidTrackId,
  isValidArtistId,
  isValidAlbumId,
  isValidPlaylistId,
} from '@/backend/innertube';
import {
  type StreamResolver,
  type ResolvedStream,
  type ResolveOptions,
} from '@/backend/streaming';
import {
  type CacheManager,
  type GetOrFetchOptions,
  type CacheStats,
  CacheKeyBuilder,
} from '@/backend/cache';
import type { AuthService } from '@/backend/auth';

export interface RepositoryOptions {
  innertube: InnertubeClient;
  streamResolver: StreamResolver;
  cache: CacheManager;
  authService?: AuthService;
}

export class MusicRepository {
  private readonly innertube: InnertubeClient;
  private readonly streamResolver: StreamResolver;
  private readonly cache: CacheManager;
  private readonly authService?: AuthService;

  constructor(options: RepositoryOptions) {
    this.innertube = options.innertube;
    this.streamResolver = options.streamResolver;
    this.cache = options.cache;
    this.authService = options.authService;
  }

  private async resolveScope(explicitScope?: string): Promise<string> {
    if (explicitScope) return explicitScope;
    if (this.authService) {
      const sessionRes = await this.authService.getSession();
      if (sessionRes.ok && sessionRes.value) {
        return `user:${sessionRes.value.accountId}`;
      }
    }
    return 'guest';
  }

  /**
   * Home feed with stale-while-revalidate caching.
   */
  async getHome(
    options: EndpointOptions & GetOrFetchOptions = {},
  ): Promise<Result<HomeFeedResponse, AppError>> {
    const scope = await this.resolveScope(options.scope);
    const key = CacheKeyBuilder.home(scope);
    return this.cache.getOrFetch(
      key,
      'home',
      () => this.innertube.getHome(options),
      { ...options, scope },
    );
  }

  /**
   * Observe home feed updates (receives background revalidation updates).
   */
  observeHome(
    callback: (feed: HomeFeedResponse) => void,
    scope = 'guest',
  ): () => void {
    const key = CacheKeyBuilder.home(scope);
    return this.cache.subscribe(key, callback);
  }

  /**
   * Search with filter and query caching.
   */
  async search(
    query: string,
    options: SearchOptions & GetOrFetchOptions = {},
  ): Promise<Result<SearchResponse, AppError>> {
    const scope = await this.resolveScope(options.scope);
    const key = CacheKeyBuilder.search(query, options.filter, scope);
    return this.cache.getOrFetch(
      key,
      'search',
      () => this.innertube.search(query, options),
      { ...options, scope },
    );
  }

  /**
   * Album details and tracks with 24h fresh / 7d stale cache.
   * Strictly validates MPREb_... / OLAK5uy_... browseId shape.
   */
  async getAlbum(
    albumId: string,
    options: EndpointOptions & GetOrFetchOptions = {},
  ): Promise<Result<AlbumDetailResponse, AppError>> {
    if (!isValidAlbumId(albumId)) {
      return err(
        new ParseError(`Invalid album ID shape "${albumId}": must start with MPREb_ or OLAK5uy_`, {
          targetType: 'Album',
        }),
      );
    }
    const key = CacheKeyBuilder.album(albumId);
    return this.cache.getOrFetch(
      key,
      'album',
      () => this.innertube.getAlbum(albumId, options),
      options,
    );
  }

  observeAlbum(
    albumId: string,
    callback: (album: AlbumDetailResponse) => void,
  ): () => void {
    return this.cache.subscribe(CacheKeyBuilder.album(albumId), callback);
  }

  /**
   * Artist profile and discography.
   * Strictly validates UC... browseId shape.
   */
  async getArtist(
    artistId: string,
    options: EndpointOptions & GetOrFetchOptions = {},
  ): Promise<Result<ArtistDetailResponse, AppError>> {
    if (!isValidArtistId(artistId)) {
      return err(
        new ParseError(`Invalid artist ID shape "${artistId}": must start with UC`, {
          targetType: 'Artist',
        }),
      );
    }
    const key = CacheKeyBuilder.artist(artistId);
    return this.cache.getOrFetch(
      key,
      'artist',
      () => this.innertube.getArtist(artistId, options),
      options,
    );
  }

  observeArtist(
    artistId: string,
    callback: (artist: ArtistDetailResponse) => void,
  ): () => void {
    return this.cache.subscribe(CacheKeyBuilder.artist(artistId), callback);
  }

  /**
   * Playlist details and tracks.
   * Strictly validates VL... / PL... / RD... playlistId shape.
   */
  async getPlaylist(
    playlistId: string,
    options: EndpointOptions & GetOrFetchOptions = {},
  ): Promise<Result<PlaylistDetailResponse, AppError>> {
    if (!isValidPlaylistId(playlistId)) {
      return err(
        new ParseError(`Invalid playlist ID shape "${playlistId}": must start with VL, PL, or RD`, {
          targetType: 'Playlist',
        }),
      );
    }
    const key = CacheKeyBuilder.playlist(playlistId);
    return this.cache.getOrFetch(
      key,
      'playlist',
      () => this.innertube.getPlaylist(playlistId, options),
      options,
    );
  }

  observePlaylist(
    playlistId: string,
    callback: (playlist: PlaylistDetailResponse) => void,
  ): () => void {
    return this.cache.subscribe(CacheKeyBuilder.playlist(playlistId), callback);
  }

  /**
   * Next (Queue / Radio) for a playing track.
   * Strictly validates 11-char videoId.
   */
  async getNext(
    videoId: string,
    options: NextOptions & GetOrFetchOptions = {},
  ): Promise<Result<NextQueueResponse, AppError>> {
    if (!isValidTrackId(videoId)) {
      return err(
        new ParseError(`Invalid videoId shape "${videoId}": must be 11 characters`, {
          targetType: 'NextQueue',
        }),
      );
    }
    const key = CacheKeyBuilder.next(videoId);
    return this.cache.getOrFetch(
      key,
      'playlist',
      () => this.innertube.getNext(videoId, options),
      options,
    );
  }

  observeNext(
    videoId: string,
    callback: (next: NextQueueResponse) => void,
  ): () => void {
    return this.cache.subscribe(CacheKeyBuilder.next(videoId), callback);
  }

  /**
   * Search suggestions.
   */
  async getSearchSuggestions(
    query: string,
    options: EndpointOptions & GetOrFetchOptions = {},
  ): Promise<Result<SearchSuggestionsResponse, AppError>> {
    const key = CacheKeyBuilder.suggest(query);
    return this.cache.getOrFetch(
      key,
      'suggest',
      () => this.innertube.getSearchSuggestions(query, options),
      options,
    );
  }

  /**
   * Stream resolution with expiry-aware TTL.
   */
  async resolveStream(
    videoId: string,
    options: ResolveOptions & GetOrFetchOptions = {},
  ): Promise<Result<ResolvedStream, StreamError>> {
    if (!isValidTrackId(videoId)) {
      return err(
        new StreamError(
          `Invalid videoId shape "${videoId}": must be 11 characters`,
          videoId,
          'UNAVAILABLE',
        ),
      );
    }

    const key = CacheKeyBuilder.stream(videoId);
    return this.cache.getOrFetch(
      key,
      'stream',
      async () => {
        const res = await this.streamResolver.resolve(videoId, options);
        return res;
      },
      options,
    );
  }

  /**
   * Cache management operations.
   */
  async clearCache(): Promise<void> {
    await this.cache.clear();
  }

  /**
   * Invalidates a cached stream for a given videoId, dropping it from the in-memory tier.
   *
   * Why: YouTube signed stream URLs are bound to the client IP address (`ip=` parameter)
   * and fail with HTTP 403 upon network changes (e.g. Wi-Fi to cellular). Dropping the entry
   * guarantees that the next request will re-resolve fresh playable audio streams.
   */
  async invalidateStream(videoId: string): Promise<void> {
    await this.cache.invalidateStream(videoId);
  }

  /**
   * Clears all user-scoped cached data (for logout or account switch), preserving guest data.
   */
  async clearUserScopedData(): Promise<void> {
    await this.cache.clearUserScopedData();
  }

  /**
   * Clears only the L1 in-memory tier, preserving SQLite persistence.
   */
  clearMemoryTier(): void {
    this.cache.clearMemoryTier();
  }

  async getCacheStats(): Promise<CacheStats> {
    return this.cache.getStats();
  }

  async evict(key: string): Promise<void> {
    await this.cache.evict(key);
  }
}
