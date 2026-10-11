/**
 * Defensive parser for YouTube Music Next (Queue/Radio) responses.
 */

import { z } from 'zod';
import { ok, type Result, type AppError, type Track, perf } from '@/backend/core';
import type { NextQueueResponse } from '../types';
import {
  runsToText,
  parseDuration,
  extractThumbnails,
  isValidTrackId,
  isValidArtistId,
  isValidAlbumId,
  isDateOrCountText,
} from './parser-utils';

const RunItemSchema = z.object({
  text: z.string(),
  navigationEndpoint: z
    .object({
      browseEndpoint: z
        .object({
          browseId: z.string().optional(),
          browseEndpointContextSupportedConfigs: z
            .object({
              browseEndpointContextMusicConfig: z
                .object({
                  pageType: z.string().optional(),
                })
                .optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
});

const PlaylistPanelVideoSchema = z.object({
  videoId: z.string().optional(),
  title: z.object({ runs: z.array(RunItemSchema).optional() }).optional(),
  longBylineText: z.object({ runs: z.array(RunItemSchema).optional() }).optional(),
  shortBylineText: z.object({ runs: z.array(RunItemSchema).optional() }).optional(),
  lengthText: z.object({ runs: z.array(z.object({ text: z.string() })).optional() }).optional(),
  thumbnail: z.unknown().optional(),
  selected: z.boolean().optional(),
});

export function parseNextResponse(
  rawBody: unknown,
  fallbackVideoId: string,
): Result<NextQueueResponse, AppError> {
  const { result: dataParsed, durationMs } = perf.measureSync('ParseNextQueue', () => {
    if (!rawBody || typeof rawBody !== 'object') {
      return {
        queue: [],
        currentTrack: undefined,
        playlistId: undefined,
        continuationToken: undefined,
      };
    }

    const data = rawBody as Record<string, unknown>;
    const contents = data.contents as Record<string, unknown> | undefined;
    const watchNext = contents?.singleColumnMusicWatchNextResultsRenderer as
      | Record<string, unknown>
      | undefined;
    const tabbed = watchNext?.tabbedRenderer as Record<string, unknown> | undefined;
    const watchNextTabs = (tabbed?.watchNextTabbedResultsRenderer as Record<string, unknown> | undefined)
      ?.tabs as unknown[];

    const firstTab = watchNextTabs?.[0] as Record<string, unknown> | undefined;
    const queueRenderer = (firstTab?.tabRenderer as Record<string, unknown> | undefined)?.content as
      | Record<string, unknown>
      | undefined;
    const musicQueue = queueRenderer?.musicQueueRenderer as Record<string, unknown> | undefined;
    const panelRenderer = (musicQueue?.content as Record<string, unknown> | undefined)
      ?.playlistPanelRenderer as Record<string, unknown> | undefined;

    // Radio Playlist ID from current endpoint or panel
    const currentEndpoint = data.currentVideoEndpoint as Record<string, unknown> | undefined;
    const watchEndpoint = currentEndpoint?.watchEndpoint as Record<string, unknown> | undefined;
    const radioPlaylistId = (watchEndpoint?.playlistId as string | undefined)
      ?? (panelRenderer?.playlistId as string | undefined);

    const queue: Track[] = [];
    let currentTrack: Track | undefined;

    const panelContents =
      (panelRenderer?.contents as unknown[]) ??
      ((data.continuationContents as Record<string, unknown> | undefined)?.playlistPanelContinuation as Record<string, unknown> | undefined)?.contents as unknown[];

    if (Array.isArray(panelContents)) {
      for (const rawItem of panelContents) {
        if (!rawItem || typeof rawItem !== 'object') continue;
        const itemObj = (rawItem as Record<string, unknown>).playlistPanelVideoRenderer as
          | Record<string, unknown>
          | undefined;
        if (!itemObj) continue;

        const parsedItem = PlaylistPanelVideoSchema.safeParse(itemObj);
        if (!parsedItem.success) continue;

        const { videoId, title: titleObj, longBylineText, shortBylineText, lengthText, thumbnail, selected } =
          parsedItem.data;
        if (!videoId || !isValidTrackId(videoId)) continue;
        const id = videoId;
        const title = runsToText(titleObj?.runs);
        if (!title) continue;

        const artists: { id?: string; name: string }[] = [];
        let album: { id?: string; title: string } | undefined;

        if (Array.isArray(longBylineText?.runs)) {
          let pastFirstBullet = false;
          for (const r of longBylineText.runs) {
            const text = r.text.trim();
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

        if (artists.length === 0 && Array.isArray(shortBylineText?.runs)) {
          for (const r of shortBylineText.runs) {
            const text = r.text.trim();
            if (!text || text === '&' || text === ',' || text === '•') continue;
            const browseId = r.navigationEndpoint?.browseEndpoint?.browseId;
            artists.push({
              id: browseId && isValidArtistId(browseId) ? browseId : undefined,
              name: text,
            });
          }
        }

        const durationSeconds = parseDuration(runsToText(lengthText?.runs));
        const thumbnails = extractThumbnails(thumbnail);

        const track: Track = {
          id,
          title,
          artists,
          album,
          durationSeconds,
          thumbnails,
        };

        if (selected) {
          currentTrack = track;
        }
        queue.push(track);
      }
    }

    // Continuation token
    let continuationToken: string | undefined;
    const continuations =
      (panelRenderer?.continuations as unknown[]) ??
      ((data.continuationContents as Record<string, unknown> | undefined)?.playlistPanelContinuation as Record<string, unknown> | undefined)?.continuations as unknown[];

    if (Array.isArray(continuations) && continuations.length > 0) {
      const firstCont = continuations[0] as Record<string, unknown> | undefined;
      const nextRadio = firstCont?.nextRadioContinuationData as Record<string, unknown> | undefined;
      const nextData = firstCont?.nextContinuationData as Record<string, unknown> | undefined;
      continuationToken =
        (nextRadio?.continuation as string | undefined) ??
        (nextData?.continuation as string | undefined);
    }

    return {
      queue,
      currentTrack: currentTrack ?? (queue.length > 0 ? queue[0] : undefined),
      playlistId: radioPlaylistId,
      continuationToken,
    };
  });

  const responseSizeBytes = JSON.stringify(rawBody).length;

  return ok({
    currentTrack: dataParsed.currentTrack,
    queue: dataParsed.queue,
    playlistId: dataParsed.playlistId,
    continuationToken: dataParsed.continuationToken,
    parseDurationMs: durationMs,
    responseSizeBytes,
  });
}
