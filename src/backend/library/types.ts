/**
 * Library module domain models and mutation queue types.
 */

import type { Track, Thumbnail } from '@/backend/core';

export type LikeStatus = 'LIKE' | 'DISLIKE' | 'INDIFFERENT';

export interface UserPlaylist {
  id: string;
  title: string;
  trackCount?: number;
  thumbnails: Thumbnail[];
  author?: string;
}

export interface UserPlaylistsResult {
  playlists: UserPlaylist[];
  continuationToken?: string;
}

export interface LikedSongsResult {
  tracks: Track[];
  totalCount?: number;
  continuationToken?: string;
}

export interface HistoryItem {
  track: Track;
  playedAt?: string;
}

export interface HistoryResult {
  items: HistoryItem[];
  continuationToken?: string;
}

export type MutationType = 'SET_LIKE' | 'ADD_PLAYLIST_TRACK' | 'REMOVE_PLAYLIST_TRACK';
export type MutationStatus = 'PENDING' | 'IN_FLIGHT' | 'FAILED';

export interface SetLikePayload {
  videoId: string;
  status: LikeStatus;
  previousStatus?: LikeStatus;
}

export interface AddPlaylistTrackPayload {
  playlistId: string;
  videoId: string;
}

export interface RemovePlaylistTrackPayload {
  playlistId: string;
  videoId: string;
  setVideoId?: string;
}

export interface PendingMutation {
  id: string;
  accountId: string;
  type: MutationType;
  payload: string; // JSON stringified
  createdAt: number;
  retryCount: number;
  lastAttemptAt?: number;
  status: MutationStatus;
  error?: string;
}

export interface LibraryFetchOptions {
  limit?: number;
  continuation?: string;
  forceFresh?: boolean;
  signal?: AbortSignal;
}

export interface OptimisticMutationResult {
  success: boolean;
  queued: boolean;
  mutationId?: string;
}
