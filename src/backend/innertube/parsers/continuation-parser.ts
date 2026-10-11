/**
 * Defensive parser for YouTube Music continuation responses (paginated feed, playlist, queue).
 */

import { ok, type Result, type AppError, type Track, perf } from '@/backend/core';
import type { ContinuationResponse, SearchResultItem } from '../types';
import {
  runsToText,
  parseDuration,
  extractThumbnails,
  extractVideoId,
  isValidTrackId,
  isValidArtistId,
  isValidAlbumId,
  isDateOrCountText,
} from './parser-utils';

function parseTrackItem(rawItem: unknown): Track | null {
  if (!rawItem || typeof rawItem !== 'object') return null;
  const item = (rawItem as Record<string, unknown>).musicResponsiveListItemRenderer as
    | Record<string, unknown>
    | undefined;
  if (!item) return null;

  const flexCols = item.flexColumns as unknown[];
  const fixedCols = item.fixedColumns as unknown[];

  const titleCol = (flexCols?.[0] as Record<string, unknown> | undefined)
    ?.musicResponsiveListItemFlexColumnRenderer as Record<string, unknown> | undefined;
  const title = runsToText((titleCol?.text as Record<string, unknown> | undefined)?.runs);

  const artistCol = (flexCols?.[1] as Record<string, unknown> | undefined)
    ?.musicResponsiveListItemFlexColumnRenderer as Record<string, unknown> | undefined;
  const artistRuns = (artistCol?.text as Record<string, unknown> | undefined)?.runs as unknown[];
  const itemArtists: { id?: string; name: string }[] = [];
  if (Array.isArray(artistRuns)) {
    for (const ar of artistRuns) {
      const text = (ar as { text?: string })?.text?.trim();
      if (!text || text === '•' || text === '&' || text === ',' || text.match(/^\d+:\d+$/) || isDateOrCountText(text)) continue;
      const browseId = (ar as { navigationEndpoint?: { browseEndpoint?: { browseId?: string } } })
        ?.navigationEndpoint?.browseEndpoint?.browseId;
      itemArtists.push({
        id: browseId && isValidArtistId(browseId) ? browseId : undefined,
        name: text,
      });
    }
  }

  const durCol = (fixedCols?.[0] as Record<string, unknown> | undefined)
    ?.musicResponsiveListItemFixedColumnRenderer as Record<string, unknown> | undefined;
  let durText = runsToText((durCol?.text as Record<string, unknown> | undefined)?.runs);
  if (!durText && Array.isArray(artistRuns)) {
    const timeRun = artistRuns.find((r) => (r as { text?: string })?.text?.match(/^\d+:\d+$/));
    if (timeRun) durText = (timeRun as { text: string }).text;
  }
  const durationSeconds = parseDuration(durText);

  const videoId =
    extractVideoId(item.overlay) ??
    extractVideoId(item.navigationEndpoint) ??
    extractVideoId(titleCol);

  const thumbnails = extractThumbnails(item.thumbnail);

  if (title && videoId && isValidTrackId(videoId)) {
    return {
      id: videoId,
      title,
      artists: itemArtists,
      durationSeconds,
      thumbnails,
    };
  }
  return null;
}

