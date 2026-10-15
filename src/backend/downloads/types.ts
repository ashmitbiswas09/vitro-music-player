/**
 * Downloads module domain models, types, and event definitions.
 */

import type { Track, Logger } from '@/backend/core';
import type { FileStore, SqlDatabase } from '@/backend/platform';
import type { StreamResolver } from '@/backend/streaming';

export type DownloadStatus = 'QUEUED' | 'DOWNLOADING' | 'COMPLETED' | 'FAILED';

export interface DownloadedTrack {
  videoId: string;
  track: Track;
  filePath: string;
  sizeBytes: number;
  mimeType: string;
  codec: string;
  bitrate: number;
  downloadedAt: number;
}

export interface DownloadProgress {
  videoId: string;
  bytesDownloaded: number;
  totalBytes: number;
}

export type DownloadEvent =
  | { type: 'enqueued'; videoId: string; track: Track }
  | { type: 'started'; videoId: string }
  | { type: 'progress'; videoId: string; bytesDownloaded: number; totalBytes: number }
  | { type: 'completed'; videoId: string; track: DownloadedTrack }
  | { type: 'failed'; videoId: string; error: string }
  | { type: 'removed'; videoId: string };

export interface LyricsPreCacher {
  getLyrics(query: {
    videoId: string;
    trackTitle: string;
    artistName: string;
    albumName?: string;
    durationSeconds?: number;
  }): Promise<unknown>;
}

export interface DownloadManagerOptions {
  fileStore: FileStore;
  sqlDatabase: SqlDatabase;
  streamResolver: StreamResolver;
  lyricsService?: LyricsPreCacher;
  logger?: Logger;
  downloadsDir?: string;
}
