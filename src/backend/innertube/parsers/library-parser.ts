/**
 * Defensive parsers for InnerTube Library endpoints:
 * - User Playlists (browseId: "FEmusic_liked_playlists")
 * - Liked Songs (browseId: "FEmusic_liked_videos")
 * - History (browseId: "FEmusic_history")
 */

import { ok, type Result, type AppError, type Track, type Thumbnail, perf } from '@/backend/core';
import {
  runsToText,
  parseDuration,
  extractThumbnails,
  extractVideoId,
  extractBrowseId,
  isValidTrackId,
  isValidArtistId,
  isDateOrCountText,
} from './parser-utils';

export interface ParsedUserPlaylist {
  id: string;
  title: string;
  trackCount?: number;
  thumbnails: Thumbnail[];
  author?: string;
}

export interface UserPlaylistsResponse {
  playlists: ParsedUserPlaylist[];
  continuationToken?: string;
  parseDurationMs: number;
  responseSizeBytes: number;
}

export interface LikedSongsResponse {
  tracks: Track[];
  totalCount?: number;
  continuationToken?: string;
  parseDurationMs: number;
  responseSizeBytes: number;
}

export interface ParsedHistoryItem {
  track: Track;
  playedAt?: string;
}

export interface HistoryResponse {
  items: ParsedHistoryItem[];
  continuationToken?: string;
  parseDurationMs: number;
  responseSizeBytes: number;
}

/**
 * Defensive parser for User Playlists (FEmusic_liked_playlists).
 */
