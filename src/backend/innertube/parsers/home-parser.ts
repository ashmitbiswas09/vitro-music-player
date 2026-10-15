/**
 * Defensive parser for YouTube Music Home / Browse feed and continuations.
 */

import { z } from 'zod';
import { ok, type Result, type AppError, perf, createLogger } from '@/backend/core';
import type { HomeFeedResponse, HomeSection, SearchResultItem } from '../types';
import {
  runsToText,
  extractThumbnails,
  extractVideoId,
  extractBrowseId,
  isValidTrackId,
  isValidArtistId,
  isValidAlbumId,
  isValidPlaylistId,
} from './parser-utils';

const logger = createLogger({ prefix: 'HomeParser' });

const TwoRowItemSchema = z.object({
  title: z
    .object({
      runs: z.array(z.object({ text: z.string() })).optional(),
    })
    .optional(),
  subtitle: z
    .object({
      runs: z.array(z.object({ text: z.string() })).optional(),
    })
    .optional(),
  thumbnailRenderer: z.unknown().optional(),
  navigationEndpoint: z.unknown().optional(),
  thumbnailOverlay: z.unknown().optional(),
});

function parseCardItem(raw: unknown, onDrop?: (reason: string) => void): SearchResultItem | null {
  if (!raw || typeof raw !== 'object') {
    onDrop?.('not_an_object');
    return null;
  }
  const item = raw as Record<string, unknown>;

  const twoRow = item.musicTwoRowItemRenderer;
  if (twoRow) {
    const parsed = TwoRowItemSchema.safeParse(twoRow);
    if (!parsed.success) {
      onDrop?.('schema_validation_failed');
      return null;
    }
    const { title: titleObj, subtitle: subtitleObj, thumbnailRenderer, navigationEndpoint, thumbnailOverlay } = parsed.data;

    const title = runsToText(titleObj?.runs);
    if (!title) {
      onDrop?.('missing_title');
      return null;
    }

    const subtitle = runsToText(subtitleObj?.runs);
    const thumbnails = extractThumbnails(thumbnailRenderer);
    const videoId = extractVideoId(navigationEndpoint) ?? extractVideoId(thumbnailOverlay);
    const browseId = extractBrowseId(navigationEndpoint);

    if (browseId) {
      if (isValidAlbumId(browseId)) {
        return {
          type: 'album',
          album: {
            id: browseId,
            title,
            artists: subtitle ? [{ name: subtitle }] : [],
            thumbnails,
          },
        };
      }
      if (isValidPlaylistId(browseId)) {
        return {
          type: 'playlist',
          playlist: {
            id: browseId,
            title,
            author: subtitle,
            thumbnails,
          },
        };
      }
      if (isValidArtistId(browseId)) {
        return {
          type: 'artist',
          artist: {
            id: browseId,
            name: title,
            thumbnails,
          },
        };
      }
    }

    if (videoId && isValidTrackId(videoId)) {
      return {
        type: 'track',
        track: {
          id: videoId,
          title,
          artists: subtitle ? [{ name: subtitle }] : [],
          thumbnails,
        },
      };
    }

    onDrop?.('unrecognized_item_type');
    return null;
  }

  onDrop?.('unsupported_renderer');
  return null;
}

export function parseHomeResponse(rawBody: unknown): Result<HomeFeedResponse, AppError> {
  const dropCounts: Record<string, number> = {};
  const recordDrop = (reason: string) => {
    dropCounts[reason] = (dropCounts[reason] ?? 0) + 1;
  };

  const { result: parsedData, durationMs } = perf.measureSync('ParseHomeFeed', () => {
    if (!rawBody || typeof rawBody !== 'object') {
      return { sections: [], continuationToken: undefined };
    }

    const data = rawBody as Record<string, unknown>;
    const contents = data.contents as Record<string, unknown> | undefined;

    // Single column browse results (Desktop/Mobile web Home)
    const singleCol = contents?.singleColumnBrowseResultsRenderer as Record<string, unknown> | undefined;
    const tabs = singleCol?.tabs as unknown[];
    const firstTab = tabs?.[0] as Record<string, unknown> | undefined;
    const tabRenderer = firstTab?.tabRenderer as Record<string, unknown> | undefined;
    const sectionList =
      (tabRenderer?.content as Record<string, unknown> | undefined)?.sectionListRenderer as
        | Record<string, unknown>
        | undefined
      ?? (data.continuationContents as Record<string, unknown> | undefined)?.sectionListContinuation as
        | Record<string, unknown>
        | undefined;

    const sections: HomeSection[] = [];
    const sectionContents = sectionList?.contents as unknown[];

    if (Array.isArray(sectionContents)) {
      for (const rawSec of sectionContents) {
        if (!rawSec || typeof rawSec !== 'object') continue;
        const sec = rawSec as Record<string, unknown>;
        const carousel =
          (sec.musicCarouselShelfRenderer as Record<string, unknown> | undefined) ??
          (sec.musicImmersiveCarouselShelfRenderer as Record<string, unknown> | undefined);

        if (carousel) {
          const header = carousel.header as Record<string, unknown> | undefined;
          const basicHeader = header?.musicCarouselShelfBasicHeaderRenderer as Record<string, unknown> | undefined;
          const title = runsToText((basicHeader?.title as Record<string, unknown> | undefined)?.runs) || 'Featured';

          const items: SearchResultItem[] = [];
          if (Array.isArray(carousel.contents)) {
            for (const item of carousel.contents) {
              const parsed = parseCardItem(item, recordDrop);
              if (parsed) {
                items.push(parsed);
              }
            }
          }

          if (items.length > 0) {
            sections.push({ title, items });
          }
        }
      }
    }

    // Extract continuation token if available
    let continuationToken: string | undefined;
    const continuations = sectionList?.continuations as unknown[];
    if (Array.isArray(continuations) && continuations.length > 0) {
      const nextData = (continuations[0] as Record<string, unknown>)?.nextContinuationData as
        | Record<string, unknown>
        | undefined;
      if (typeof nextData?.continuation === 'string') {
        continuationToken = nextData.continuation;
      }
    }

    return { sections, continuationToken };
  });

  const totalDrops = Object.values(dropCounts).reduce((a, b) => a + b, 0);
  if (totalDrops > 0) {
    logger.debug(`Home feed parsing dropped ${totalDrops} items`, dropCounts);
  }

  const responseSizeBytes = JSON.stringify(rawBody).length;

  return ok({
    sections: parsedData.sections,
    continuationToken: parsedData.continuationToken,
    parseDurationMs: durationMs,
    responseSizeBytes,
  });
}
