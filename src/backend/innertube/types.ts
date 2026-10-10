/**
 * Types and interfaces for the InnerTube module.
 */

import type { Track, Album, Artist, Playlist, InnertubeClientConfig, Logger } from '@/backend/core';
import type { HttpClient, KeyValueStore } from '@/backend/platform';

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

export interface InnertubeClientOptions {
  httpClient: HttpClient;
  keyValueStore?: KeyValueStore;
  config?: Partial<InnertubeClientConfig>;
  visitorDataOverride?: string;
  logger?: Logger;
}