export function parseUserPlaylistsResponse(
  rawBody: unknown,
): Result<UserPlaylistsResponse, AppError> {
  const { result, durationMs } = perf.measureSync('ParseUserPlaylists', () => {
    const playlists: ParsedUserPlaylist[] = [];
    let continuationToken: string | undefined;

    if (!rawBody || typeof rawBody !== 'object') {
      return { playlists, continuationToken };
    }

    const data = rawBody as Record<string, unknown>;
    const contents = data.contents as Record<string, unknown> | undefined;
    const singleCol = contents?.singleColumnBrowseResultsRenderer as Record<string, unknown> | undefined;
    const twoCol = contents?.twoColumnBrowseResultsRenderer as Record<string, unknown> | undefined;

    const tabs = (singleCol?.tabs ?? twoCol?.tabs) as unknown[];
    let sectionContents: unknown[] = [];

    if (Array.isArray(tabs) && tabs.length > 0) {
      const tabRenderer = (tabs[0] as Record<string, unknown>)?.tabRenderer as
        | Record<string, unknown>
        | undefined;
      const secList = (tabRenderer?.content as Record<string, unknown> | undefined)
        ?.sectionListRenderer as Record<string, unknown> | undefined;
      if (Array.isArray(secList?.contents)) {
        sectionContents = secList.contents;
      }
      // Check for sectionList continuation
      const secCont = secList?.continuations as unknown[];
      if (Array.isArray(secCont) && secCont.length > 0) {
        const nextData = (secCont[0] as Record<string, unknown>)?.nextContinuationData as
          | Record<string, unknown>
          | undefined;
        if (typeof nextData?.continuation === 'string') {
          continuationToken = nextData.continuation;
        }
      }
    } else if (
      Array.isArray(
        ((data.continuationContents as Record<string, unknown> | undefined)
          ?.gridContinuation as Record<string, unknown> | undefined)?.items,
      )
    ) {
      // Continuation response
      const gridCont = (data.continuationContents as Record<string, unknown>).gridContinuation as Record<string, unknown>;
      sectionContents = [{ gridRenderer: gridCont }];
      const nextCont = gridCont.continuations as unknown[];
      if (Array.isArray(nextCont) && nextCont.length > 0) {
        const nextData = (nextCont[0] as Record<string, unknown>)?.nextContinuationData as
          | Record<string, unknown>
          | undefined;
        if (typeof nextData?.continuation === 'string') {
          continuationToken = nextData.continuation;
        }
      }
    }

    for (const sec of sectionContents) {
      if (!sec || typeof sec !== 'object') continue;
      const secObj = sec as Record<string, unknown>;
      const gridRenderer = secObj.gridRenderer as Record<string, unknown> | undefined;
      const musicShelf = (secObj.musicShelfRenderer ?? secObj.musicPlaylistShelfRenderer) as
        | Record<string, unknown>
        | undefined;

      // Extract continuation from gridRenderer if not yet set
      if (!continuationToken && gridRenderer?.continuations && Array.isArray(gridRenderer.continuations)) {
        const nextData = (gridRenderer.continuations[0] as Record<string, unknown>)?.nextContinuationData as
          | Record<string, unknown>
          | undefined;
        if (typeof nextData?.continuation === 'string') {
          continuationToken = nextData.continuation;
        }
      }

      const items = (gridRenderer?.items ?? musicShelf?.contents) as unknown[];
      if (!Array.isArray(items)) continue;

      for (const rawItem of items) {
        if (!rawItem || typeof rawItem !== 'object') continue;
        const itemObj = rawItem as Record<string, unknown>;
        const twoRow = itemObj.musicTwoRowItemRenderer as Record<string, unknown> | undefined;
        const respItem = itemObj.musicResponsiveListItemRenderer as Record<string, unknown> | undefined;

        if (twoRow) {
          const title = runsToText((twoRow.title as Record<string, unknown> | undefined)?.runs);
          const rawId =
            extractBrowseId(twoRow.navigationEndpoint) ??
            extractBrowseId(twoRow.onTap) ??
            extractBrowseId(twoRow);

          if (!title || !rawId) continue;

          // Strip leading VL for consistency if it's VLPL...
          const id = rawId.startsWith('VL') ? rawId.slice(2) : rawId;
          const thumbnails = extractThumbnails(twoRow.thumbnailRenderer ?? twoRow.thumbnail);

          const subtitleRuns = (twoRow.subtitle as Record<string, unknown> | undefined)?.runs as unknown[];
          let author: string | undefined;
          let trackCount: number | undefined;

          if (Array.isArray(subtitleRuns)) {
            for (const r of subtitleRuns) {
              const text = (r as { text?: string })?.text?.trim();
              if (!text || text === '•') continue;
              const countMatch = text.match(/(\d+[\d,]*)\s+(?:songs?|tracks?)/i);
              if (countMatch) {
                trackCount = Number.parseInt(countMatch[1].replace(/,/g, ''), 10);
              } else if (!isDateOrCountText(text) && text !== 'Playlist') {
                author = text;
              }
            }
          }

          playlists.push({
            id,
            title,
            thumbnails,
            author,
            trackCount,
          });
        } else if (respItem) {
          const flexCols = respItem.flexColumns as unknown[];
          const titleCol = (flexCols?.[0] as Record<string, unknown> | undefined)
            ?.musicResponsiveListItemFlexColumnRenderer as Record<string, unknown> | undefined;
          const title = runsToText((titleCol?.text as Record<string, unknown> | undefined)?.runs);
          const rawId =
            extractBrowseId(respItem.navigationEndpoint) ??
            extractBrowseId(respItem.onTap) ??
            extractBrowseId(respItem);

          if (!title || !rawId) continue;
          const id = rawId.startsWith('VL') ? rawId.slice(2) : rawId;
          const thumbnails = extractThumbnails(respItem.thumbnail);

          playlists.push({
            id,
            title,
            thumbnails,
          });
        }
      }
    }

    return { playlists, continuationToken };
  });

  const responseSizeBytes = rawBody !== undefined ? (JSON.stringify(rawBody)?.length ?? 0) : 0;

  return ok({
    playlists: result.playlists,
    continuationToken: result.continuationToken,
    parseDurationMs: durationMs,
    responseSizeBytes,
  });
}

/**
 * Defensive parser for Liked Songs (FEmusic_liked_videos).
 */
