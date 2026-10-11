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
  type HttpClient,
  type SecureStore,
  type KeyValueStore,
  type SqlDatabase,
  type FileStore,
} from '@/backend/platform';
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
import type { Result, AppError, StreamError } from '@/backend/core';

export const SERVICES_MODULE_NAME = 'services' as const;

export interface BackendAdapters {
  httpClient?: HttpClient;
  secureStore?: SecureStore;
  keyValueStore?: KeyValueStore;
  sqlDatabase?: SqlDatabase;
  fileStore?: FileStore;
}

export interface Backend {
  readonly innertube: InnertubeClient;
  readonly streaming: StreamResolver;
  readonly adapters: {
    readonly httpClient: HttpClient;
    readonly secureStore: SecureStore;
    readonly keyValueStore: KeyValueStore;
    readonly sqlDatabase: SqlDatabase;
    readonly fileStore: FileStore;
  };
  search(
    query: string,
    options?: SearchOptions,
  ): Promise<Result<SearchResponse, AppError>>;
  resolveStream(
    videoId: string,
    options?: ResolveOptions,
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
  getHome(options?: EndpointOptions): Promise<Result<HomeFeedResponse, AppError>>;
  getAlbum(browseId: string, options?: EndpointOptions): Promise<Result<AlbumDetailResponse, AppError>>;
  getArtist(browseId: string, options?: EndpointOptions): Promise<Result<ArtistDetailResponse, AppError>>;
  getPlaylist(playlistId: string, options?: EndpointOptions): Promise<Result<PlaylistDetailResponse, AppError>>;
  getNext(
    videoId: string,
    options?: NextOptions,
  ): Promise<Result<NextQueueResponse, AppError>>;
  getSearchSuggestions(query: string, options?: EndpointOptions): Promise<Result<SearchSuggestionsResponse, AppError>>;
}

export function createBackend(adapters: BackendAdapters = {}): Backend {
  const httpClient = adapters.httpClient ?? new FetchHttpClient();
  const secureStore = adapters.secureStore ?? new MemorySecureStore();
  const sqlDatabase = adapters.sqlDatabase ?? new MemorySqlDatabase();
  const keyValueStore = adapters.keyValueStore ?? new MemoryKeyValueStore();
  const fileStore = adapters.fileStore ?? new MemoryFileStore();

  const innertube = new InnertubeClient({
    httpClient,
    keyValueStore,
  });

  const streaming = new DefaultStreamResolver({
    httpClient,
  });

  return {
    innertube,
    streaming,
    adapters: {
      httpClient,
      secureStore,
      keyValueStore,
      sqlDatabase,
      fileStore,
    },
    search: (query, options) => innertube.search(query, options),
    resolveStream: (videoId, options) => streaming.resolve(videoId, options),
    verifyStream: (videoId, options) => streaming.resolveAndVerify(videoId, options),
    verifyStreamFull: (resolved, options) => streaming.verifyFull(resolved, options),
    getHome: (options) => innertube.getHome(options),
    getAlbum: (browseId, options) => innertube.getAlbum(browseId, options),
    getArtist: (browseId, options) => innertube.getArtist(browseId, options),
    getPlaylist: (playlistId, options) => innertube.getPlaylist(playlistId, options),
    getNext: (videoId, options) => innertube.getNext(videoId, options),
    getSearchSuggestions: (query, options) => innertube.getSearchSuggestions(query, options),
  };
}
