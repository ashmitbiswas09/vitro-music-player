/**
 * Public barrel export for the Lyrics Module (src/backend/lyrics).
 * External modules MUST import only from this barrel.
 */

export type {
  LyricWord,
  LyricLine,
  LyricsSyncType,
  LyricsSource,
  LyricsResult,
  LyricsSearchQuery,
  LyricsServiceOptions,
} from './types';

export { getActiveLyricIndex } from './types';
export { parseLrc, type ParsedLrc } from './lrc-parser';
export { cleanTrackTitle } from './title-cleaner';
export { LrclibProvider, type LrclibRecord } from './lrclib-provider';
export { LyricsService } from './lyrics-service';
