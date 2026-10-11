/**
 * Defensive parser for YouTube Music Playlists.
 */

import { z } from 'zod';
import { ok, type Result, type AppError, type Track, type Playlist, perf } from '@/backend/core';
import type { PlaylistDetailResponse } from '../types';
import { runsToText, parseDuration, extractThumbnails, extractVideoId } from './parser-utils';

const ResponsiveHeaderSchema = z.object({
  title: z.object({ runs: z.array(z.object({ text: z.string() })).optional() }).optional(),
  straplineTextOne: z.object({ runs: z.array(z.object({ text: z.string() })).optional() }).optional(),
  description: z.object({ runs: z.array(z.object({ text: z.string() })).optional() }).optional(),
  secondSubtitle: z.object({ runs: z.array(z.object({ text: z.string() })).optional() }).optional(),
  thumbnail: z.unknown().optional(),
});

export function parsePlaylistResponse(
  rawBody: unknown,
  playlistId: string,
): Result<PlaylistDetailResponse, AppError> {
  const { result: playlist, durationMs } = perf.measureSync('ParsePlaylist', () => {
    if (!rawBody || typeof rawBody !== 'object') {
      return {
        id: playlistId,
        title: 'Unknown Playlist',
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

    const headerRecord = data.header as Record<string, unknown> | undefined;
    const editableHeader = headerRecord?.musicEditablePlaylistDetailHeaderRenderer as
      | Record<string, unknown>
      | undefined;
    const editableInnerHeader = editableHeader?.header as Record<string, unknown> | undefined;

    const headerRenderer =
      (headerObj as Record<string, unknown> | undefined)?.musicResponsiveHeaderRenderer ??
      headerRecord?.musicDetailHeaderRenderer ??
      headerRecord?.musicResponsiveHeaderRenderer ??
      editableInnerHeader?.musicResponsiveHeaderRenderer;

    let playlistTitle = 'Unknown Playlist';
    let author: string | undefined;
    let description: string | undefined;
    let trackCount: number | undefined;
    let thumbnails = extractThumbnails(data.header ?? headerObj);

    if (headerRenderer) {
      const parsedHeader = ResponsiveHeaderSchema.safeParse(headerRenderer);
      if (parsedHeader.success) {
        const { title, straplineTextOne, description: descObj, secondSubtitle, thumbnail } = parsedHeader.data;
        if (title?.runs) {
          playlistTitle = runsToText(title.runs) || playlistTitle;
        }
        if (straplineTextOne?.runs) {
          author = runsToText(straplineTextOne.runs);
        }
        if (descObj?.runs) {
          description = runsToText(descObj.runs);
        }
        if (secondSubtitle?.runs) {
          const subText = runsToText(secondSubtitle.runs);
          const countMatch = subText.match(/(\d+[\d,]*)\s+song/i);
          if (countMatch) {
            trackCount = Number.parseInt(countMatch[1].replace(/,/g, ''), 10);
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

    // 2. Tracks parsing
    const tracks: Track[] = [];
    const secondaryContents = twoCol?.secondaryContents as Record<string, unknown> | undefined;
    const secondarySecList = secondaryContents?.sectionListRenderer as
      | Record<string, unknown>
      | undefined;
    const shelf = (secondarySecList?.contents as unknown[])?.[0] as Record<string, unknown> | undefined;
    const musicShelf = shelf?.musicShelfRenderer as Record<string, unknown> | undefined
      ?? (shelf?.musicPlaylistShelfRenderer as Record<string, unknown> | undefined);

    let continuationToken: string | undefined;

    if (musicShelf) {
      if (Array.isArray(musicShelf.contents)) {
        for (const rawItem of musicShelf.contents) {
          if (!rawItem || typeof rawItem !== 'object') continue;
          const item = (rawItem as Record<string, unknown>).musicResponsiveListItemRenderer as
            | Record<string, unknown>
            | undefined;
          if (!item) continue;

          const flexCols = item.flexColumns as unknown[];
          const fixedCols = item.fixedColumns as unknown[];

          // Title
          const titleCol = (flexCols?.[0] as Record<string, unknown> | undefined)
            ?.musicResponsiveListItemFlexColumnRenderer as Record<string, unknown> | undefined;
          const title = runsToText((titleCol?.text as Record<string, unknown> | undefined)?.runs);

          // Artists
          const artistCol = (flexCols?.[1] as Record<string, unknown> | undefined)
            ?.musicResponsiveListItemFlexColumnRenderer as Record<string, unknown> | undefined;
          const artistRuns = (artistCol?.text as Record<string, unknown> | undefined)?.runs as unknown[];
          const itemArtists: { name: string }[] = [];
          if (Array.isArray(artistRuns)) {
            for (const ar of artistRuns) {
              const text = (ar as { text?: string })?.text?.trim();
              if (text && text !== '•' && !text.match(/^\d+:\d+$/)) {
                itemArtists.push({ name: text });
              }
            }
          }

          // Duration
          const durCol = (fixedCols?.[0] as Record<string, unknown> | undefined)
            ?.musicResponsiveListItemFixedColumnRenderer as Record<string, unknown> | undefined;
          let durText = runsToText((durCol?.text as Record<string, unknown> | undefined)?.runs);
          if (!durText && Array.isArray(artistRuns)) {
            const timeRun = artistRuns.find((r) => (r as { text?: string })?.text?.match(/^\d+:\d+$/));
            if (timeRun) durText = (timeRun as { text: string }).text;
          }
          const durationSeconds = parseDuration(durText);

          // Video ID
          const videoId =
            extractVideoId(item.overlay) ??
            extractVideoId(item.navigationEndpoint) ??
            extractVideoId(titleCol);

          const itemThumbs = extractThumbnails(item.thumbnail) ?? thumbnails;

          if (title && videoId) {
            tracks.push({
              id: videoId,
              title,
              artists: itemArtists.length > 0 ? itemArtists : (author ? [{ name: author }] : []),
              durationSeconds,
              thumbnails: itemThumbs,
            });
          }
        }
      }

      // Continuation token
      const continuations = musicShelf.continuations as unknown[];
      if (Array.isArray(continuations) && continuations.length > 0) {
        const nextData = (continuations[0] as Record<string, unknown>)?.nextContinuationData as
          | Record<string, unknown>
          | undefined;
        if (typeof nextData?.continuation === 'string') {
          continuationToken = nextData.continuation;
        }
      }
    }

    const result: Playlist = {
      id: playlistId,
      title: playlistTitle,
      author,
      description,
      trackCount: trackCount ?? tracks.length,
      thumbnails,
      tracks,
      continuationToken,
    };

    return result;
  });

  const responseSizeBytes = JSON.stringify(rawBody).length;

  return ok({
    playlist,
    parseDurationMs: durationMs,
    responseSizeBytes,
  });
}
