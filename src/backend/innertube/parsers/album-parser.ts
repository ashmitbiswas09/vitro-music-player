/**
 * Defensive parser for YouTube Music Album responses.
 */

import { z } from 'zod';
import { ok, type Result, type AppError, type Track, type Album, perf } from '@/backend/core';
import type { AlbumDetailResponse } from '../types';
import {
  runsToText,
  parseDuration,
  extractThumbnails,
  extractVideoId,
  isValidTrackId,
  isValidArtistId,
} from './parser-utils';

const ResponsiveHeaderSchema = z.object({
  title: z.object({ runs: z.array(z.object({ text: z.string() })).optional() }).optional(),
  straplineTextOne: z
    .object({
      runs: z
        .array(
          z.object({
            text: z.string(),
            navigationEndpoint: z
              .object({
                browseEndpoint: z
                  .object({
                    browseId: z.string().optional(),
                  })
                  .optional(),
              })
              .optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  subtitle: z.object({ runs: z.array(z.object({ text: z.string() })).optional() }).optional(),
  secondSubtitle: z.object({ runs: z.array(z.object({ text: z.string() })).optional() }).optional(),
  thumbnail: z.unknown().optional(),
});


export function parseAlbumResponse(
  rawBody: unknown,
  albumId: string,
): Result<AlbumDetailResponse, AppError> {
  const { result: album, durationMs } = perf.measureSync('ParseAlbum', () => {
    if (!rawBody || typeof rawBody !== 'object') {
      return {
        id: albumId,
        title: 'Unknown Album',
        artists: [],
        thumbnails: [],
        tracks: [],
      };
    }

    const data = rawBody as Record<string, unknown>;
    const contents = data.contents as Record<string, unknown> | undefined;
    const twoCol = contents?.twoColumnBrowseResultsRenderer as Record<string, unknown> | undefined;

    // 1. Header parsing
    let headerObj: unknown;
    if (twoCol?.tabs && Array.isArray(twoCol.tabs)) {
      const tabContent = (twoCol.tabs[0] as Record<string, unknown>)?.tabRenderer as
        | Record<string, unknown>
        | undefined;
      const secList = (tabContent?.content as Record<string, unknown> | undefined)?.sectionListRenderer as
        | Record<string, unknown>
        | undefined;
      headerObj = (secList?.contents as unknown[])?.[0] as Record<string, unknown> | undefined;
    }

    const headerRenderer =
      (headerObj as Record<string, unknown> | undefined)?.musicResponsiveHeaderRenderer ??
      (data.header as Record<string, unknown> | undefined)?.musicDetailHeaderRenderer ??
      (data.header as Record<string, unknown> | undefined)?.musicResponsiveHeaderRenderer;

    let albumTitle = 'Unknown Album';
    const albumArtists: { id?: string; name: string }[] = [];
    let albumYear: number | undefined;

    let thumbnails = extractThumbnails(data.header ?? headerObj);

    if (headerRenderer) {
      const parsedHeader = ResponsiveHeaderSchema.safeParse(headerRenderer);
      if (parsedHeader.success) {
        const { title, straplineTextOne, subtitle, thumbnail } = parsedHeader.data;
        if (title?.runs) {
          albumTitle = runsToText(title.runs) || albumTitle;
        }
        if (straplineTextOne?.runs) {
          for (const r of straplineTextOne.runs) {
            const artistName = r.text.trim();
            if (artistName && artistName !== '•' && artistName !== '&' && artistName !== ',') {
              const browseId = r.navigationEndpoint?.browseEndpoint?.browseId;
              albumArtists.push({
                id: browseId && isValidArtistId(browseId) ? browseId : undefined,
                name: artistName,
              });
            }
          }
        }
        if (subtitle?.runs) {
          const subText = runsToText(subtitle.runs);
          const yearMatch = subText.match(/\b(19\d\d|20\d\d)\b/);
          if (yearMatch) {
            albumYear = Number.parseInt(yearMatch[1], 10);
          }
        }
        if (thumbnail) {
          const thumbs = extractThumbnails(thumbnail);
          if (thumbs.length > 0) {
            thumbnails = thumbs;
          }
        }
      }
    }

    // Also check microformat if title still unknown
    if (albumTitle === 'Unknown Album' && data.microformat) {
      const micro = (data.microformat as Record<string, unknown>)?.microformatDataRenderer as
        | Record<string, unknown>
        | undefined;
      if (typeof micro?.title === 'string') {
        albumTitle = micro.title;
      }
    }

    // 2. Tracklist parsing
    const tracks: Track[] = [];
    const secondaryContents = twoCol?.secondaryContents as Record<string, unknown> | undefined;
    const secondarySecList = secondaryContents?.sectionListRenderer as
      | Record<string, unknown>
      | undefined;
    const shelf = (secondarySecList?.contents as unknown[])?.[0] as Record<string, unknown> | undefined;
    const musicShelf = shelf?.musicShelfRenderer as Record<string, unknown> | undefined;

    if (musicShelf && Array.isArray(musicShelf.contents)) {
      for (const rawItem of musicShelf.contents) {
        if (!rawItem || typeof rawItem !== 'object') continue;
        const item = (rawItem as Record<string, unknown>).musicResponsiveListItemRenderer as
          | Record<string, unknown>
          | undefined;
        if (!item) continue;

        const flexCols = item.flexColumns as unknown[];
        const fixedCols = item.fixedColumns as unknown[];

        // Flex Col 0: Title
        const titleCol = (flexCols?.[0] as Record<string, unknown> | undefined)
          ?.musicResponsiveListItemFlexColumnRenderer as Record<string, unknown> | undefined;
        const title = runsToText((titleCol?.text as Record<string, unknown> | undefined)?.runs);

        // Fixed Col 0 or Col 1: Duration
        const durCol = (fixedCols?.[0] as Record<string, unknown> | undefined)
          ?.musicResponsiveListItemFixedColumnRenderer as Record<string, unknown> | undefined;
        const durText = runsToText((durCol?.text as Record<string, unknown> | undefined)?.runs);
        const durationSeconds = parseDuration(durText);

        // Video ID
        const videoId =
          extractVideoId(item.overlay) ??
          extractVideoId(item.navigationEndpoint) ??
          extractVideoId(titleCol);

        if (title && videoId && isValidTrackId(videoId)) {
          tracks.push({
            id: videoId,
            title,
            artists: albumArtists,
            album: { id: albumId, title: albumTitle },
            durationSeconds,
            thumbnails,
          });
        }
      }
    }

    const result: Album = {
      id: albumId,
      title: albumTitle,
      artists: albumArtists,
      year: albumYear,
      thumbnails,
      trackCount: tracks.length,
      tracks,
    };

    return result;
  });

  const responseSizeBytes = JSON.stringify(rawBody).length;

  return ok({
    album,
    parseDurationMs: durationMs,
    responseSizeBytes,
  });
}
