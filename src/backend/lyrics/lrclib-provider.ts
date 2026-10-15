/**
 * LRCLIB Provider for fetching synchronized and plain text lyrics.
 * Docs: https://lrclib.net/docs
 */

import type { HttpClient } from '@/backend/platform';
import type { Logger } from '@/backend/core';
import { createLogger } from '@/backend/core';
import type { LyricsResult, LyricsSearchQuery } from './types';
import { parseLrc } from './lrc-parser';
import { cleanTrackTitle } from './title-cleaner';

const LRCLIB_BASE_URL = 'https://lrclib.net/api';
const USER_AGENT = 'VitroMusicPlayer/1.0.0 (https://github.com/ashmitbiswas09/vitro-music-player)';

export interface LrclibRecord {
  id?: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  instrumental: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

export class LrclibProvider {
  private readonly httpClient: HttpClient;
  private readonly logger: Logger;

  constructor(httpClient: HttpClient, logger?: Logger) {
    this.httpClient = httpClient;
    this.logger = logger ?? createLogger({ prefix: 'LrclibProvider' });
  }

  async fetchLyrics(query: LyricsSearchQuery): Promise<LyricsResult | null> {
    const { videoId, trackTitle, artistName, albumName, durationSeconds } = query;
    let exactHit429 = false;

    // 1. Attempt exact match via /api/get
    try {
      const exactParams = new URLSearchParams({
        track_name: trackTitle,
        artist_name: artistName,
      });
      if (albumName) {
        exactParams.set('album_name', albumName);
      }
      if (durationSeconds && durationSeconds > 0) {
        exactParams.set('duration', Math.round(durationSeconds).toString());
      }

      const getUrl = `${LRCLIB_BASE_URL}/get?${exactParams.toString()}`;
      this.logger.debug(`Attempting exact LRCLIB match: ${getUrl}`);

      const headers = {
        'User-Agent': USER_AGENT,
        'Lrclib-Client': USER_AGENT,
        Accept: 'application/json',
      };

      let res = await this.httpClient.get<LrclibRecord>(getUrl, { headers });

      if (res.ok && res.value.status === 429) {
        exactHit429 = true;
        this.logger.warn('LRCLIB exact request rate limited (429). Waiting 1000ms...');
        await new Promise((resolve) => setTimeout(resolve, 1000));
        res = await this.httpClient.get<LrclibRecord>(getUrl, { headers });
      }

      if (res.ok && res.value.status === 200 && res.value.data) {
        const record =
          typeof res.value.data === 'string'
            ? (JSON.parse(res.value.data) as LrclibRecord)
            : res.value.data;
        if (record && record.trackName) {
          this.logger.info(`Exact LRCLIB match found for "${trackTitle}" by "${artistName}"`);
          return this.mapToLyricsResult(record, videoId);
        }
      }
    } catch (caught) {
      this.logger.debug(`Exact match request failed: ${String(caught)}`);
    }

    // Small delay to prevent burst 429 between /api/get and /api/search
    await new Promise((resolve) => setTimeout(resolve, 250));

    // 2. Fallback to /api/search with cleaned title
    const cleanedTitle = cleanTrackTitle(trackTitle);
    this.logger.info(`Exact match missed. Searching LRCLIB with cleaned title "${cleanedTitle}"...`);

    try {
      const searchQuery = `${cleanedTitle} ${artistName}`.trim();
      const searchUrl = `${LRCLIB_BASE_URL}/search?q=${encodeURIComponent(searchQuery)}`;

      const headers = {
        'User-Agent': USER_AGENT,
        'Lrclib-Client': USER_AGENT,
        Accept: 'application/json',
      };

      let searchRes = await this.httpClient.get<LrclibRecord[]>(searchUrl, { headers });

      if (searchRes.ok && searchRes.value.status === 429) {
        this.logger.warn('LRCLIB search request rate limited (429). Waiting 1000ms...');
        await new Promise((resolve) => setTimeout(resolve, 1000));
        searchRes = await this.httpClient.get<LrclibRecord[]>(searchUrl, { headers });
      }

      if (searchRes.ok && searchRes.value.status === 200 && searchRes.value.data) {
        const results =
          typeof searchRes.value.data === 'string'
            ? (JSON.parse(searchRes.value.data) as LrclibRecord[])
            : searchRes.value.data;
        if (Array.isArray(results) && results.length > 0) {
          const match = this.pickBestSearchMatch(results, durationSeconds);
          if (match) {
            this.logger.info(
              `Matched LRCLIB search result: "${match.trackName}" by "${match.artistName}" (duration: ${match.duration}s)`,
            );
            return this.mapToLyricsResult(match, videoId);
          }
        }
        // Valid 200 OK with no results -> genuine negative result
        return null;
      }

      if (searchRes.ok && searchRes.value.status === 429) {
        throw new Error('LRCLIB rate limited (HTTP 429)');
      }
    } catch (caught) {
      this.logger.warn(`LRCLIB search fallback failed: ${String(caught)}`);
      if (caught instanceof Error && caught.message.includes('429')) {
        throw caught;
      }
    }

    // If exact was 429 and search failed, do not treat as genuine null
    if (exactHit429) {
      throw new Error('LRCLIB rate limited (HTTP 429)');
    }

    return null;
  }

  private pickBestSearchMatch(
    records: LrclibRecord[],
    targetDuration?: number,
  ): LrclibRecord | null {
    if (records.length === 0) return null;

    if (!targetDuration || targetDuration <= 0) {
      // Pick first record with synced lyrics, or first record
      return records.find((r) => Boolean(r.syncedLyrics)) ?? records[0];
    }

    // Filter within +/- 5 seconds of target track duration
    const candidates = records.filter(
      (r) => r.duration !== undefined && Math.abs(r.duration - targetDuration) <= 5,
    );

    if (candidates.length === 0) {
      return null;
    }

    // Sort by: 1) closest duration, 2) has syncedLyrics
    candidates.sort((a, b) => {
      const diffA = Math.abs((a.duration ?? 0) - targetDuration);
      const diffB = Math.abs((b.duration ?? 0) - targetDuration);
      if (diffA !== diffB) {
        return diffA - diffB;
      }
      return (b.syncedLyrics ? 1 : 0) - (a.syncedLyrics ? 1 : 0);
    });

    return candidates[0];
  }

  private mapToLyricsResult(record: LrclibRecord, videoId: string): LyricsResult {
    if (record.instrumental) {
      return {
        videoId,
        source: 'LRCLIB',
        syncType: 'NONE',
        syncedLines: [],
        plainText: null,
        instrumental: true,
      };
    }

    if (record.syncedLyrics) {
      const parsed = parseLrc(record.syncedLyrics);
      if (parsed.lines.length > 0) {
        return {
          videoId,
          source: 'LRCLIB',
          syncType: 'LINE_SYNCED',
          syncedLines: parsed.lines,
          plainText: record.plainLyrics ?? null,
          instrumental: false,
        };
      }
    }

    if (record.plainLyrics) {
      return {
        videoId,
        source: 'LRCLIB',
        syncType: 'PLAIN',
        syncedLines: [],
        plainText: record.plainLyrics,
        instrumental: false,
      };
    }

    return {
      videoId,
      source: 'LRCLIB',
      syncType: 'NONE',
      syncedLines: [],
      plainText: null,
      instrumental: false,
    };
  }
}
