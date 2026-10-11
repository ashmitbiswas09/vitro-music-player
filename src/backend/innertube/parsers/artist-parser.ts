/**
 * Defensive parser for YouTube Music Artist profiles.
 */

import { z } from 'zod';
import { ok, type Result, type AppError, type Track, type Artist, type Album, perf } from '@/backend/core';
import type { ArtistDetailResponse } from '../types';
import {
  runsToText,
  parseDuration,
  extractThumbnails,
  extractVideoId,
  extractBrowseId,
  isValidTrackId,
  isValidAlbumId,
} from './parser-utils';

const ImmersiveHeaderSchema = z.object({
  title: z.object({ runs: z.array(z.object({ text: z.string() })).optional() }).optional(),
  description: z.object({ runs: z.array(z.object({ text: z.string() })).optional() }).optional(),
  thumbnail: z.unknown().optional(),
});

export function parseArtistResponse(
  rawBody: unknown,
  artistId: string,
): Result<ArtistDetailResponse, AppError> {
  const { result: dataParsed, durationMs } = perf.measureSync('ParseArtist', () => {
    if (!rawBody || typeof rawBody !== 'object') {
      return {
        artist: { id: artistId, name: 'Unknown Artist', thumbnails: [] },
        albums: [],
        singles: [],
      };
    }

    const data = rawBody as Record<string, unknown>;
    const header = (data.header as Record<string, unknown> | undefined)?.musicImmersiveHeaderRenderer
      ?? (data.header as Record<string, unknown> | undefined)?.musicVisualHeaderRenderer;

    let artistName = 'Unknown Artist';
    let artistDescription: string | undefined;
    let thumbnails = extractThumbnails(data.header);

    if (header) {
      const parsedHeader = ImmersiveHeaderSchema.safeParse(header);
      if (parsedHeader.success) {
        if (parsedHeader.data.title?.runs) {
          artistName = runsToText(parsedHeader.data.title.runs) || artistName;
        }
        if (parsedHeader.data.description?.runs) {
          artistDescription = runsToText(parsedHeader.data.description.runs);
        }
        if (parsedHeader.data.thumbnail) {
          const thumbs = extractThumbnails(parsedHeader.data.thumbnail);
          if (thumbs.length > 0) {
            thumbnails = thumbs;
          }
        }
      }
    }

    const topTracks: Track[] = [];
    const albums: Album[] = [];
    const singles: Album[] = [];

    const contents = data.contents as Record<string, unknown> | undefined;
    const singleCol = contents?.singleColumnBrowseResultsRenderer as Record<string, unknown> | undefined;
    const tabs = singleCol?.tabs as unknown[];
    const firstTab = tabs?.[0] as Record<string, unknown> | undefined;
    const tabContent = firstTab?.tabRenderer as Record<string, unknown> | undefined;
    const secList = (tabContent?.content as Record<string, unknown> | undefined)?.sectionListRenderer as
      | Record<string, unknown>
      | undefined;

    const sections = secList?.contents as unknown[];
    if (Array.isArray(sections)) {
      for (const rawSec of sections) {
        if (!rawSec || typeof rawSec !== 'object') continue;
        const sec = rawSec as Record<string, unknown>;

        // 1. Top Songs shelf
        const musicShelf = sec.musicShelfRenderer as Record<string, unknown> | undefined;
        if (musicShelf) {
          const shelfTitle = runsToText((musicShelf.title as Record<string, unknown> | undefined)?.runs).toLowerCase();
          if (shelfTitle.includes('song') || shelfTitle.includes('popular') || topTracks.length === 0) {
            if (Array.isArray(musicShelf.contents)) {
              for (const rawItem of musicShelf.contents) {
                const item = (rawItem as Record<string, unknown>).musicResponsiveListItemRenderer as
                  | Record<string, unknown>
                  | undefined;
                if (!item) continue;

                const flexCols = item.flexColumns as unknown[];
                const titleCol = (flexCols?.[0] as Record<string, unknown> | undefined)
                  ?.musicResponsiveListItemFlexColumnRenderer as Record<string, unknown> | undefined;
                const title = runsToText((titleCol?.text as Record<string, unknown> | undefined)?.runs);

                const fixedCols = item.fixedColumns as unknown[];
                const durCol = (fixedCols?.[0] as Record<string, unknown> | undefined)
                  ?.musicResponsiveListItemFixedColumnRenderer as Record<string, unknown> | undefined;
                const durText = runsToText((durCol?.text as Record<string, unknown> | undefined)?.runs);
                const durationSeconds = parseDuration(durText);

                const videoId =
                  extractVideoId(item.overlay) ??
                  extractVideoId(item.navigationEndpoint) ??
                  extractVideoId(titleCol);

                const itemThumbs = extractThumbnails(item.thumbnail) ?? thumbnails;

                if (title && videoId && isValidTrackId(videoId)) {
                  topTracks.push({
                    id: videoId,
                    title,
                    artists: [{ id: artistId, name: artistName }],
                    durationSeconds,
                    thumbnails: itemThumbs,
                  });
                }
              }
            }
          }
        }

        // 2. Albums / Singles carousel shelves
        const carousel = sec.musicCarouselShelfRenderer as Record<string, unknown> | undefined;
        if (carousel) {
          const cHeader = carousel.header as Record<string, unknown> | undefined;
          const basicHeader = cHeader?.musicCarouselShelfBasicHeaderRenderer as Record<string, unknown> | undefined;
          const shelfTitle = runsToText((basicHeader?.title as Record<string, unknown> | undefined)?.runs).toLowerCase();

          const targetList = shelfTitle.includes('single') || shelfTitle.includes('ep') ? singles : albums;

          if (Array.isArray(carousel.contents)) {
            for (const rawCard of carousel.contents) {
              const card = (rawCard as Record<string, unknown>).musicTwoRowItemRenderer as
                | Record<string, unknown>
                | undefined;
              if (!card) continue;

              const title = runsToText((card.title as Record<string, unknown> | undefined)?.runs);
              const subtitle = runsToText((card.subtitle as Record<string, unknown> | undefined)?.runs);
              const browseId = extractBrowseId(card.navigationEndpoint);
              const cardThumbs = extractThumbnails(card.thumbnailRenderer);

              const yearMatch = subtitle.match(/\b(19\d\d|20\d\d)\b/);
              const year = yearMatch ? Number.parseInt(yearMatch[1], 10) : undefined;

              if (title && browseId && isValidAlbumId(browseId)) {
                targetList.push({
                  id: browseId,
                  title,
                  artists: [{ id: artistId, name: artistName }],
                  year,
                  thumbnails: cardThumbs,
                });
              }
            }
          }
        }

        // 3. Description shelf (if not found in header)
        if (!artistDescription && sec.musicDescriptionShelfRenderer) {
          const descShelf = sec.musicDescriptionShelfRenderer as Record<string, unknown>;
          const desc = runsToText((descShelf.description as Record<string, unknown> | undefined)?.runs);
          if (desc) {
            artistDescription = desc;
          }
        }
      }
    }

    const artist: Artist = {
      id: artistId,
      name: artistName,
      thumbnails,
      description: artistDescription,
      topTracks,
    };

    return { artist, albums, singles };
  });

  const responseSizeBytes = JSON.stringify(rawBody).length;

  return ok({
    artist: dataParsed.artist,
    albums: dataParsed.albums,
    singles: dataParsed.singles,
    parseDurationMs: durationMs,
    responseSizeBytes,
  });
}
