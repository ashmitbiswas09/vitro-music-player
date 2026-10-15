/**
 * Domain types and active lyric index helper for the Lyrics Module.
 */

import type { HttpClient } from '@/backend/platform';
import type { CacheManager } from '@/backend/cache';
import type { Clock, Logger } from '@/backend/core';

export interface LyricWord {
  startTimeMs: number;
  text: string;
}

export interface LyricLine {
  startTimeMs: number;
  text: string;
  words?: LyricWord[];
}

export type LyricsSyncType = 'LINE_SYNCED' | 'PLAIN' | 'NONE';
export type LyricsSource = 'LRCLIB' | 'INNERTUBE';

export interface LyricsResult {
  videoId: string;
  source: LyricsSource;
  syncType: LyricsSyncType;
  syncedLines: LyricLine[];
  plainText: string | null;
  instrumental: boolean;
}

export interface LyricsSearchQuery {
  videoId: string;
  trackTitle: string;
  artistName: string;
  albumName?: string;
  durationSeconds?: number;
}

export interface LyricsServiceOptions {
  httpClient: HttpClient;
  cacheManager: CacheManager;
  clock?: Clock;
  logger?: Logger;
}

/**
 * Binary search returning the active line index at given positionMs,
 * or -1 if position is prior to the first line or lines are empty.
 */
export function getActiveLyricIndex(lines: LyricLine[], positionMs: number): number {
  if (!lines || lines.length === 0 || positionMs < lines[0].startTimeMs) {
    return -1;
  }

  let low = 0;
  let high = lines.length - 1;
  let result = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lines[mid].startTimeMs <= positionMs) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
}
