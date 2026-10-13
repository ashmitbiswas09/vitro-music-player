/**
 * Services module public API.
 * Composition root `createBackend(adapters)` providing a unified typed facade for consumers.
 */

import {
  FetchHttpClient,
  MemorySecureStore,
  MemoryKeyValueStore,
  MemorySqlDatabase,
  MemoryFileStore,
  NodeSha1,
  type HttpClient,
  type SecureStore,
  type KeyValueStore,
  type SqlDatabase,
  type FileStore,
  type Sha1Port,
} from '@/backend/platform';
import {
  AuthService,
  type AuthSession,
  type CookieJarClearer,
} from '@/backend/auth';
import {
  InnertubeClient,
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
} from '@/backend/innertube';
import {
  DefaultStreamResolver,
  type StreamResolver,
  type ResolvedStream,
  type StreamVerificationResult,
  type FullVerificationResult,
  type ResolveOptions,
  type FullVerificationOptions,
} from '@/backend/streaming';
import {
  CacheManager,
  PrefetchPlanner,
  type CacheStats,
  type GetOrFetchOptions,
} from '@/backend/cache';
import type { Result, AppError, StreamError, AuthError, Clock } from '@/backend/core';
import { MusicRepository } from './music-repository';

export const SERVICES_MODULE_NAME = 'services' as const;
export * from './music-repository';

export interface BackendAdapters {
  httpClient?: HttpClient;
  secureStore?: SecureStore;
  keyValueStore?: KeyValueStore;
  sqlDatabase?: SqlDatabase;
  fileStore?: FileStore;
  sha1?: Sha1Port;
  clock?: Clock;
  cookieJarClearer?: CookieJarClearer;
}

export interface Backend {
  readonly repository: MusicRepository;
  readonly cache: CacheManager;
  readonly prefetcher: PrefetchPlanner;
  readonly innertube: InnertubeClient;
  readonly streaming: StreamResolver;
  readonly auth: AuthService;
  readonly adapters: {
    readonly httpClient: HttpClient;
    readonly secureStore: SecureStore;
    readonly keyValueStore: KeyValueStore;
    readonly sqlDatabase: SqlDatabase;
    readonly fileStore: FileStore;
    readonly sha1: Sha1Port;
  };
  search(
    query: string,
    options?: SearchOptions & GetOrFetchOptions,
  ): Promise<Result<SearchResponse, AppError>>;
  resolveStream(
    videoId: string,
    options?: ResolveOptions & GetOrFetchOptions,
  ): Promise<Result<ResolvedStream, StreamError>>;
  verifyStream(
    videoId: string,
    options?: ResolveOptions & { verifyFull?: boolean },
  ): Promise<
    Result<
      {
        resolved: ResolvedStream;
        verification: StreamVerificationResult;
        fullVerification?: FullVerificationResult;
      },
      StreamError
    >
  >;
  verifyStreamFull(
    resolved: ResolvedStream,
    options?: FullVerificationOptions,
  ): Promise<FullVerificationResult>;
  getHome(options?: EndpointOptions & GetOrFetchOptions): Promise<Result<HomeFeedResponse, AppError>>;
  getAlbum(browseId: string, options?: EndpointOptions & GetOrFetchOptions): Promise<Result<AlbumDetailResponse, AppError>>;
  getArtist(browseId: string, options?: EndpointOptions & GetOrFetchOptions): Promise<Result<ArtistDetailResponse, AppError>>;
  getPlaylist(playlistId: string, options?: EndpointOptions & GetOrFetchOptions): Promise<Result<PlaylistDetailResponse, AppError>>;
  getNext(
    videoId: string,
    options?: NextOptions & GetOrFetchOptions,
  ): Promise<Result<NextQueueResponse, AppError>>;
  getSearchSuggestions(query: string, options?: EndpointOptions & GetOrFetchOptions): Promise<Result<SearchSuggestionsResponse, AppError>>;
  invalidateStream(videoId: string): Promise<void>;
  clearUserScopedData(): Promise<void>;
  clearMemoryTier(): void;
  clearCache(): Promise<void>;
  getCacheStats(): Promise<CacheStats>;
  setSessionFromCookies(cookies: Record<string, string> | string): Promise<Result<AuthSession, AuthError>>;
  validateSession(): Promise<Result<boolean, AuthError>>;
  logout(): Promise<Result<void, AuthError>>;
  isSignedIn(): Promise<boolean>;
}

export function createBackend(adapters: BackendAdapters = {}): Backend {
  const httpClient = adapters.httpClient ?? new FetchHttpClient();
  const secureStore = adapters.secureStore ?? new MemorySecureStore();
  const sqlDatabase = adapters.sqlDatabase ?? new MemorySqlDatabase();
  const keyValueStore = adapters.keyValueStore ?? new MemoryKeyValueStore();
  const fileStore = adapters.fileStore ?? new MemoryFileStore();
  const sha1 = adapters.sha1 ?? new NodeSha1();
  const clock = adapters.clock;

  const cache = new CacheManager({
    sqlDatabase,
    clock,
  });

  const innertube = new InnertubeClient({
    httpClient,
    keyValueStore,
  });

  const auth = new AuthService({
    secureStore,
    sha1,
    httpClient,
    clock,
    cookieJarClearer: adapters.cookieJarClearer,
    onLogout: async () => {
      await cache.clearUserScopedData();
      await innertube.resetVisitorData();
    },
  });

  innertube.setAuthService(auth);

  const streaming = new DefaultStreamResolver({
    httpClient,
    clock,
    authService: auth,
  });

  const repository = new MusicRepository({
    innertube,
    streamResolver: streaming,
    cache,
    authService: auth,
  });

  const prefetcher = new PrefetchPlanner(cache, streaming, clock);

  return {
    repository,
    cache,
    prefetcher,
    innertube,
    streaming,
    auth,
    adapters: {
      httpClient,
      secureStore,
      keyValueStore,
      sqlDatabase,
      fileStore,
      sha1,
    },
    search: (query, options) => repository.search(query, options),
    resolveStream: (videoId, options) => repository.resolveStream(videoId, options),
    verifyStream: (videoId, options) => streaming.resolveAndVerify(videoId, options),
    verifyStreamFull: (resolved, options) => streaming.verifyFull(resolved, options),
    getHome: (options) => repository.getHome(options),
    getAlbum: (browseId, options) => repository.getAlbum(browseId, options),
    getArtist: (browseId, options) => repository.getArtist(browseId, options),
    getPlaylist: (playlistId, options) => repository.getPlaylist(playlistId, options),
    getNext: (videoId, options) => repository.getNext(videoId, options),
    getSearchSuggestions: (query, options) => repository.getSearchSuggestions(query, options),
    invalidateStream: (videoId) => repository.invalidateStream(videoId),
    clearUserScopedData: () => repository.clearUserScopedData(),
    clearMemoryTier: () => repository.clearMemoryTier(),
    clearCache: () => cache.clear(),
    getCacheStats: () => cache.getStats(),
    setSessionFromCookies: (cookies) => auth.setSessionFromCookies(cookies),
    validateSession: () => auth.validateSession(),
    logout: () => auth.logout(),
    isSignedIn: () => auth.isSignedIn(),
  };
}
