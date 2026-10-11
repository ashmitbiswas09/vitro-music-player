/**
 * Strict contract tests over ALL sanitized fixtures and ALL parsers.
 *
 * Verifies:
 * 1. Type-specific ID shapes:
 *    - Track: 11-character videoId (/^[a-zA-Z0-9_-]{11}$/)
 *    - Artist: Starts with "UC" (/^UC[a-zA-Z0-9_-]{22}$/)
 *    - Album: Starts with "MPREb_" or "OLAK5uy_"
 *    - Playlist: Starts with "VL", "PL", or "RD"
 * 2. ID uniqueness within every response (zero collisions)
 * 3. Artist validity:
 *    - No track may have empty artists or "Unknown" / "Unknown Artist"
 *    - No separator tokens ("&", ",") parsed as artists
 * 4. Zero synthetic/invented IDs across all responses
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseSearchResponse,
  parseHomeResponse,
  parseAlbumResponse,
  parseArtistResponse,
  parsePlaylistResponse,
  parseNextResponse,
  parseContinuationResponse,
  parseSuggestionsResponse,
  isValidTrackId,
  isValidArtistId,
  isValidAlbumId,
  isValidPlaylistId,
} from '@/backend/innertube';

import type { Track, Artist, Album, Playlist } from '@/backend/core';
import type { SearchResultItem } from '@/backend/innertube';


function loadFixture(filename: string): unknown {
  const filepath = path.resolve(__dirname, `../fixtures/sanitized/${filename}`);
  return JSON.parse(fs.readFileSync(filepath, 'utf8'));
}

function assertValidTrack(track: Track, context: string): void {
  expect(isValidTrackId(track.id), `${context}: Invalid track ID shape "${track.id}"`).toBe(true);
  expect(track.id).toMatch(/^[a-zA-Z0-9_-]{11}$/);
  expect(track.title, `${context}: Empty title for track "${track.id}"`).toBeTruthy();

  expect(
    track.artists.length,
    `${context}: Track "${track.title}" (${track.id}) has no artists`,
  ).toBeGreaterThan(0);

  for (const artist of track.artists) {
    expect(artist.name, `${context}: Empty artist name on track "${track.title}"`).toBeTruthy();
    expect(
      artist.name,
      `${context}: Track "${track.title}" has forbidden placeholder artist "${artist.name}"`,
    ).not.toMatch(/^(Unknown|Unknown Artist|&|,)$/i);

    if (artist.id) {
      expect(
        isValidArtistId(artist.id),
        `${context}: Artist "${artist.name}" on track "${track.title}" has invalid ID "${artist.id}"`,
      ).toBe(true);
    }
  }

  if (track.album) {
    expect(track.album.title, `${context}: Empty album title on track "${track.title}"`).toBeTruthy();
    if (track.album.id) {
      expect(
        isValidAlbumId(track.album.id),
        `${context}: Album "${track.album.title}" on track "${track.title}" has invalid ID "${track.album.id}"`,
      ).toBe(true);
    }
  }
}

function assertValidArtist(artist: Artist, context: string): void {
  expect(
    isValidArtistId(artist.id),
    `${context}: Invalid artist ID shape "${artist.id}" for "${artist.name}"`,
  ).toBe(true);
  expect(artist.id.startsWith('UC'), `${context}: Artist ID must start with UC`).toBe(true);
  expect(artist.name, `${context}: Empty artist name`).toBeTruthy();
}

function assertValidAlbum(album: Album, context: string): void {
  expect(
    isValidAlbumId(album.id),
    `${context}: Invalid album ID shape "${album.id}" for "${album.title}"`,
  ).toBe(true);
  expect(
    album.id.startsWith('MPREb_') || album.id.startsWith('OLAK5uy_'),
    `${context}: Album ID must start with MPREb_ or OLAK5uy_`,
  ).toBe(true);
  expect(album.title, `${context}: Empty album title`).toBeTruthy();

  for (const artist of album.artists) {
    expect(artist.name).toBeTruthy();
    if (artist.id) {
      expect(isValidArtistId(artist.id)).toBe(true);
    }
  }
}

function assertValidPlaylist(playlist: Playlist, context: string): void {
  expect(
    isValidPlaylistId(playlist.id),
    `${context}: Invalid playlist ID shape "${playlist.id}" for "${playlist.title}"`,
  ).toBe(true);
  expect(
    playlist.id.startsWith('VL') || playlist.id.startsWith('PL') || playlist.id.startsWith('RD'),
    `${context}: Playlist ID must start with VL, PL, or RD`,
  ).toBe(true);
  expect(playlist.title, `${context}: Empty playlist title`).toBeTruthy();
}

function assertValidItem(item: SearchResultItem, context: string): string {
  switch (item.type) {
    case 'track':
      assertValidTrack(item.track, context);
      return item.track.id;
    case 'artist':
      assertValidArtist(item.artist, context);
      return item.artist.id;
    case 'album':
      assertValidAlbum(item.album, context);
      return item.album.id;
    case 'playlist':
      assertValidPlaylist(item.playlist, context);
      return item.playlist.id;
  }
}

function assertUniqueIds(ids: string[], context: string): void {
  const seen = new Set<string>();
  const duplicates: string[] = [];

  for (const id of ids) {
    if (seen.has(id)) {
      duplicates.push(id);
    }
    seen.add(id);
  }

  expect(
    duplicates,
    `${context}: Found duplicate IDs in response: ${duplicates.join(', ')}`,
  ).toHaveLength(0);
}

describe('Contract Tests: Strict ID Shapes, Real Artists & Zero Synthetic IDs', () => {
  it('search_radiohead.json (General unfiltered search)', () => {
    const raw = loadFixture('search_radiohead.json');
    const res = parseSearchResponse(raw, 'Radiohead', 'all');
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.value.items.length).toBeGreaterThan(10);
    const ids = res.value.items.map((item, i) =>
      assertValidItem(item, `search_radiohead[${i}]`),
    );
    assertUniqueIds(ids, 'search_radiohead');

    // Confirm real Radiohead artists on tracks
    const tracks = res.value.items.filter((i): i is { type: 'track'; track: Track } => i.type === 'track');
    expect(tracks.length).toBeGreaterThan(5);
    for (const t of tracks) {
      expect(t.track.artists[0]?.name).toBe('Radiohead');
      expect(t.track.artists[0]?.id).toBe('UCr_iyUANcn9OX_yy9piYoLw');
    }
  });

  it('search_radiohead_creep.json (Song filtered search)', () => {
    const raw = loadFixture('search_radiohead_creep.json');
    const res = parseSearchResponse(raw, 'Radiohead Creep', 'songs');
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.value.items.length).toBeGreaterThan(10);
    const ids = res.value.items.map((item, i) =>
      assertValidItem(item, `search_radiohead_creep[${i}]`),
    );
    assertUniqueIds(ids, 'search_radiohead_creep');
  });

  it('home_feed.json (Guest home feed shelves)', () => {
    const raw = loadFixture('home_feed.json');
    const res = parseHomeResponse(raw);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.value.sections.length).toBeGreaterThan(0);
    const allIds: string[] = [];

    for (const section of res.value.sections) {
      expect(section.title).toBeTruthy();
      for (let i = 0; i < section.items.length; i++) {
        const id = assertValidItem(section.items[i], `home_feed[${section.title}][${i}]`);
        allIds.push(id);
      }
    }

    assertUniqueIds(allIds, 'home_feed');
  });

  it('album_ok_computer.json (Album detail & tracklist)', () => {
    const albumId = 'MPREb_yXhSI4FCUo6';
    const raw = loadFixture('album_ok_computer.json');
    const res = parseAlbumResponse(raw, albumId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    assertValidAlbum(res.value.album, 'album_ok_computer');
    expect(res.value.album.id).toBe(albumId);
    expect(res.value.album.artists[0]?.name).toBe('Radiohead');

    expect(res.value.album.tracks?.length).toBe(12);
    const trackIds = (res.value.album.tracks ?? []).map((t, i) => {
      assertValidTrack(t, `album_ok_computer.tracks[${i}]`);
      expect(t.artists[0]?.name).toBe('Radiohead');
      expect(t.album?.id).toBe(albumId);
      return t.id;
    });

    assertUniqueIds(trackIds, 'album_ok_computer.tracks');
  });

  it('artist_radiohead.json (Artist detail & discography)', () => {
    const artistId = 'UCr_iyUANcn9OX_yy9piYoLw';
    const raw = loadFixture('artist_radiohead.json');
    const res = parseArtistResponse(raw, artistId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    assertValidArtist(res.value.artist, 'artist_radiohead');
    expect(res.value.artist.id).toBe(artistId);
    expect(res.value.artist.name).toBe('Radiohead');

    const allAlbumIds: string[] = [];
    for (let i = 0; i < res.value.albums.length; i++) {
      const album = res.value.albums[i];
      assertValidAlbum(album, `artist_radiohead.albums[${i}]`);
      allAlbumIds.push(album.id);
    }
    for (let i = 0; i < res.value.singles.length; i++) {
      const single = res.value.singles[i];
      assertValidAlbum(single, `artist_radiohead.singles[${i}]`);
      allAlbumIds.push(single.id);
    }
    assertUniqueIds(allAlbumIds, 'artist_radiohead.discography');
  });

  it('playlist_todays_hits.json (Playlist detail & tracks)', () => {
    const playlistId = 'PL4fGSI1pDJn49TUu37nJoN2QTeYuRwmNv';
    const raw = loadFixture('playlist_todays_hits.json');
    const res = parsePlaylistResponse(raw, playlistId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    assertValidPlaylist(res.value.playlist, 'playlist_todays_hits');
    expect(res.value.playlist.id).toBe(playlistId);

    const trackIds = (res.value.playlist.tracks ?? []).map((t, i) => {
      assertValidTrack(t, `playlist_todays_hits.tracks[${i}]`);
      return t.id;
    });
    expect(trackIds.length).toBeGreaterThan(10);
    assertUniqueIds(trackIds, 'playlist_todays_hits.tracks');
  });

  it('next_creep.json (Radio queue)', () => {
    const videoId = '9RfVp-GhKfs';
    const raw = loadFixture('next_creep.json');
    const res = parseNextResponse(raw, videoId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.value.queue.length).toBeGreaterThan(0);
    const trackIds = res.value.queue.map((t, i) => {
      assertValidTrack(t, `next_creep.queue[${i}]`);
      return t.id;
    });
    assertUniqueIds(trackIds, 'next_creep.queue');

    // Confirm real artist and album parsed without synthetic IDs or date/descriptor pollution
    const firstTrack = res.value.queue[0];
    expect(firstTrack.id).toBe(videoId);
    expect(firstTrack.title).toBe('Creep');
    expect(firstTrack.artists[0]?.name).toBe('Radiohead');
    expect(firstTrack.artists[0]?.id).toBe('UCr_iyUANcn9OX_yy9piYoLw');
    expect(firstTrack.album?.title).toBe('Creep');
    expect(firstTrack.album?.id).toBe('MPREb_TgQPwAzodvg');
  });

  it('continuation_playlist.json (Playlist continuation items)', () => {
    const raw = loadFixture('continuation_playlist.json');
    const res = parseContinuationResponse(raw);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.value.items.length).toBeGreaterThan(0);
    const ids = res.value.items.map((item, i) =>
      assertValidItem(item, `continuation_playlist[${i}]`),
    );
    assertUniqueIds(ids, 'continuation_playlist');
  });

  it('continuation_home.json (Home feed continuation shelves)', () => {
    const raw = loadFixture('continuation_home.json');
    const res = parseHomeResponse(raw);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.value.sections.length).toBeGreaterThan(0);
    const allIds: string[] = [];

    for (const section of res.value.sections) {
      expect(section.title).toBeTruthy();
      for (let i = 0; i < section.items.length; i++) {
        const id = assertValidItem(section.items[i], `continuation_home[${section.title}][${i}]`);
        allIds.push(id);
      }
    }

    assertUniqueIds(allIds, 'continuation_home');
  });

  it('continuation_next.json (Watch endpoint comment continuation degradation)', () => {
    const raw = loadFixture('continuation_next.json');
    const res = parseContinuationResponse(raw);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Comments continuation contains commentThreadRenderers, no music items
    // Parser must degrade gracefully with 0 items, never inventing synthetic music items
    expect(res.value.items).toEqual([]);
    expect(res.value.continuationToken).toBeUndefined();
  });

  it('suggest_radiohead.json (Search suggestions)', () => {
    const raw = loadFixture('suggest_radiohead.json');
    const res = parseSuggestionsResponse(raw, 'radiohead');
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.value.query).toBe('radiohead');
    expect(res.value.suggestions.length).toBeGreaterThanOrEqual(4);
    for (const s of res.value.suggestions) {
      expect(s).toBeTruthy();
      expect(typeof s).toBe('string');
      expect(s.length).toBeGreaterThan(0);
    }
  });
});

