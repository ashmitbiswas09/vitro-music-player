import type { Track, Album, Artist, Playlist, InnertubeClientConfig, Logger } from '@/backend/core';
import type { HttpClient, KeyValueStore } from '@/backend/platform';
import type { AuthSession, AuthService } from '@/backend/auth';

export type SearchFilter = 'all' | 'songs' | 'albums' | 'artists' | 'playlists' | 'videos';

export type SearchResultItem =
  | { type: 'track'; track: Track }
  | { type: 'album'; album: Album }
  | { type: 'artist'; artist: Artist }
  | { type: 'playlist'; playlist: Playlist };

export interface SearchResponse {
  query: string;
  filter: SearchFilter;
  items: SearchResultItem[];
  continuationToken?: string;
  parseDurationMs: number;
  responseSizeBytes: number;
}

export interface SearchOptions {
  filter?: SearchFilter;
  continuationToken?: string;
  visitorData?: string;
  signal?: AbortSignal;
}

export interface SearchSuggestionsResponse {
  query: string;
  suggestions: string[];
  parseDurationMs: number;
  responseSizeBytes: number;
}

export interface HomeSection {
  title: string;
  items: SearchResultItem[];
}

export interface HomeFeedResponse {
  sections: HomeSection[];
  continuationToken?: string;
  parseDurationMs: number;
  responseSizeBytes: number;
}

export interface AlbumDetailResponse {
  album: Album;
  parseDurationMs: number;
  responseSizeBytes: number;
}

export interface ArtistDetailResponse {
  artist: Artist;
  albums: Album[];
  singles: Album[];
  parseDurationMs: number;
  responseSizeBytes: number;
}

export interface PlaylistDetailResponse {
  playlist: Playlist;
  parseDurationMs: number;
  responseSizeBytes: number;
}

export interface NextQueueResponse {
  currentTrack?: Track;
  queue: Track[];
  playlistId?: string;
  continuationToken?: string;
  parseDurationMs: number;
  responseSizeBytes: number;
}

export interface ContinuationResponse {
  items: SearchResultItem[];
  continuationToken?: string;
  parseDurationMs: number;
  responseSizeBytes: number;
}

export interface EndpointOptions {
  signal?: AbortSignal;
  visitorData?: string;
  authSession?: AuthSession;
}

export interface NextOptions extends EndpointOptions {
  playlistId?: string;
  continuationToken?: string;
}

export interface ContinuationOptions extends EndpointOptions {
  continuationToken: string;
}

export interface InnertubeClientOptions {
  httpClient: HttpClient;
  keyValueStore?: KeyValueStore;
  config?: Partial<InnertubeClientConfig>;
  visitorDataOverride?: string;
  logger?: Logger;
  authService?: AuthService;
  authSession?: AuthSession;
}