export function parseLikedSongsResponse(
  rawBody: unknown,
): Result<LikedSongsResponse, AppError> {
  const { result, durationMs } = perf.measureSync('ParseLikedSongs', () => {
    const tracks: Track[] = [];
    let continuationToken: string | undefined;
    let totalCount: number | undefined;

    if (!rawBody || typeof rawBody !== 'object') {
      return { tracks, continuationToken, totalCount };
    }

    const data = rawBody as Record<string, unknown>;
    const contents = data.contents as Record<string, unknown> | undefined;
    const twoCol = contents?.twoColumnBrowseResultsRenderer as Record<string, unknown> | undefined;
    const singleCol = contents?.singleColumnBrowseResultsRenderer as Record<string, unknown> | undefined;

    // Header total count
    const headerRecord = data.header as Record<string, unknown> | undefined;
    const headerRenderer =
      headerRecord?.musicDetailHeaderRenderer ??
      headerRecord?.musicResponsiveHeaderRenderer;
    if (headerRenderer && typeof headerRenderer === 'object') {
      const hObj = headerRenderer as Record<string, unknown>;
      const subtitle = (hObj.secondSubtitle ?? hObj.subtitle) as Record<string, unknown> | undefined;
      const subtitleText = runsToText(subtitle?.runs);
      const match = subtitleText.match(/(\d+[\d,]*)\s+song/i);
      if (match) {
        totalCount = Number.parseInt(match[1].replace(/,/g, ''), 10);
      }
    }

    // Shelf contents
    const secondaryContents = twoCol?.secondaryContents as Record<string, unknown> | undefined;
    const secondarySecList = secondaryContents?.sectionListRenderer as Record<string, unknown> | undefined;
    const tabs = singleCol?.tabs as unknown[];
    let shelfContents: unknown[] = [];
    let continuationsArr: unknown[] = [];

    if (secondarySecList && Array.isArray(secondarySecList.contents)) {
      const firstShelf = secondarySecList.contents[0] as Record<string, unknown> | undefined;
      const musicShelf = (firstShelf?.musicShelfRenderer ?? firstShelf?.musicPlaylistShelfRenderer) as
        | Record<string, unknown>
        | undefined;
      if (Array.isArray(musicShelf?.contents)) {
        shelfContents = musicShelf.contents;
      }
      if (Array.isArray(musicShelf?.continuations)) {
        continuationsArr = musicShelf.continuations;
      }
    } else if (Array.isArray(tabs) && tabs.length > 0) {
      const tabRenderer = (tabs[0] as Record<string, unknown>)?.tabRenderer as Record<string, unknown> | undefined;
      const secList = (tabRenderer?.content as Record<string, unknown> | undefined)?.sectionListRenderer as Record<string, unknown> | undefined;
      if (Array.isArray(secList?.contents)) {
        const firstShelf = secList.contents[0] as Record<string, unknown> | undefined;
        const musicShelf = (firstShelf?.musicShelfRenderer ?? firstShelf?.musicPlaylistShelfRenderer) as
          | Record<string, unknown>
          | undefined;
        if (Array.isArray(musicShelf?.contents)) {
          shelfContents = musicShelf.contents;
        }
        if (Array.isArray(musicShelf?.continuations)) {
          continuationsArr = musicShelf.continuations;
        }
      }
    } else if (
      Array.isArray(
        ((data.continuationContents as Record<string, unknown> | undefined)
          ?.musicPlaylistShelfContinuation as Record<string, unknown> | undefined)?.contents,
      )
    ) {
      const cont = (data.continuationContents as Record<string, unknown>).musicPlaylistShelfContinuation as Record<string, unknown>;
      shelfContents = cont.contents as unknown[];
      if (Array.isArray(cont.continuations)) {
        continuationsArr = cont.continuations;
      }
    }

    // Extract continuation
    if (continuationsArr.length > 0) {
      const nextData = (continuationsArr[0] as Record<string, unknown>)?.nextContinuationData as
        | Record<string, unknown>
        | undefined;
      if (typeof nextData?.continuation === 'string') {
        continuationToken = nextData.continuation;
      }
    }

    // Parse track items
    for (const rawItem of shelfContents) {
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

      // Artists & Album
      const artistCol = (flexCols?.[1] as Record<string, unknown> | undefined)
        ?.musicResponsiveListItemFlexColumnRenderer as Record<string, unknown> | undefined;
      const artistRuns = (artistCol?.text as Record<string, unknown> | undefined)?.runs as unknown[];
      const itemArtists: { id?: string; name: string }[] = [];
      let albumBasic: { id?: string; title: string } | undefined;

      if (Array.isArray(artistRuns)) {
        for (const ar of artistRuns) {
          const text = (ar as { text?: string })?.text?.trim();
          if (!text || text === '•' || text === '&' || text === ',' || text.match(/^\d+:\d+$/) || isDateOrCountText(text)) continue;
          const browseId = (ar as { navigationEndpoint?: { browseEndpoint?: { browseId?: string } } })
            ?.navigationEndpoint?.browseEndpoint?.browseId;
          if (browseId && isValidArtistId(browseId)) {
            itemArtists.push({ id: browseId, name: text });
          } else if (itemArtists.length === 0) {
            itemArtists.push({ name: text });
          }
        }
      }

      // Check flex column 2 for album if available
      if (flexCols && flexCols.length > 2) {
        const albumCol = (flexCols[2] as Record<string, unknown> | undefined)
          ?.musicResponsiveListItemFlexColumnRenderer as Record<string, unknown> | undefined;
        const albumTitle = runsToText((albumCol?.text as Record<string, unknown> | undefined)?.runs);
        if (albumTitle) {
          const runs = (albumCol?.text as Record<string, unknown> | undefined)?.runs as
            | Record<string, unknown>[]
            | undefined;
          const albumEndpoint = runs?.[0]?.navigationEndpoint as
            | { browseEndpoint?: { browseId?: string } }
            | undefined;
          albumBasic = { id: albumEndpoint?.browseEndpoint?.browseId, title: albumTitle };
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

      const thumbnails = extractThumbnails(item.thumbnail);

      if (title && videoId && isValidTrackId(videoId)) {
        tracks.push({
          id: videoId,
          title,
          artists: itemArtists,
          album: albumBasic,
          durationSeconds,
          thumbnails,
        });
      }
    }

    return { tracks, continuationToken, totalCount: totalCount ?? tracks.length };
  });

  const responseSizeBytes = rawBody !== undefined ? (JSON.stringify(rawBody)?.length ?? 0) : 0;

  return ok({
    tracks: result.tracks,
    totalCount: result.totalCount,
    continuationToken: result.continuationToken,
    parseDurationMs: durationMs,
    responseSizeBytes,
  });
}

/**
 * Defensive parser for History (FEmusic_history).
 */
export function parseHistoryResponse(
  rawBody: unknown,
): Result<HistoryResponse, AppError> {
  const { result, durationMs } = perf.measureSync('ParseHistory', () => {
    const items: ParsedHistoryItem[] = [];
    let continuationToken: string | undefined;

    if (!rawBody || typeof rawBody !== 'object') {
      return { items, continuationToken };
    }

    const data = rawBody as Record<string, unknown>;
    const contents = data.contents as Record<string, unknown> | undefined;
    const singleCol = contents?.singleColumnBrowseResultsRenderer as Record<string, unknown> | undefined;
    const tabs = singleCol?.tabs as unknown[];

    let sectionContents: unknown[] = [];
    if (Array.isArray(tabs) && tabs.length > 0) {
      const tabRenderer = (tabs[0] as Record<string, unknown>)?.tabRenderer as Record<string, unknown> | undefined;
      const secList = (tabRenderer?.content as Record<string, unknown> | undefined)?.sectionListRenderer as Record<string, unknown> | undefined;
      if (Array.isArray(secList?.contents)) {
        sectionContents = secList.contents;
      }
      const secCont = secList?.continuations as unknown[];
      if (Array.isArray(secCont) && secCont.length > 0) {
        const nextData = (secCont[0] as Record<string, unknown>)?.nextContinuationData as
          | Record<string, unknown>
          | undefined;
        if (typeof nextData?.continuation === 'string') {
          continuationToken = nextData.continuation;
        }
      }
    }

    for (const sec of sectionContents) {
      if (!sec || typeof sec !== 'object') continue;
      const secObj = sec as Record<string, unknown>;
      const musicShelf = (secObj.musicShelfRenderer ?? secObj.musicPlaylistShelfRenderer) as
        | Record<string, unknown>
        | undefined;
      if (!musicShelf) continue;

      const shelfTitle = runsToText((musicShelf.title as Record<string, unknown> | undefined)?.runs);
      const shelfItems = musicShelf.contents as unknown[];
      if (!Array.isArray(shelfItems)) continue;

      for (const rawItem of shelfItems) {
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

        // Duration
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
          items.push({
            track: {
              id: videoId,
              title,
              artists: itemArtists,
              durationSeconds,
              thumbnails,
            },
            playedAt: shelfTitle || undefined,
          });
        }
      }
    }

    return { items, continuationToken };
  });

  const responseSizeBytes = rawBody !== undefined ? (JSON.stringify(rawBody)?.length ?? 0) : 0;

  return ok({
    items: result.items,
    continuationToken: result.continuationToken,
    parseDurationMs: durationMs,
    responseSizeBytes,
  });
}
