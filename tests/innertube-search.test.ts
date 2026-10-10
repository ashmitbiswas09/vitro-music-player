import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseSearchResponse, InnertubeClient } from '@/backend/innertube';
import { MemoryHttpClient } from '@/backend/platform';
import { isOk, isErr, DEFAULT_INNERTUBE_CONFIG } from '@/backend/core';

describe('Innertube Search & Real Fixture Tests', () => {
  const radioheadFixturePath = path.resolve(
    __dirname,
    '../fixtures/sanitized/search_radiohead.json',
  );
  const radioheadCreepFixturePath = path.resolve(
    __dirname,
    '../fixtures/sanitized/search_radiohead_creep.json',
  );

  const radioheadData = JSON.parse(fs.readFileSync(radioheadFixturePath, 'utf-8'));
  const radioheadCreepData = JSON.parse(fs.readFileSync(radioheadCreepFixturePath, 'utf-8'));

  it('parses real recorded unfiltered search response correctly', () => {
    const parseRes = parseSearchResponse(radioheadData, 'Radiohead', 'all');
    expect(isOk(parseRes)).toBe(true);

    if (isOk(parseRes)) {
      const { items, parseDurationMs, responseSizeBytes } = parseRes.value;
      expect(items.length).toBeGreaterThan(10);
      expect(parseDurationMs).toBeGreaterThanOrEqual(0);
      expect(responseSizeBytes).toBeGreaterThan(100000);

      // Verify Top Result artist
      const artistItem = items.find((i) => i.type === 'artist');
      expect(artistItem).toBeDefined();
      if (artistItem && artistItem.type === 'artist') {
        expect(artistItem.artist.name).toBe('Radiohead');
        expect(artistItem.artist.id).toBe('UCr_iyUANcn9OX_yy9piYoLw');
        expect(artistItem.artist.thumbnails.length).toBeGreaterThan(0);
      }

      // Verify track items exist
      const trackItems = items.filter((i) => i.type === 'track');
      expect(trackItems.length).toBeGreaterThan(0);
      const firstTrack = trackItems[0];
      if (firstTrack && firstTrack.type === 'track') {
        expect(firstTrack.track.title).toBeTruthy();
        expect(firstTrack.track.id).toBeTruthy();
      }
    }
  });

  it('parses real recorded songs-filtered search response with titles and durations', () => {
    const parseRes = parseSearchResponse(radioheadCreepData, 'Radiohead Creep', 'songs');
    expect(isOk(parseRes)).toBe(true);

    if (isOk(parseRes)) {
      const { items } = parseRes.value;
      expect(items.length).toBeGreaterThan(15);

      const creepTrack = items.find((i) => i.type === 'track' && i.track.id === '9RfVp-GhKfs');
      expect(creepTrack).toBeDefined();

      if (creepTrack && creepTrack.type === 'track') {
        expect(creepTrack.track.title).toBe('Creep');
        expect(creepTrack.track.id).toBe('9RfVp-GhKfs');
        expect(creepTrack.track.durationSeconds).toBe(239); // 3:59
        expect(creepTrack.track.artists[0]?.name).toBe('Radiohead');
        expect(creepTrack.track.thumbnails.length).toBeGreaterThan(0);
      }
    }
  });

  it('executes InnertubeClient.search() end-to-end with MemoryHttpClient', async () => {
    const httpClient = new MemoryHttpClient();
    httpClient.whenPost(`${DEFAULT_INNERTUBE_CONFIG.baseUrl}/search`, radioheadCreepData);

    const client = new InnertubeClient({ httpClient });
    const searchRes = await client.search('Radiohead Creep', { filter: 'songs' });

    expect(isOk(searchRes)).toBe(true);
    if (isOk(searchRes)) {
      expect(searchRes.value.query).toBe('Radiohead Creep');
      expect(searchRes.value.filter).toBe('songs');
      expect(searchRes.value.items.length).toBeGreaterThan(0);
      expect(searchRes.value.parseDurationMs).toBeGreaterThanOrEqual(0);
      expect(searchRes.value.responseSizeBytes).toBeGreaterThan(0);
    }
  });

  it('retries automatically with backoff on transient 500 error', async () => {
    const httpClient = new MemoryHttpClient();
    let attempts = 0;

    httpClient.addHandler(`POST:${DEFAULT_INNERTUBE_CONFIG.baseUrl}/search`, () => {
      attempts++;
      if (attempts === 1) {
        return {
          status: 500,
          statusText: 'Internal Server Error',
          headers: {},
          data: { error: 'transient failure' },
          durationMs: 10,
        };
      }
      return {
        status: 200,
        statusText: 'OK',
        headers: {},
        data: radioheadCreepData,
        durationMs: 15,
      };
    });

    const client = new InnertubeClient({
      httpClient,
      config: { maxRetryAttempts: 2, retryInitialDelayMs: 10 },
    });

    const res = await client.search('Radiohead Creep');
    expect(isOk(res)).toBe(true);
    expect(attempts).toBe(2);
  });

  it('returns typed NetworkError without throwing on terminal 404', async () => {
    const httpClient = new MemoryHttpClient();
    // Default 404 returned for unhandled route
    const client = new InnertubeClient({ httpClient });
    const res = await client.search('Nonexistent');

    expect(isErr(res)).toBe(true);
    if (isErr(res)) {
      expect(res.error.name).toBe('NetworkError');
    }
  });

  it('degrades gracefully without throwing on unexpected or empty response shapes', () => {
    const emptyRes = parseSearchResponse({}, 'query', 'all');
    expect(isOk(emptyRes)).toBe(true);
    if (isOk(emptyRes)) {
      expect(emptyRes.value.items).toEqual([]);
    }

    const corruptedRes = parseSearchResponse(
      { contents: { tabbedSearchResultsRenderer: { tabs: [{ tabRenderer: { content: null } }] } } },
      'query',
      'all',
    );
    expect(isOk(corruptedRes)).toBe(true);
    if (isOk(corruptedRes)) {
      expect(corruptedRes.value.items).toEqual([]);
    }
  });
});
