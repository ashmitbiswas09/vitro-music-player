/**
 * Innertube client for interacting with YouTube Music endpoints.
 */

import {
  type Result,
  AppError,
  NetworkError,
  type InnertubeClientConfig,
  type Logger,
  DEFAULT_INNERTUBE_CONFIG,
  createLogger,
  retryAsync,
  isRetryableError,
  AuthError,
} from '@/backend/core';
import { z } from 'zod';
import type { HttpClient } from '@/backend/platform';
import type {
  SearchFilter,
  SearchOptions,
  SearchResponse,
  SearchSuggestionsResponse,
  HomeFeedResponse,
  AlbumDetailResponse,
  ArtistDetailResponse,
  PlaylistDetailResponse,
  NextQueueResponse,
  NextOptions,
  ContinuationResponse,
  EndpointOptions,
  InnertubeClientOptions,
  AccountProfile,
} from './types';
import type { AuthSession, AuthService } from '@/backend/auth';
import { ContextBuilder } from './context/context-builder';
import { VisitorDataManager } from './visitor/visitor-data-manager';
import { parseSearchResponse } from './parsers/search-parser';
import { parseSuggestionsResponse } from './parsers/suggestions-parser';
import { parseHomeResponse } from './parsers/home-parser';
import { parseAlbumResponse } from './parsers/album-parser';
import { parseArtistResponse } from './parsers/artist-parser';
import { parsePlaylistResponse } from './parsers/playlist-parser';
import { parseNextResponse } from './parsers/next-parser';
import { parseContinuationResponse } from './parsers/continuation-parser';
import {
  parseUserPlaylistsResponse,
  parseLikedSongsResponse,
  parseHistoryResponse,
  type UserPlaylistsResponse,
  type LikedSongsResponse,
  type HistoryResponse,
} from './parsers/library-parser';

// Publicly verified parameter tokens for YouTube Music category filtering
const SEARCH_FILTER_PARAMS: Record<SearchFilter, string | undefined> = {
  all: undefined,
  songs: 'EgWKAQIIAWoKEAkQChAKEAUQEQ%3D%3D',
  albums: 'EgWKAQIBAWoKEAkQChAKEAUQEQ%3D%3D',
  artists: 'EgWKAQIgAWoKEAkQChAKEAUQEQ%3D%3D',
  playlists: 'EgWKAQIoAWoKEAkQChAKEAUQEQ%3D%3D',
  videos: 'EgWKAQIQAWoKEAkQChAKEAUQEQ%3D%3D',
};

