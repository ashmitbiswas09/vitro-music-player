import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  InnertubeClient,
  parseSuggestionsResponse,
  parseHomeResponse,
  parseAlbumResponse,
  parseArtistResponse,
  parsePlaylistResponse,
  parseNextResponse,
  parseContinuationResponse,
} from '@/backend/innertube';
import { MemoryHttpClient } from '@/backend/platform';
import { isOk, isErr, DEFAULT_INNERTUBE_CONFIG } from '@/backend/core';

describe('Innertube Remaining Endpoints - Real Fixtures & Defensive Parsing', () => {
  const loadFixture = (name: string) => {
    const p = path.resolve(__dirname, `../fixtures/sanitized/${name}.json`);
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  };

  const suggestData = loadFixture('suggest_radiohead');
  const homeData = loadFixture('home_feed');
  const homeContData = loadFixture('continuation_home');
  const albumData = loadFixture('album_ok_computer');
  const artistData = loadFixture('artist_radiohead');
  const playlistData = loadFixture('playlist_todays_hits');
  const playlistContData = loadFixture('continuation_playlist');
  const nextData = loadFixture('next_creep');
  const nextContData = loadFixture('continuation_next');

  // 1. Suggestions
  describe('Search Suggestions', () => {
    it('parses real recorded search suggestions', () => {
      const res = parseSuggestionsResponse(suggestData, 'radiohead');
      expect(isOk(res)).toBe(true);
      if (isOk(res)) {
        expect(res.value.query).toBe('radiohead');
        expect(res.value.suggestions.length).toBeGreaterThanOrEqual(4);
        expect(res.value.suggestions.some((s) => s.toLowerCase().includes('radiohead'))).toBe(true);
        expect(res.value.parseDurationMs).toBeGreaterThanOrEqual(0);
        expect(res.value.responseSizeBytes).toBeGreaterThan(0);
      }
    });

    it('degrades gracefully on corrupted or empty suggestions payload', () => {
      const emptyRes = parseSuggestionsResponse({}, 'radiohead');
      expect(isOk(emptyRes)).toBe(true);
      if (isOk(emptyRes)) {
        expect(emptyRes.value.suggestions).toEqual([]);
      }
    });

    it('executes client.getSearchSuggestions() end-to-end with MemoryHttpClient', async () => {
      const httpClient = new MemoryHttpClient();
      httpClient.whenPost(
        `${DEFAULT_INNERTUBE_CONFIG.baseUrl}/music/get_search_suggestions`,
        suggestData,
      );
      const client = new InnertubeClient({ httpClient });
      const res = await client.getSearchSuggestions('radiohead');
      expect(isOk(res)).toBe(true);
      if (isOk(res)) {
        expect(res.value.suggestions.length).toBeGreaterThan(0);
      }
    });
  });

  // 2. Home Feed
  describe('Home Feed (Guest Browse)', () => {
    it('parses real recorded home feed sections, shelves, and continuation token', () => {
      const res = parseHomeResponse(homeData);
      expect(isOk(res)).toBe(true);
      if (isOk(res)) {
        expect(res.value.sections.length).toBeGreaterThanOrEqual(2);
        expect(res.value.continuationToken).toBeTruthy();
        expect(res.value.parseDurationMs).toBeGreaterThanOrEqual(0);

        const firstSec = res.value.sections[0];
        expect(firstSec.title).toBeTruthy();
        expect(firstSec.items.length).toBeGreaterThan(0);

        const firstItem = firstSec.items[0];
        expect(firstItem.type).toBeTruthy();
      }
    });

    it('parses real recorded home continuation feed', () => {
      const res = parseHomeResponse(homeContData);
      expect(isOk(res)).toBe(true);
      if (isOk(res)) {
        expect(res.value.sections.length).toBeGreaterThan(0);
      }
    });

    it('degrades gracefully on empty home response', () => {
      const res = parseHomeResponse({});
      expect(isOk(res)).toBe(true);
      if (isOk(res)) {
        expect(res.value.sections).toEqual([]);
        expect(res.value.continuationToken).toBeUndefined();
      }
    });

    it('executes client.getHome() end-to-end with MemoryHttpClient', async () => {
      const httpClient = new MemoryHttpClient();
      httpClient.whenPost(`${DEFAULT_INNERTUBE_CONFIG.baseUrl}/browse`, homeData);
      const client = new InnertubeClient({ httpClient });
      const res = await client.getHome();
      expect(isOk(res)).toBe(true);
      if (isOk(res)) {
        expect(res.value.sections.length).toBeGreaterThan(0);
      }
    });
  });

  // 3. Album
  describe('Album Browse', () => {
    it('parses real recorded album metadata, tracks, durations, and artists', () => {
      const res = parseAlbumResponse(albumData, 'MPREb_yXhSI4FCUo6');
      expect(isOk(res)).toBe(true);
      if (isOk(res)) {
        const { album } = res.value;
        expect(album.id).toBe('MPREb_yXhSI4FCUo6');
        expect(album.title).toBe('OK Computer');
        expect(album.artists[0]?.name).toBe('Radiohead');
        expect(album.year).toBe(1997);
        expect(album.tracks?.length).toBe(12);

        const firstTrack = album.tracks?.[0];
        expect(firstTrack?.title).toBe('Airbag');
        expect(firstTrack?.id).toBe('jNY_wLukVW0');
        expect(firstTrack?.durationSeconds).toBe(288); // 4:48
        expect(firstTrack?.artists[0]?.name).toBe('Radiohead');
      }
    });

    it('degrades gracefully on missing tracks or malformed album data', () => {
      const res = parseAlbumResponse({}, 'fallback-id');
      expect(isOk(res)).toBe(true);
      if (isOk(res)) {
        expect(res.value.album.id).toBe('fallback-id');
        expect(res.value.album.tracks).toEqual([]);
      }
    });

    it('executes client.getAlbum() end-to-end with MemoryHttpClient', async () => {
      const httpClient = new MemoryHttpClient();
      httpClient.whenPost(`${DEFAULT_INNERTUBE_CONFIG.baseUrl}/browse`, albumData);
      const client = new InnertubeClient({ httpClient });
      const res = await client.getAlbum('MPREb_yXhSI4FCUo6');
      expect(isOk(res)).toBe(true);
      if (isOk(res)) {
        expect(res.value.album.title).toBe('OK Computer');
      }
    });
  });

  // 4. Artist
  describe('Artist Browse', () => {
    it('parses real recorded artist profile, top tracks, albums, and description', () => {
      const res = parseArtistResponse(artistData, 'UCr_iyUANcn9OX_yy9piYoLw');
      expect(isOk(res)).toBe(true);
      if (isOk(res)) {
        const { artist, albums, singles } = res.value;
        expect(artist.id).toBe('UCr_iyUANcn9OX_yy9piYoLw');
        expect(artist.name).toBe('Radiohead');
        expect(artist.thumbnails.length).toBeGreaterThan(0);
        expect(artist.topTracks?.length).toBeGreaterThan(0);

        const topTrack = artist.topTracks?.[0];
        expect(topTrack?.title).toBeTruthy();
        expect(topTrack?.id).toBeTruthy();

        expect(albums.length).toBeGreaterThan(0);
        expect(albums[0]?.title).toBeTruthy();
        expect(singles.length).toBeGreaterThan(0);
      }
    });

    it('degrades gracefully on missing artist sections', () => {
      const res = parseArtistResponse({}, 'artist-id');
      expect(isOk(res)).toBe(true);
      if (isOk(res)) {
        expect(res.value.artist.id).toBe('artist-id');
        expect(res.value.albums).toEqual([]);
        expect(res.value.singles).toEqual([]);
      }
    });

    it('executes client.getArtist() end-to-end with MemoryHttpClient', async () => {
      const httpClient = new MemoryHttpClient();
      httpClient.whenPost(`${DEFAULT_INNERTUBE_CONFIG.baseUrl}/browse`, artistData);
      const client = new InnertubeClient({ httpClient });
      const res = await client.getArtist('UCr_iyUANcn9OX_yy9piYoLw');
      expect(isOk(res)).toBe(true);
      if (isOk(res)) {
        expect(res.value.artist.name).toBe('Radiohead');
      }
    });
  });

  // 5. Playlist
  describe('Playlist Browse', () => {
    it('parses real recorded playlist metadata, tracks, and titles', () => {
      const res = parsePlaylistResponse(playlistData, 'VLPL4fGSI1pDJn6O1LS0XSdF3RyO0Rq_LDeI');
      expect(isOk(res)).toBe(true);
      if (isOk(res)) {
        const { playlist } = res.value;
        expect(playlist.title).toBeTruthy();
        expect(playlist.tracks?.length).toBe(100);

        const firstTrack = playlist.tracks?.[0];
        expect(firstTrack?.title).toBeTruthy();
        expect(firstTrack?.id).toBeTruthy();
        expect(firstTrack?.durationSeconds).toBeGreaterThan(0);
      }
    });

    it('degrades gracefully on missing playlist header or contents', () => {
      const res = parsePlaylistResponse({}, 'pl-id');
      expect(isOk(res)).toBe(true);
      if (isOk(res)) {
        expect(res.value.playlist.id).toBe('pl-id');
        expect(res.value.playlist.tracks).toEqual([]);
      }
    });

    it('executes client.getPlaylist() end-to-end with MemoryHttpClient', async () => {
      const httpClient = new MemoryHttpClient();
      httpClient.whenPost(`${DEFAULT_INNERTUBE_CONFIG.baseUrl}/browse`, playlistData);
      const client = new InnertubeClient({ httpClient });
      const res = await client.getPlaylist('PL4fGSI1pDJn6O1LS0XSdF3RyO0Rq_LDeI');
      expect(isOk(res)).toBe(true);
      if (isOk(res)) {
        expect(res.value.playlist.tracks?.length).toBeGreaterThan(0);
      }
    });
  });

  // 6. Next (Queue / Radio)
  describe('Next Endpoint (Queue / Radio)', () => {
    it('parses real recorded next response, queue tracks, and current playing track', () => {
      const res = parseNextResponse(nextData, '9RfVp-GhKfs');
      expect(isOk(res)).toBe(true);
      if (isOk(res)) {
        expect(res.value.queue.length).toBeGreaterThan(0);
        expect(res.value.currentTrack?.title).toBe('Creep');
        expect(res.value.currentTrack?.id).toBe('9RfVp-GhKfs');
      }
    });

    it('degrades gracefully on empty next response', () => {
      const res = parseNextResponse({}, 'fallback-id');
      expect(isOk(res)).toBe(true);
      if (isOk(res)) {
        expect(res.value.queue).toEqual([]);
        expect(res.value.currentTrack).toBeUndefined();
      }
    });

    it('executes client.getNext() end-to-end with MemoryHttpClient', async () => {
      const httpClient = new MemoryHttpClient();
      httpClient.whenPost(`${DEFAULT_INNERTUBE_CONFIG.baseUrl}/next`, nextData);
      const client = new InnertubeClient({ httpClient });
      const res = await client.getNext('9RfVp-GhKfs');
      expect(isOk(res)).toBe(true);
      if (isOk(res)) {
        expect(res.value.queue.length).toBeGreaterThan(0);
      }
    });
  });

  // 7. Continuations
  describe('Paginated Continuations', () => {
    it('parses playlist continuation items and next token', () => {
      const res = parseContinuationResponse(playlistContData);
      expect(isOk(res)).toBe(true);
      if (isOk(res)) {
        expect(res.value.items.length).toBe(100);
        expect(res.value.items[0]?.type).toBe('track');
      }
    });

    it('parses queue continuation tracks from playlistPanelContinuation', () => {
      const mockQueueCont = {
        continuationContents: {
          playlistPanelContinuation: {
            contents: [
              {
                playlistPanelVideoRenderer: {
                  videoId: 'dQw4w9WgXcQ',
                  title: { runs: [{ text: 'Next Song' }] },
                  longBylineText: { runs: [{ text: 'Next Artist' }] },
                  lengthText: { runs: [{ text: '3:30' }] },
                },
              },
            ],
            continuations: [
              {
                nextRadioContinuationData: {
                  continuation: 'next-radio-token',
                },
              },
            ],
          },
        },
      };
      const res = parseContinuationResponse(mockQueueCont);
      expect(isOk(res)).toBe(true);
      if (isOk(res)) {
        expect(res.value.items.length).toBe(1);
        expect(res.value.items[0]?.type).toBe('track');
        if (res.value.items[0]?.type === 'track') {
          expect(res.value.items[0].track.title).toBe('Next Song');
          expect(res.value.items[0].track.id).toBe('dQw4w9WgXcQ');
        }
        expect(res.value.continuationToken).toBe('next-radio-token');
      }
    });

    it('degrades gracefully on non-music continuation responses like comments', () => {
      const res = parseContinuationResponse(nextContData);
      expect(isOk(res)).toBe(true);
      if (isOk(res)) {
        expect(res.value.items).toEqual([]);
      }
    });

    it('executes client.getContinuation() end-to-end with MemoryHttpClient', async () => {
      const httpClient = new MemoryHttpClient();
      httpClient.whenPost(`${DEFAULT_INNERTUBE_CONFIG.baseUrl}/browse`, playlistContData);
      const client = new InnertubeClient({ httpClient });
      const res = await client.getContinuation('sample-token');
      expect(isOk(res)).toBe(true);
      if (isOk(res)) {
        expect(res.value.items.length).toBeGreaterThan(0);
      }
    });
  });

  // 8. Error Handling
  describe('Error Handling', () => {
    it('returns typed NetworkError without throwing on 404 or unhandled path', async () => {
      const httpClient = new MemoryHttpClient();
      const client = new InnertubeClient({ httpClient });
      const res = await client.getAlbum('nonexistent-album');
      expect(isErr(res)).toBe(true);
      if (isErr(res)) {
        expect(res.error.name).toBe('NetworkError');
      }
    });
  });
});