export function parseContinuationResponse(rawBody: unknown): Result<ContinuationResponse, AppError> {
  const { result: dataParsed, durationMs } = perf.measureSync('ParseContinuation', () => {
    if (!rawBody || typeof rawBody !== 'object') {
      return { items: [], continuationToken: undefined };
    }

    const data = rawBody as Record<string, unknown>;
    const continuationContents = data.continuationContents as Record<string, unknown> | undefined;
    if (!continuationContents) {
      return { items: [], continuationToken: undefined };
    }

    const items: SearchResultItem[] = [];
    let nextContinuationToken: string | undefined;

    // 1. sectionListContinuation (Common in Browse & Playlist continuations)
    const secListCont = continuationContents.sectionListContinuation as
      | Record<string, unknown>
      | undefined;
    if (secListCont && Array.isArray(secListCont.contents)) {
      for (const rawSec of secListCont.contents) {
        if (!rawSec || typeof rawSec !== 'object') continue;
        const sec = rawSec as Record<string, unknown>;

        const shelf =
          (sec.musicPlaylistShelfRenderer as Record<string, unknown> | undefined) ??
          (sec.musicShelfRenderer as Record<string, unknown> | undefined);

        if (shelf && Array.isArray(shelf.contents)) {
          for (const item of shelf.contents) {
            const track = parseTrackItem(item);
            if (track) {
              items.push({ type: 'track', track });
            }
          }

          const continuations = shelf.continuations as unknown[];
          if (Array.isArray(continuations) && continuations.length > 0) {
            const nextData = (continuations[0] as Record<string, unknown>)?.nextContinuationData as
              | Record<string, unknown>
              | undefined;
            if (typeof nextData?.continuation === 'string') {
              nextContinuationToken = nextData.continuation;
            }
          }
        }
      }

      if (!nextContinuationToken && Array.isArray(secListCont.continuations) && secListCont.continuations.length > 0) {
        const nextData = (secListCont.continuations[0] as Record<string, unknown>)?.nextContinuationData as
          | Record<string, unknown>
          | undefined;
        if (typeof nextData?.continuation === 'string') {
          nextContinuationToken = nextData.continuation;
        }
      }
    }

    // 2. Direct musicPlaylistShelfContinuation / musicShelfContinuation
    const shelfCont =
      (continuationContents.musicPlaylistShelfContinuation as Record<string, unknown> | undefined) ??
      (continuationContents.musicShelfContinuation as Record<string, unknown> | undefined);

    if (shelfCont && Array.isArray(shelfCont.contents)) {
      for (const item of shelfCont.contents) {
        const track = parseTrackItem(item);
        if (track) {
          items.push({ type: 'track', track });
        }
      }

      const continuations = shelfCont.continuations as unknown[];
      if (Array.isArray(continuations) && continuations.length > 0) {
        const nextData = (continuations[0] as Record<string, unknown>)?.nextContinuationData as
          | Record<string, unknown>
          | undefined;
        if (typeof nextData?.continuation === 'string') {
          nextContinuationToken = nextData.continuation;
        }
      }
    }

    // 3. playlistPanelContinuation (Queue continuation)
    const panelCont = continuationContents.playlistPanelContinuation as
      | Record<string, unknown>
      | undefined;
    if (panelCont && Array.isArray(panelCont.contents)) {
      for (const rawItem of panelCont.contents) {
        if (!rawItem || typeof rawItem !== 'object') continue;
        const itemObj = (rawItem as Record<string, unknown>).playlistPanelVideoRenderer as
          | Record<string, unknown>
          | undefined;
        if (!itemObj) continue;

        const videoId = itemObj.videoId as string | undefined;
        const title = runsToText((itemObj.title as Record<string, unknown> | undefined)?.runs);
        if (!title || !videoId || !isValidTrackId(videoId)) continue;

        const longByline = itemObj.longBylineText as
          | { runs?: { text?: string; navigationEndpoint?: { browseEndpoint?: { browseId?: string } } }[] }
          | undefined;
        const shortByline = itemObj.shortBylineText as
          | { runs?: { text?: string; navigationEndpoint?: { browseEndpoint?: { browseId?: string } } }[] }
          | undefined;
        const artists: { id?: string; name: string }[] = [];
        let album: { id?: string; title: string } | undefined;

        if (Array.isArray(longByline?.runs)) {
          let pastFirstBullet = false;
          for (const r of longByline.runs) {
            const text = r.text?.trim();
            if (!text) continue;
            if (text === '•') {
              pastFirstBullet = true;
              continue;
            }
            if (text === '&' || text === ',') continue;

            const browseId = r.navigationEndpoint?.browseEndpoint?.browseId;
            if (browseId && isValidArtistId(browseId)) {
              if (!artists.some((a) => a.name === text)) {
                artists.push({ id: browseId, name: text });
              }
            } else if (browseId && isValidAlbumId(browseId)) {
              if (!album) {
                album = { id: browseId, title: text };
              }
            } else if (!pastFirstBullet && !isDateOrCountText(text)) {
              if (!artists.some((a) => a.name === text)) {
                artists.push({
                  id: browseId && isValidArtistId(browseId) ? browseId : undefined,
                  name: text,
                });
              }
            }
          }
        }

        if (artists.length === 0 && Array.isArray(shortByline?.runs)) {
          for (const r of shortByline.runs) {
            const text = r.text?.trim();
            if (!text || text === '&' || text === ',' || text === '•') continue;
            const browseId = r.navigationEndpoint?.browseEndpoint?.browseId;
            artists.push({
              id: browseId && isValidArtistId(browseId) ? browseId : undefined,
              name: text,
            });
          }
        }

        const durationSeconds = parseDuration(
          runsToText((itemObj.lengthText as Record<string, unknown> | undefined)?.runs),
        );
        const thumbnails = extractThumbnails(itemObj.thumbnail);

        items.push({
          type: 'track',
          track: {
            id: videoId,
            title,
            artists,
            album,
            durationSeconds,
            thumbnails,
          },
        });
      }

      const continuations = panelCont.continuations as unknown[];
      if (Array.isArray(continuations) && continuations.length > 0) {
        const first = continuations[0] as Record<string, unknown> | undefined;
        nextContinuationToken =
          (first?.nextRadioContinuationData as { continuation?: string } | undefined)?.continuation ??
          (first?.nextContinuationData as { continuation?: string } | undefined)?.continuation;
      }
    }

    return { items, continuationToken: nextContinuationToken };
  });

  const responseSizeBytes = JSON.stringify(rawBody).length;

  return ok({
    items: dataParsed.items,
    continuationToken: dataParsed.continuationToken,
    parseDurationMs: durationMs,
    responseSizeBytes,
  });
}