function findActiveAccountHeader(value: unknown): unknown {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findActiveAccountHeader(item);
      if (found !== undefined) return found;
    }
  } else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('activeAccountHeaderRenderer' in record) return record.activeAccountHeaderRenderer;
    for (const item of Object.values(record)) {
      const found = findActiveAccountHeader(item);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

export class InnertubeClient {
  private readonly httpClient: HttpClient;
  private readonly config: InnertubeClientConfig;
  private readonly contextBuilder: ContextBuilder;
  private readonly visitorManager: VisitorDataManager;
  private readonly logger: Logger;
  private authService?: AuthService;
  private authSession?: AuthSession | null;

  constructor(options: InnertubeClientOptions) {
    this.httpClient = options.httpClient;
    this.config = {
      ...DEFAULT_INNERTUBE_CONFIG,
      ...options.config,
    };
    this.contextBuilder = new ContextBuilder(this.config);
    this.visitorManager = new VisitorDataManager({
      keyValueStore: options.keyValueStore,
      override: options.visitorDataOverride,
      httpClient: this.httpClient,
      config: this.config,
    });
    this.logger = options.logger ?? createLogger({ prefix: 'Innertube' });
    this.authService = options.authService;
    this.authSession = options.authSession;
  }

  setAuthService(authService?: AuthService): void {
    this.authService = authService;
  }

  setAuthSession(session?: AuthSession | null): void {
    this.authSession = session;
  }

  async getVisitorData(): Promise<string | undefined> {
    return this.visitorManager.getVisitorData();
  }

  async setVisitorData(visitorData: string): Promise<void> {
    return this.visitorManager.setVisitorData(visitorData);
  }

  async resetVisitorData(): Promise<void> {
    await this.visitorManager.resetVisitorData();
  }

  async fetchAccountProfile(): Promise<Result<AccountProfile, AppError>> {
    if (!this.authService) {
      return { ok: false, error: new AuthError('No active authentication session', 'MISSING_SESSION') };
    }
    const authHeaders = await this.authService.getAuthHeaders(this.config.origin);
    if (!authHeaders.ok) return authHeaders;

    const raw = await this.postEndpoint('account/account_menu', {}, {});
    if (!raw.ok) return raw;
    const renderer = findActiveAccountHeader(raw.value);
    const profileSchema = z.object({
      accountName: z.union([z.string(), z.object({ simpleText: z.string().optional(), runs: z.object({ text: z.string() }).array().optional() })]).optional(),
      channelHandle: z.union([z.string(), z.object({ simpleText: z.string().optional(), runs: z.object({ text: z.string() }).array().optional() })]).optional(),
      accountPhoto: z.object({ thumbnails: z.array(z.object({ url: z.string().url() })) }).optional(),
    });
    const parsed = profileSchema.safeParse(renderer);
    if (!parsed.success) {
      return { ok: false, error: new AppError('Invalid account profile response', 'PARSE_ERROR') };
    }
    const textValue = (value: unknown): string | undefined => {
      if (typeof value === 'string') return value;
      if (!value || typeof value !== 'object') return undefined;
      const item = value as { simpleText?: string; runs?: { text: string }[] };
      return item.simpleText ?? item.runs?.map((run) => run.text).join('');
    };
    const name = textValue(parsed.data.accountName)?.trim();
    if (!name) return { ok: false, error: new AppError('Account profile name is missing', 'PARSE_ERROR') };
    return {
      ok: true,
      value: {
        name,
        handle: textValue(parsed.data.channelHandle)?.trim() || undefined,
        avatarUrl: parsed.data.accountPhoto?.thumbnails.at(-1)?.url,
      },
    };
  }

  private async postEndpoint(
    endpointPath: string,
    bodyParams: Record<string, unknown>,
    options: EndpointOptions = {},
  ): Promise<Result<unknown, AppError>> {
    const visitorData = options.visitorData ?? (await this.visitorManager.getVisitorData());
    const body = this.contextBuilder.buildBody(bodyParams, visitorData);
    let headers = this.contextBuilder.buildHeaders(visitorData);

    // Attach authentication credentials if active
    if (options.authSession) {
      headers = {
        ...headers,
        Cookie: options.authSession.cookieHeader,
        'X-Origin': this.config.origin,
        'X-Goog-AuthUser': '0',
      };
    } else if (this.authService) {
      const authHeadersRes = await this.authService.getAuthHeaders(this.config.origin);
      if (authHeadersRes.ok) {
        headers = { ...headers, ...authHeadersRes.value };
      }
    } else if (this.authSession) {
      headers = {
        ...headers,
        Cookie: this.authSession.cookieHeader,
        'X-Origin': this.config.origin,
        'X-Goog-AuthUser': '0',
      };
    }

    const url = `${this.config.baseUrl}/${endpointPath}`;

    const fetchRes = await retryAsync(
      async () => {
        const res = await this.httpClient.post<unknown>(url, body, {
          headers,
          signal: options.signal,
          timeoutMs: this.config.requestTimeoutMs,
        });
        if (!res.ok && isRetryableError(res.error)) {
          throw res.error;
        }
        return res;
      },
      {
        maxAttempts: this.config.maxRetryAttempts,
        initialDelayMs: this.config.retryInitialDelayMs,
      },
    ).catch((err: unknown) => {
      if (err instanceof AppError) {
        return { ok: false as const, error: err };
      }
      return {
        ok: false as const,
        error: new NetworkError(err instanceof Error ? err.message : String(err), { cause: err }),
      };
    });

    if (!fetchRes.ok) {
      return fetchRes;
    }

    await this.visitorManager.updateFromResponse(fetchRes.value.data);
    return fetchRes.value.data ? { ok: true, value: fetchRes.value.data } : fetchRes;
  }

  // 1. Search
  async getRawSearch(
    query: string,
    options: SearchOptions = {},
  ): Promise<Result<unknown, AppError>> {
    const filter = options.filter ?? 'all';
    const filterParam = SEARCH_FILTER_PARAMS[filter];

    const bodyParams: Record<string, unknown> = { query };
    if (filterParam) {
      bodyParams.params = filterParam;
    }
    if (options.continuationToken) {
      bodyParams.continuation = options.continuationToken;
    }

    this.logger.debug(`Fetching search for query: "${query}"`, { filter });
    return this.postEndpoint('search', bodyParams, options);
  }

  async search(
    query: string,
    options: SearchOptions = {},
  ): Promise<Result<SearchResponse, AppError>> {
    const rawRes = await this.getRawSearch(query, options);
    if (!rawRes.ok) {
      return rawRes;
    }

    const filter = options.filter ?? 'all';
    return parseSearchResponse(rawRes.value, query, filter);
  }

  // 2. Search Suggestions
  async getRawSearchSuggestions(
    query: string,
    options: EndpointOptions = {},
  ): Promise<Result<unknown, AppError>> {
    this.logger.debug(`Fetching suggestions for: "${query}"`);
    return this.postEndpoint('music/get_search_suggestions', { input: query }, options);
  }

  async getSearchSuggestions(
    query: string,
    options: EndpointOptions = {},
  ): Promise<Result<SearchSuggestionsResponse, AppError>> {
    const rawRes = await this.getRawSearchSuggestions(query, options);
    if (!rawRes.ok) {
      return rawRes;
    }
    return parseSuggestionsResponse(rawRes.value, query);
  }

  // 3. Home Feed
  async getRawHome(options: EndpointOptions = {}): Promise<Result<unknown, AppError>> {
    this.logger.debug('Fetching Home browse feed');
    return this.postEndpoint('browse', { browseId: 'FEmusic_home' }, options);
  }

  async getHome(options: EndpointOptions = {}): Promise<Result<HomeFeedResponse, AppError>> {
    const rawRes = await this.getRawHome(options);
    if (!rawRes.ok) {
      return rawRes;
    }
    return parseHomeResponse(rawRes.value);
  }

  // 4. Album
  async getRawAlbum(
    browseId: string,
    options: EndpointOptions = {},
  ): Promise<Result<unknown, AppError>> {
    this.logger.debug(`Fetching Album: "${browseId}"`);
    return this.postEndpoint('browse', { browseId }, options);
  }

  async getAlbum(
    browseId: string,
    options: EndpointOptions = {},
  ): Promise<Result<AlbumDetailResponse, AppError>> {
    const rawRes = await this.getRawAlbum(browseId, options);
    if (!rawRes.ok) {
      return rawRes;
    }
    return parseAlbumResponse(rawRes.value, browseId);
  }

  // 5. Artist
  async getRawArtist(
    browseId: string,
    options: EndpointOptions = {},
  ): Promise<Result<unknown, AppError>> {
    this.logger.debug(`Fetching Artist: "${browseId}"`);
    return this.postEndpoint('browse', { browseId }, options);
  }

  async getArtist(
    browseId: string,
    options: EndpointOptions = {},
  ): Promise<Result<ArtistDetailResponse, AppError>> {
    const rawRes = await this.getRawArtist(browseId, options);
    if (!rawRes.ok) {
      return rawRes;
    }
    return parseArtistResponse(rawRes.value, browseId);
  }

  // 6. Playlist
  async getRawPlaylist(
    playlistId: string,
    options: EndpointOptions = {},
  ): Promise<Result<unknown, AppError>> {
    const browseId = playlistId.startsWith('VL') ? playlistId : `VL${playlistId}`;
    this.logger.debug(`Fetching Playlist: "${browseId}"`);
    return this.postEndpoint('browse', { browseId }, options);
  }

  async getPlaylist(
    playlistId: string,
    options: EndpointOptions = {},
  ): Promise<Result<PlaylistDetailResponse, AppError>> {
    const rawRes = await this.getRawPlaylist(playlistId, options);
    if (!rawRes.ok) {
      return rawRes;
    }
    return parsePlaylistResponse(rawRes.value, playlistId);
  }

  // 7. Next (Queue / Radio)
  async getRawNext(
    videoId: string,
    options: NextOptions = {},
  ): Promise<Result<unknown, AppError>> {
    const bodyParams: Record<string, unknown> = { videoId };
    if (options.playlistId) {
      bodyParams.playlistId = options.playlistId;
    }
    if (options.continuationToken) {
      bodyParams.continuation = options.continuationToken;
    }

    this.logger.debug(`Fetching Next for videoId: "${videoId}"`);
    return this.postEndpoint('next', bodyParams, options);
  }

  async getNext(
    videoId: string,
    options: NextOptions = {},
  ): Promise<Result<NextQueueResponse, AppError>> {
    const rawRes = await this.getRawNext(videoId, options);
    if (!rawRes.ok) {
      return rawRes;
    }
    return parseNextResponse(rawRes.value, videoId);
  }

  // 8. Continuation
  async getRawContinuation(
    continuationToken: string,
    options: EndpointOptions = {},
  ): Promise<Result<unknown, AppError>> {
    this.logger.debug('Fetching Continuation');
    return this.postEndpoint('browse', { continuation: continuationToken }, options);
  }

  async getContinuation(
    continuationToken: string,
    options: EndpointOptions = {},
  ): Promise<Result<ContinuationResponse, AppError>> {
    const rawRes = await this.getRawContinuation(continuationToken, options);
    if (!rawRes.ok) {
      return rawRes;
    }
    return parseContinuationResponse(rawRes.value);
  }

  // 9. Generic Browse
  async getRawBrowse(
    browseId: string,
    options: EndpointOptions & { continuation?: string } = {},
  ): Promise<Result<unknown, AppError>> {
    this.logger.debug(`Fetching Browse: "${browseId}"`);
    const body: Record<string, unknown> = options.continuation
      ? { continuation: options.continuation }
      : { browseId };
    return this.postEndpoint('browse', body, options);
  }

  // 10. User Playlists
  async getUserPlaylists(
    options: EndpointOptions & { continuation?: string } = {},
  ): Promise<Result<UserPlaylistsResponse, AppError>> {
    const rawRes = await this.getRawBrowse('FEmusic_liked_playlists', options);
    if (!rawRes.ok) {
      return rawRes;
    }
    return parseUserPlaylistsResponse(rawRes.value);
  }

  // 11. Liked Songs
  async getLikedSongs(
    options: EndpointOptions & { continuation?: string } = {},
  ): Promise<Result<LikedSongsResponse, AppError>> {
    const rawRes = await this.getRawBrowse('FEmusic_liked_videos', options);
    if (!rawRes.ok) {
      return rawRes;
    }
    return parseLikedSongsResponse(rawRes.value);
  }

  // 12. History
  async getHistory(
    options: EndpointOptions & { continuation?: string } = {},
  ): Promise<Result<HistoryResponse, AppError>> {
    const rawRes = await this.getRawBrowse('FEmusic_history', options);
    if (!rawRes.ok) {
      return rawRes;
    }
    return parseHistoryResponse(rawRes.value);
  }

  // 13. Like / Dislike / Indifferent mutations
  async like(videoId: string, options: EndpointOptions = {}): Promise<Result<unknown, AppError>> {
    this.logger.debug(`Liking videoId: "${videoId}"`);
    return this.postEndpoint('like/like', { target: { videoId } }, options);
  }

  async dislike(videoId: string, options: EndpointOptions = {}): Promise<Result<unknown, AppError>> {
    this.logger.debug(`Disliking videoId: "${videoId}"`);
    return this.postEndpoint('like/dislike', { target: { videoId } }, options);
  }

  async removelike(videoId: string, options: EndpointOptions = {}): Promise<Result<unknown, AppError>> {
    this.logger.debug(`Removing like for videoId: "${videoId}"`);
    return this.postEndpoint('like/removelike', { target: { videoId } }, options);
  }

  // 14. Playlist Edit
  async editPlaylist(
    playlistId: string,
    actions: unknown[],
    options: EndpointOptions = {},
  ): Promise<Result<unknown, AppError>> {
    this.logger.debug(`Editing playlist: "${playlistId}"`, { actionCount: actions.length });
    return this.postEndpoint('browse/edit_playlist', { playlistId, actions }, options);
  }
}
