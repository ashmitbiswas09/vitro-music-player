/**
 * Phase 8: Lyrics Module Unit Tests
 * Tests LRC format parser, getActiveLyricIndex binary search, title cleaner,
 * LRCLIB provider with duration filtering (+/-5s), and LyricsService two-tier caching.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseLrc,
  getActiveLyricIndex,
  cleanTrackTitle,
  LrclibProvider,
  LyricsService,
  type LyricLine,
} from '@/backend/lyrics';
import {
  MemoryHttpClient,
  MemorySqlDatabase,
} from '@/backend/platform';
import { CacheManager } from '@/backend/cache';
import { TestClock, isOk } from '@/backend/core';

describe('Phase 8: Lyrics Module', () => {
  describe('1. LRC Format Parser (parseLrc)', () => {
    it('parses standard 2-digit ms timestamps ([mm:ss.xx])', () => {
      const raw = `[01:23.45]Hello world\n[02:00.00]Second line`;
      const result = parseLrc(raw);

      expect(result.lines).toHaveLength(2);
      expect(result.lines[0]).toEqual({
        startTimeMs: 1 * 60 * 1000 + 23 * 1000 + 450,
        text: 'Hello world',
      });
      expect(result.lines[1]).toEqual({
        startTimeMs: 2 * 60 * 1000,
        text: 'Second line',
      });
    });

    it('parses 3-digit ms timestamps ([mm:ss.xxx]) and 1-digit ms ([mm:ss.x])', () => {
      const raw = `[00:15.123]High precision\n[00:20.5]Tenths precision`;
      const result = parseLrc(raw);

      expect(result.lines).toHaveLength(2);
      expect(result.lines[0]).toEqual({
        startTimeMs: 15123,
        text: 'High precision',
      });
      expect(result.lines[1]).toEqual({
        startTimeMs: 20500,
        text: 'Tenths precision',
      });
    });

    it('expands multi-timestamp lines into discrete chronological lines', () => {
      const raw = `[00:10.00][00:20.00][00:30.00] Repeated chorus line`;
      const result = parseLrc(raw);

      expect(result.lines).toHaveLength(3);
      expect(result.lines[0]).toEqual({ startTimeMs: 10000, text: 'Repeated chorus line' });
      expect(result.lines[1]).toEqual({ startTimeMs: 20000, text: 'Repeated chorus line' });
      expect(result.lines[2]).toEqual({ startTimeMs: 30000, text: 'Repeated chorus line' });
    });

    it('ignores metadata tags like [ar:...], [ti:...], [al:...] from lyrics text', () => {
      const raw = `[ar:Radiohead]\n[ti:Creep]\n[al:Pablo Honey]\n[00:05.00]When you were here before`;
      const result = parseLrc(raw);

      expect(result.lines).toHaveLength(1);
      expect(result.lines[0]).toEqual({
        startTimeMs: 5000,
        text: 'When you were here before',
      });
      expect(result.metadata.ar).toBe('Radiohead');
      expect(result.metadata.ti).toBe('Creep');
      expect(result.metadata.al).toBe('Pablo Honey');
    });

    it('applies positive and negative [offset:+/-ms] tag and clamps to 0', () => {
      const rawPos = `[offset:500]\n[00:02.00]Shifted forward`;
      const resultPos = parseLrc(rawPos);
      expect(resultPos.offsetMs).toBe(500);
      expect(resultPos.lines[0].startTimeMs).toBe(2500);

      const rawNeg = `[offset:-3000]\n[00:02.00]Clamped to zero\n[00:05.00]Above zero`;
      const resultNeg = parseLrc(rawNeg);
      expect(resultNeg.offsetMs).toBe(-3000);
      expect(resultNeg.lines[0].startTimeMs).toBe(0); // 2000 - 3000 clamped to 0
      expect(resultNeg.lines[1].startTimeMs).toBe(2000); // 5000 - 3000 = 2000
    });

    it('sorts lines chronologically even if input LRC is out of order', () => {
      const raw = `[00:30.00]Third\n[00:10.00]First\n[00:20.00]Second`;
      const result = parseLrc(raw);

      expect(result.lines.map((l) => l.text)).toEqual(['First', 'Second', 'Third']);
    });

    it('handles empty or malformed input gracefully', () => {
      expect(parseLrc('').lines).toEqual([]);
      expect(parseLrc('Just plain text without timestamps').lines).toEqual([]);
    });
  });

  describe('2. Active Lyric Binary Search (getActiveLyricIndex)', () => {
    const sampleLines: LyricLine[] = [
      { startTimeMs: 5000, text: 'First line' },
      { startTimeMs: 12000, text: 'Second line' },
      { startTimeMs: 25000, text: 'Third line' },
      { startTimeMs: 40000, text: 'Fourth line' },
    ];

    it('returns -1 before the first lyric line starts', () => {
      expect(getActiveLyricIndex(sampleLines, 0)).toBe(-1);
      expect(getActiveLyricIndex(sampleLines, 4999)).toBe(-1);
    });

    it('returns 0 when position exactly matches first line start time', () => {
      expect(getActiveLyricIndex(sampleLines, 5000)).toBe(0);
    });

    it('returns active line index between lines', () => {
      expect(getActiveLyricIndex(sampleLines, 6000)).toBe(0);
      expect(getActiveLyricIndex(sampleLines, 11999)).toBe(0);
      expect(getActiveLyricIndex(sampleLines, 12000)).toBe(1);
      expect(getActiveLyricIndex(sampleLines, 20000)).toBe(1);
      expect(getActiveLyricIndex(sampleLines, 25000)).toBe(2);
    });

    it('returns last line index after the final lyric starts', () => {
      expect(getActiveLyricIndex(sampleLines, 40000)).toBe(3);
      expect(getActiveLyricIndex(sampleLines, 999999)).toBe(3);
    });

    it('handles empty lines array gracefully', () => {
      expect(getActiveLyricIndex([], 10000)).toBe(-1);
    });
  });

  describe('3. Track Title Cleaner (cleanTrackTitle)', () => {
    it('removes parenthesized visual and quality tags', () => {
      expect(cleanTrackTitle('Creep (Official Music Video)')).toBe('Creep');
      expect(cleanTrackTitle('No Surprises (Official Audio)')).toBe('No Surprises');
      expect(cleanTrackTitle('Karma Police (Visualizer)')).toBe('Karma Police');
      expect(cleanTrackTitle('Song (Lyric Video)')).toBe('Song');
      expect(cleanTrackTitle('High and Dry (Lyrics)')).toBe('High and Dry');
      expect(cleanTrackTitle('Paranoid Android (HD)')).toBe('Paranoid Android');
      expect(cleanTrackTitle('Fake Plastic Trees (4K)')).toBe('Fake Plastic Trees');
    });

    it('removes bracketed tags', () => {
      expect(cleanTrackTitle('Daydreaming [Official Video]')).toBe('Daydreaming');
      expect(cleanTrackTitle('Burn the Witch [Music Video]')).toBe('Burn the Witch');
      expect(cleanTrackTitle('True Love Waits [Audio]')).toBe('True Love Waits');
    });

    it('removes featuring artists from titles', () => {
      expect(cleanTrackTitle('Everything in Its Right Place (feat. Guest)')).toBe(
        'Everything in Its Right Place',
      );
      expect(cleanTrackTitle('Lotus Flower ft. Thom Yorke')).toBe('Lotus Flower');
      expect(cleanTrackTitle('Exit Music [feat. Choir]')).toBe('Exit Music');
    });

    it('removes remaster and live suffixes', () => {
      expect(cleanTrackTitle('Airbag (Remastered 2011)')).toBe('Airbag');
      expect(cleanTrackTitle('Idioteque (Live at Glastonbury)')).toBe('Idioteque');
    });

    it('falls back to original if cleaning removes all characters', () => {
      expect(cleanTrackTitle('(Official Video)')).toBe('(Official Video)');
    });
  });

  describe('4. LRCLIB Provider (LrclibProvider)', () => {
    let httpClient: MemoryHttpClient;
    let provider: LrclibProvider;

    beforeEach(() => {
      httpClient = new MemoryHttpClient();
      provider = new LrclibProvider(httpClient);
    });

    it('successfully fetches exact match via /api/get', async () => {
      httpClient.whenGet(
        'https://lrclib.net/api/get?track_name=Creep&artist_name=Radiohead&album_name=Pablo+Honey&duration=239',
        {
          id: 101,
          trackName: 'Creep',
          artistName: 'Radiohead',
          duration: 239,
          instrumental: false,
          plainLyrics: 'When you were here before\nCouldnt look you in the eye',
          syncedLyrics: '[00:05.10]When you were here before\n[00:10.20]Couldnt look you in the eye',
        },
        200,
      );

      const result = await provider.fetchLyrics({
        videoId: '9RfVp-GhKfs',
        trackTitle: 'Creep',
        artistName: 'Radiohead',
        albumName: 'Pablo Honey',
        durationSeconds: 239,
      });

      expect(result).not.toBeNull();
      expect(result?.syncType).toBe('LINE_SYNCED');
      expect(result?.syncedLines).toHaveLength(2);
      expect(result?.syncedLines[0].text).toBe('When you were here before');
      expect(result?.source).toBe('LRCLIB');
    });

    it('falls back to /api/search when exact /api/get returns 404, with title cleaning', async () => {
      // /api/get 404s on noisy title
      httpClient.whenGet(
        'https://lrclib.net/api/get?track_name=Creep+%28Official+Music+Video%29&artist_name=Radiohead&duration=239',
        { message: 'Track not found' },
        404,
      );

      // Cleaned search succeeds: "Creep Radiohead"
      httpClient.whenGet(
        'https://lrclib.net/api/search?q=Creep%20Radiohead',
        [
          {
            id: 102,
            trackName: 'Creep',
            artistName: 'Radiohead',
            duration: 238, // within +/- 5s of 239s
            instrumental: false,
            syncedLyrics: '[00:04.00]When you were here before',
          },
        ],
        200,
      );

      const result = await provider.fetchLyrics({
        videoId: '9RfVp-GhKfs',
        trackTitle: 'Creep (Official Music Video)',
        artistName: 'Radiohead',
        durationSeconds: 239,
      });

      expect(result).not.toBeNull();
      expect(result?.syncType).toBe('LINE_SYNCED');
      expect(result?.syncedLines[0].text).toBe('When you were here before');
    });

    it('filters search results picking closest duration within +/- 5 seconds', async () => {
      httpClient.whenGet(
        'https://lrclib.net/api/get?track_name=Karma+Police&artist_name=Radiohead&duration=261',
        {},
        404,
      );

      httpClient.whenGet(
        'https://lrclib.net/api/search?q=Karma%20Police%20Radiohead',
        [
          {
            id: 1,
            trackName: 'Karma Police (Live Version)',
            artistName: 'Radiohead',
            duration: 310, // 49s diff: rejected (> 5s)
            syncedLyrics: '[00:01.00]Live line',
          },
          {
            id: 2,
            trackName: 'Karma Police',
            artistName: 'Radiohead',
            duration: 263, // 2s diff: accepted
            syncedLyrics: '[00:01.00]Karma police, arrest this man',
          },
          {
            id: 3,
            trackName: 'Karma Police (Cover)',
            artistName: 'Radiohead',
            duration: 265, // 4s diff: candidate but farther than #2
            syncedLyrics: '[00:01.00]Cover line',
          },
        ],
        200,
      );

      const result = await provider.fetchLyrics({
        videoId: 'IBH97ma9YiI',
        trackTitle: 'Karma Police',
        artistName: 'Radiohead',
        durationSeconds: 261,
      });

      expect(result).not.toBeNull();
      expect(result?.syncedLines[0].text).toBe('Karma police, arrest this man');
    });

    it('returns null if no search candidate falls within +/- 5 seconds of duration', async () => {
      httpClient.whenGet(
        'https://lrclib.net/api/get?track_name=Song&artist_name=Artist&duration=200',
        {},
        404,
      );

      httpClient.whenGet(
        'https://lrclib.net/api/search?q=Song%20Artist',
        [
          {
            id: 1,
            trackName: 'Song',
            artistName: 'Artist',
            duration: 180, // 20s diff (> 5s)
            syncedLyrics: '[00:01.00]Too short',
          },
        ],
        200,
      );

      const result = await provider.fetchLyrics({
        videoId: 'vid_short',
        trackTitle: 'Song',
        artistName: 'Artist',
        durationSeconds: 200,
      });

      expect(result).toBeNull();
    });

    it('handles instrumental tracks correctly', async () => {
      httpClient.whenGet(
        'https://lrclib.net/api/get?track_name=Treefingers&artist_name=Radiohead&album_name=Kid+A&duration=222',
        {
          id: 103,
          trackName: 'Treefingers',
          artistName: 'Radiohead',
          duration: 222,
          instrumental: true,
        },
        200,
      );

      const result = await provider.fetchLyrics({
        videoId: 'vid_tree',
        trackTitle: 'Treefingers',
        artistName: 'Radiohead',
        albumName: 'Kid A',
        durationSeconds: 222,
      });

      expect(result).not.toBeNull();
      expect(result?.instrumental).toBe(true);
      expect(result?.syncType).toBe('NONE');
      expect(result?.syncedLines).toHaveLength(0);
    });

    it('skips /api/get and queries /api/search directly when albumName or durationSeconds is missing', async () => {
      httpClient.whenGet(
        'https://lrclib.net/api/search?q=Creep%20Radiohead',
        [
          {
            id: 105,
            trackName: 'Creep',
            artistName: 'Radiohead',
            duration: 239,
            syncedLyrics: '[00:01.00]When you were here before',
          },
        ],
        200,
      );

      // No albumName passed
      const result = await provider.fetchLyrics({
        videoId: '9RfVp-GhKfs',
        trackTitle: 'Creep',
        artistName: 'Radiohead',
        durationSeconds: 239,
      });

      expect(result).not.toBeNull();
      expect(result?.syncedLines[0].text).toBe('When you were here before');

      // Assert that /api/get was never called!
      const getCalls = httpClient.recordedRequests.filter((r) => r.url.includes('/api/get'));
      expect(getCalls).toHaveLength(0);

      const searchCalls = httpClient.recordedRequests.filter((r) => r.url.includes('/api/search'));
      expect(searchCalls).toHaveLength(1);
    });

    it('penalizes unrequested version modifiers (acoustic, live, remix, instrumental) in search ranking', async () => {
      httpClient.whenGet(
        'https://lrclib.net/api/search?q=Creep%20Radiohead',
        [
          {
            id: 1,
            trackName: 'Creep (Acoustic)',
            artistName: 'Radiohead',
            duration: 239, // exact duration match, but has modifier!
            syncedLyrics: '[00:01.00]Acoustic version line',
          },
          {
            id: 2,
            trackName: 'Creep',
            artistName: 'Radiohead',
            duration: 240, // 1s diff, but clean studio track!
            syncedLyrics: '[00:01.00]Studio version line',
          },
          {
            id: 3,
            trackName: 'Creep (Live at Glastonbury)',
            artistName: 'Radiohead',
            duration: 239,
            syncedLyrics: '[00:01.00]Live version line',
          },
        ],
        200,
      );

      // Query does not request acoustic or live
      const result = await provider.fetchLyrics({
        videoId: '9RfVp-GhKfs',
        trackTitle: 'Creep',
        artistName: 'Radiohead',
        durationSeconds: 239,
      });

      expect(result).not.toBeNull();
      // Should pick studio track #2 over acoustic #1 or live #3
      expect(result?.syncedLines[0].text).toBe('Studio version line');

      // However, if the query explicitly asks for acoustic, acoustic should be selected:
      httpClient.whenGet(
        'https://lrclib.net/api/search?q=Creep%20Acoustic%20Radiohead',
        [
          {
            id: 1,
            trackName: 'Creep (Acoustic)',
            artistName: 'Radiohead',
            duration: 239,
            syncedLyrics: '[00:01.00]Acoustic version line',
          },
          {
            id: 2,
            trackName: 'Creep',
            artistName: 'Radiohead',
            duration: 239,
            syncedLyrics: '[00:01.00]Studio version line',
          },
        ],
        200,
      );

      const acousticResult = await provider.fetchLyrics({
        videoId: '4BX5xpB2DBM',
        trackTitle: 'Creep Acoustic',
        artistName: 'Radiohead',
        durationSeconds: 239,
      });

      expect(acousticResult).not.toBeNull();
      expect(acousticResult?.syncedLines[0].text).toBe('Acoustic version line');
    });
  });

  describe('5. LyricsService Caching & Orchestration', () => {
    let httpClient: MemoryHttpClient;
    let sqlDatabase: MemorySqlDatabase;
    let clock: TestClock;
    let cacheManager: CacheManager;
    let lyricsService: LyricsService;

    beforeEach(() => {
      httpClient = new MemoryHttpClient();
      sqlDatabase = new MemorySqlDatabase();
      clock = new TestClock(1000000);
      cacheManager = new CacheManager({ sqlDatabase, clock });
      lyricsService = new LyricsService({
        httpClient,
        cacheManager,
        clock,
      });
    });

    it('caches successful synced lyrics with 7-day TTL across memory and SQLite', async () => {
      httpClient.whenGet(
        'https://lrclib.net/api/get?track_name=Creep&artist_name=Radiohead&album_name=Pablo+Honey&duration=239',
        {
          id: 201,
          trackName: 'Creep',
          artistName: 'Radiohead',
          duration: 239,
          instrumental: false,
          syncedLyrics: '[00:05.00]When you were here before',
        },
        200,
      );

      // First call: Cache miss -> network fetch
      const res1 = await lyricsService.getLyrics({
        videoId: '9RfVp-GhKfs',
        trackTitle: 'Creep',
        artistName: 'Radiohead',
        albumName: 'Pablo Honey',
        durationSeconds: 239,
      });

      expect(isOk(res1)).toBe(true);
      if (isOk(res1)) {
        expect(res1.value.syncType).toBe('LINE_SYNCED');
      }
      expect(httpClient.recordedRequests).toHaveLength(1);

      // Second call: Cache hit (memory LRU) -> 0 additional network calls
      const res2 = await lyricsService.getLyrics({
        videoId: '9RfVp-GhKfs',
        trackTitle: 'Creep',
        artistName: 'Radiohead',
        albumName: 'Pablo Honey',
        durationSeconds: 239,
      });

      expect(isOk(res2)).toBe(true);
      if (isOk(res2)) {
        expect(res2.value.syncedLines[0].text).toBe('When you were here before');
      }
      expect(httpClient.recordedRequests).toHaveLength(1);

      // Advance clock by 6 days (within 7-day TTL)
      clock.advanceBy(6 * 24 * 60 * 60 * 1000);

      // Wipe memory LRU to simulate app restart
      cacheManager.clearMemoryTier();

      // Read from SQLite L2 store
      const res3 = await lyricsService.getLyrics({
        videoId: '9RfVp-GhKfs',
        trackTitle: 'Creep',
        artistName: 'Radiohead',
        albumName: 'Pablo Honey',
        durationSeconds: 239,
      });

      expect(isOk(res3)).toBe(true);
      if (isOk(res3)) {
        expect(res3.value.syncedLines[0].text).toBe('When you were here before');
      }
      expect(httpClient.recordedRequests).toHaveLength(1); // Still 1 network call, persisted to SQLite!
    });

    it('performs negative caching (1-hour TTL) when no lyrics are found', async () => {
      // Set 404 for track with no lyrics
      httpClient.whenGet(
        'https://lrclib.net/api/get?track_name=Obscure+Song&artist_name=Unknown&album_name=Obscure+Album&duration=120',
        {},
        404,
      );
      httpClient.whenGet(
        'https://lrclib.net/api/search?q=Obscure%20Song%20Unknown',
        [],
        200,
      );

      // First fetch: network lookup with albumName -> calls get (404) then search (200), total 2 requests
      const res1 = await lyricsService.getLyrics({
        videoId: 'vid_obscure',
        trackTitle: 'Obscure Song',
        artistName: 'Unknown',
        albumName: 'Obscure Album',
        durationSeconds: 120,
      });

      expect(isOk(res1)).toBe(true);
      if (isOk(res1)) {
        expect(res1.value.syncType).toBe('NONE');
      }
      expect(httpClient.recordedRequests).toHaveLength(2); // exact + search fallback

      // Immediate second fetch: returns negative cache entry without making network calls
      const res2 = await lyricsService.getLyrics({
        videoId: 'vid_obscure',
        trackTitle: 'Obscure Song',
        artistName: 'Unknown',
        albumName: 'Obscure Album',
        durationSeconds: 120,
      });

      expect(isOk(res2)).toBe(true);
      if (isOk(res2)) {
        expect(res2.value.syncType).toBe('NONE');
      }
      expect(httpClient.recordedRequests).toHaveLength(2); // No new network calls!

      // Advance clock past 1-hour negative TTL
      clock.advanceBy(61 * 60 * 1000);

      // Third fetch: cache has expired, retries provider
      await lyricsService.getLyrics({
        videoId: 'vid_obscure',
        trackTitle: 'Obscure Song',
        artistName: 'Unknown',
        durationSeconds: 120,
      });

      expect(httpClient.recordedRequests.length).toBeGreaterThan(2);
    });

    it('forceRefresh: true bypasses cache and re-fetches from provider', async () => {
      httpClient.whenGet(
        'https://lrclib.net/api/get?track_name=Creep&artist_name=Radiohead&album_name=Pablo+Honey&duration=239',
        {
          id: 201,
          trackName: 'Creep',
          artistName: 'Radiohead',
          duration: 239,
          instrumental: false,
          syncedLyrics: '[00:05.00]When you were here before',
        },
        200,
      );

      await lyricsService.getLyrics({
        videoId: '9RfVp-GhKfs',
        trackTitle: 'Creep',
        artistName: 'Radiohead',
        albumName: 'Pablo Honey',
        durationSeconds: 239,
      });
      expect(httpClient.recordedRequests).toHaveLength(1);

      // With forceRefresh: true
      await lyricsService.getLyrics(
        {
          videoId: '9RfVp-GhKfs',
          trackTitle: 'Creep',
          artistName: 'Radiohead',
          albumName: 'Pablo Honey',
          durationSeconds: 239,
        },
        { forceRefresh: true },
      );
      expect(httpClient.recordedRequests).toHaveLength(2);
    });
  });
});
