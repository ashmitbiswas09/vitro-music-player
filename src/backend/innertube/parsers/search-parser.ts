/**
 * Defensive parser for YouTube Music search responses.
 * Validates only consumed fields, degrades gracefully, and records parse timing.
 * Adheres strictly to type-specific ID shapes and never invents synthetic IDs.
 */

import { z } from 'zod';
import {
  ok,
  type Result,
  type Track,
  type Album,
  type Artist,
  type Playlist,
  type Thumbnail,
  perf,
  createLogger,
} from '@/backend/core';
import type { SearchFilter, SearchResponse, SearchResultItem } from '../types';
import {
  isValidTrackId,
  isValidArtistId,
  isValidAlbumId,
  isValidPlaylistId,
  DESCRIPTORS,
  isDateOrCountText,
} from './parser-utils';

export { isValidTrackId, isValidArtistId, isValidAlbumId, isValidPlaylistId };

const logger = createLogger({ prefix: 'SearchParser' });

// Defensive Zod schemas targeting only consumed fields
const ThumbnailItemSchema = z.object({
  url: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
});

const NavigationEndpointSchema = z
  .object({
    watchEndpoint: z
      .object({
        videoId: z.string().optional(),
      })
      .optional(),
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
  .optional();

const TextRunSchema = z.object({
  text: z.string(),
  navigationEndpoint: NavigationEndpointSchema,
});

const FlexColumnSchema = z.object({
  musicResponsiveListItemFlexColumnRenderer: z
    .object({
      text: z
        .object({
          runs: z.array(TextRunSchema).optional(),
        })
        .optional(),
    })
    .optional(),
});

const ResponsiveListItemSchema = z.object({
  flexColumns: z.array(FlexColumnSchema).optional(),
  navigationEndpoint: NavigationEndpointSchema,
  menu: z.unknown().optional(),
  thumbnail: z
    .object({
      musicThumbnailRenderer: z
        .object({
          thumbnail: z
            .object({
              thumbnails: z.array(ThumbnailItemSchema).optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
  overlay: z
    .object({
      musicItemThumbnailOverlayRenderer: z
        .object({
          content: z
            .object({
              musicPlayButtonRenderer: z
                .object({
                  playNavigationEndpoint: z
                    .object({
                      watchEndpoint: z
                        .object({
                          videoId: z.string().optional(),
                        })
                        .optional(),
                    })
                    .optional(),
                })
                .optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
  badges: z
    .array(
      z.object({
        musicInlineBadgeRenderer: z
          .object({
            icon: z
              .object({
                iconType: z.string().optional(),
              })
              .optional(),
          })
          .optional(),
      }),
    )
    .optional(),
  playlistItemData: z
    .object({
      videoId: z.string().optional(),
    })
    .optional(),
});

function parseDurationSeconds(str?: string): number | undefined {
  if (!str) return undefined;
  const parts = str
    .trim()
    .split(':')
    .map((p) => parseInt(p, 10));
  if (parts.some((n) => isNaN(n))) return undefined;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return undefined;
}


function extractMenuBrowseInfo(menu: unknown): {
  browseId?: string;
  isAlbum?: boolean;
  isArtist?: boolean;
  isPlaylist?: boolean;
} {
  if (!menu || typeof menu !== 'object') return {};
  const menuRenderer = (menu as { menuRenderer?: Record<string, unknown> }).menuRenderer;
  if (!menuRenderer || !Array.isArray(menuRenderer.items)) return {};

  for (const rawItem of menuRenderer.items) {
    if (!rawItem || typeof rawItem !== 'object') continue;
    const navItem = (rawItem as Record<string, unknown>).menuNavigationItemRenderer as
      | {
          navigationEndpoint?: {
            browseEndpoint?: {
              browseId?: string;
              browseEndpointContextSupportedConfigs?: {
                browseEndpointContextMusicConfig?: { pageType?: string };
              };
            };
          };
          icon?: { iconType?: string };
        }
      | undefined;

    const bId = navItem?.navigationEndpoint?.browseEndpoint?.browseId;
    const pageType =
      navItem?.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs
        ?.browseEndpointContextMusicConfig?.pageType;
    const icon = navItem?.icon?.iconType;

    if (bId) {
      if (
        pageType === 'MUSIC_PAGE_TYPE_ALBUM' ||
        icon === 'ALBUM' ||
        isValidAlbumId(bId)
      ) {
        return { browseId: bId, isAlbum: true };
      }
      if (
        pageType === 'MUSIC_PAGE_TYPE_ARTIST' ||
        icon === 'ARTIST' ||
        isValidArtistId(bId)
      ) {
        return { browseId: bId, isArtist: true };
      }
      if (
        pageType === 'MUSIC_PAGE_TYPE_PLAYLIST' ||
        icon === 'ADD_TO_PLAYLIST' ||
        isValidPlaylistId(bId)
      ) {
        return { browseId: bId, isPlaylist: true };
      }
    }

    const toggleItem = (rawItem as Record<string, unknown>).toggleMenuServiceItemRenderer as
      | {
          defaultServiceEndpoint?: {
            likeEndpoint?: { target?: { playlistId?: string } };
          };
          toggledServiceEndpoint?: {
            likeEndpoint?: { target?: { playlistId?: string } };
          };
        }
      | undefined;

    const plId =
      toggleItem?.toggledServiceEndpoint?.likeEndpoint?.target?.playlistId ??
      toggleItem?.defaultServiceEndpoint?.likeEndpoint?.target?.playlistId;
    if (plId && isValidAlbumId(plId)) {
      return { browseId: plId, isAlbum: true };
    }
    if (plId && isValidPlaylistId(plId)) {
      return { browseId: plId, isPlaylist: true };
    }
  }

  return {};
}

function parseItem(
  renderer: unknown,
  parentArtist?: { id?: string; name: string },
  onDrop?: (reason: string) => void,
): SearchResultItem | null {
  const parseResult = ResponsiveListItemSchema.safeParse(renderer);
  if (!parseResult.success) {
    onDrop?.('schema_validation_failed');
    return null;
  }

  const data = parseResult.data;
  const cols = data.flexColumns ?? [];
  if (cols.length === 0) {
    onDrop?.('missing_flex_columns');
    return null;
  }

  const titleRuns = cols[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [];
  if (titleRuns.length === 0) {
    onDrop?.('missing_title');
    return null;
  }

  const title = titleRuns[0].text;
  const titleEndpoint = titleRuns[0].navigationEndpoint;
  const navEndpoint = data.navigationEndpoint ?? titleEndpoint;

  const subtitleRuns = cols[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [];

  const rawThumbnails = data.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? [];
  const thumbnails: Thumbnail[] = rawThumbnails.map((t) => ({
    url: t.url,
    width: t.width,
    height: t.height,
  }));

  const isExplicit = (data.badges ?? []).some(
    (b) => b.musicInlineBadgeRenderer?.icon?.iconType === 'MUSIC_EXPLICIT_BADGE',
  );

  const videoId =
    data.playlistItemData?.videoId ||
    navEndpoint?.watchEndpoint?.videoId ||
    titleEndpoint?.watchEndpoint?.videoId ||
    data.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
      ?.playNavigationEndpoint?.watchEndpoint?.videoId;

  const browseEndpoint = navEndpoint?.browseEndpoint ?? titleEndpoint?.browseEndpoint;
  let browseId = browseEndpoint?.browseId;
  let pageType =
    browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig
      ?.pageType;

  if (!browseId && data.menu) {
    const fromMenu = extractMenuBrowseInfo(data.menu);
    if (fromMenu.browseId) {
      browseId = fromMenu.browseId;
      if (fromMenu.isAlbum && !pageType) pageType = 'MUSIC_PAGE_TYPE_ALBUM';
      if (fromMenu.isArtist && !pageType) pageType = 'MUSIC_PAGE_TYPE_ARTIST';
      if (fromMenu.isPlaylist && !pageType) pageType = 'MUSIC_PAGE_TYPE_PLAYLIST';
    }
  }

  const firstSubtitle = subtitleRuns[0]?.text?.toLowerCase().trim() ?? '';

  // 1. Track item
  if (videoId && isValidTrackId(videoId)) {
    const artists: { id?: string; name: string }[] = [];
    let album: { id?: string; title: string } | undefined;
    let durationSeconds: number | undefined;

    for (let i = 0; i < subtitleRuns.length; i++) {
      const run = subtitleRuns[i];
      const text = run.text.trim();
      const lower = text.toLowerCase();
      if (!text || DESCRIPTORS.has(lower) || isDateOrCountText(text)) continue;

      const runPageType =
        run.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs
          ?.browseEndpointContextMusicConfig?.pageType;
      const runBrowseId = run.navigationEndpoint?.browseEndpoint?.browseId;

      if (
        runPageType === 'MUSIC_PAGE_TYPE_ARTIST' ||
        (runBrowseId && runBrowseId.startsWith('UC'))
      ) {
        artists.push({ id: runBrowseId, name: text });
      } else if (
        runPageType === 'MUSIC_PAGE_TYPE_PODCAST_SHOW_DETAIL_PAGE' ||
        (runBrowseId && runBrowseId.startsWith('MPSP'))
      ) {
        artists.push({ id: runBrowseId, name: text });
      } else if (
        runPageType === 'MUSIC_PAGE_TYPE_ALBUM' ||
        (runBrowseId && runBrowseId.startsWith('MPRE'))
      ) {
        album = { id: runBrowseId, title: text };
      } else {
        const dur = parseDurationSeconds(text);
        if (dur !== undefined) {
          durationSeconds = dur;
        } else if (artists.length === 0 && !album) {
          artists.push({ id: runBrowseId, name: text });
        }
      }
    }

    // If subtitle did not contain artist (e.g. within artist card shelf), inherit parent artist
    if (artists.length === 0 && parentArtist) {
      artists.push(parentArtist);
    }

    // Or check menu for artist link
    if (artists.length === 0 && data.menu) {
      const fromMenu = extractMenuBrowseInfo(data.menu);
      if (fromMenu.isArtist && fromMenu.browseId) {
        artists.push({ id: fromMenu.browseId, name: title });
      }
    }

    const track: Track = {
      id: videoId,
      title,
      artists,
      album,
      durationSeconds,
      thumbnails,
      isExplicit,
    };
    return { type: 'track', track };
  }

  // 2. Artist item (must have valid UC... id, NEVER synthetic)
  if (
    (firstSubtitle === 'artist' || pageType === 'MUSIC_PAGE_TYPE_ARTIST') &&
    isValidArtistId(browseId)
  ) {
    const artist: Artist = {
      id: browseId,
      name: title,
      thumbnails,
    };
    return { type: 'artist', artist };
  }

  // 3. Album item (must have valid MPREb_... or OLAK5uy_... id, NEVER synthetic)
  if (
    (firstSubtitle === 'album' ||
      firstSubtitle === 'ep' ||
      firstSubtitle === 'single' ||
      pageType === 'MUSIC_PAGE_TYPE_ALBUM') &&
    isValidAlbumId(browseId)
  ) {
    const artists: { id?: string; name: string }[] = [];
    for (let i = 1; i < subtitleRuns.length; i++) {
      const run = subtitleRuns[i];
      const text = run.text.trim();
      const lower = text.toLowerCase();
      if (!text || DESCRIPTORS.has(lower) || isDateOrCountText(text)) continue;
      const aId = run.navigationEndpoint?.browseEndpoint?.browseId;
      if (aId?.startsWith('UC') || (!artists.length && !/^\d{4}$/.test(text))) {
        artists.push({ id: aId, name: text });
      }
    }

    const album: Album = {
      id: browseId,
      title,
      artists,
      thumbnails,
    };
    return { type: 'album', album };
  }

  // 4. Playlist item (must have valid VL.../PL.../RD... id, NEVER synthetic)
  if (
    (firstSubtitle === 'playlist' || pageType === 'MUSIC_PAGE_TYPE_PLAYLIST') &&
    isValidPlaylistId(browseId)
  ) {
    const playlist: Playlist = {
      id: browseId,
      title,
      thumbnails,
    };
    return { type: 'playlist', playlist };
  }

  // 5. Fallback identification by validated ID shape
  if (browseId) {
    if (isValidArtistId(browseId)) {
      return { type: 'artist', artist: { id: browseId, name: title, thumbnails } };
    }
    if (isValidAlbumId(browseId)) {
      return { type: 'album', album: { id: browseId, title, artists: [], thumbnails } };
    }
    if (isValidPlaylistId(browseId)) {
      return { type: 'playlist', playlist: { id: browseId, title, thumbnails } };
    }
  }

  onDrop?.('unrecognized_type_or_invalid_id');
  return null;
}

export function parseSearchResponse(
  rawBody: unknown,
  query: string,
  filter: SearchFilter = 'all',
): Result<SearchResponse, never> {
  const dropCounts: Record<string, number> = {};
  const recordDrop = (reason: string) => {
    dropCounts[reason] = (dropCounts[reason] ?? 0) + 1;
  };

  const { result: items, durationMs } = perf.measureSync('ParseSearch', () => {
    if (!rawBody || typeof rawBody !== 'object') {
      return [];
    }

    const data = rawBody as Record<string, unknown>;
    const contents = data.contents as Record<string, unknown> | undefined;
    const tabbedResults = contents?.tabbedSearchResultsRenderer as
      | Record<string, unknown>
      | undefined;
    const tabs = tabbedResults?.tabs as unknown[];

    if (!Array.isArray(tabs) || tabs.length === 0) {
      return [];
    }

    const firstTab = tabs[0] as Record<string, unknown>;
    const tabRenderer = firstTab?.tabRenderer as Record<string, unknown> | undefined;
    const tabContent = tabRenderer?.content as Record<string, unknown> | undefined;
    const sectionList = tabContent?.sectionListRenderer as Record<string, unknown> | undefined;
    const sectionContents = sectionList?.contents as unknown[];

    if (!Array.isArray(sectionContents)) {
      return [];
    }

    const parsedItems: SearchResultItem[] = [];

    for (const rawSec of sectionContents) {
      if (!rawSec || typeof rawSec !== 'object') continue;
      const sec = rawSec as Record<string, unknown>;

      // 1. musicCardShelfRenderer (Top result hero card)
      const cardShelf = sec.musicCardShelfRenderer as Record<string, unknown> | undefined;
      if (cardShelf) {
        const titleRuns = (cardShelf.title as Record<string, unknown> | undefined)?.runs as unknown[];
        const title = (titleRuns?.[0] as { text?: string } | undefined)?.text;
        const titleEndpoint = (
          titleRuns?.[0] as { navigationEndpoint?: Record<string, unknown> } | undefined
        )?.navigationEndpoint;

        const subtitleRuns = (cardShelf.subtitle as Record<string, unknown> | undefined)
          ?.runs as unknown[];
        const firstSubtitle =
          (subtitleRuns?.[0] as { text?: string } | undefined)?.text?.toLowerCase() ?? '';

        const thumbRenderer = (cardShelf.thumbnail as Record<string, unknown> | undefined)
          ?.musicThumbnailRenderer as Record<string, unknown> | undefined;
        const thumbObj = thumbRenderer?.thumbnail as Record<string, unknown> | undefined;
        const thumbList = (thumbObj?.thumbnails as Thumbnail[]) ?? [];
        const browseId = (titleEndpoint?.browseEndpoint as { browseId?: string } | undefined)
          ?.browseId;
        const videoId = (cardShelf.onTap as { watchEndpoint?: { videoId?: string } } | undefined)
          ?.watchEndpoint?.videoId;

        let cardArtist: { id?: string; name: string } | undefined;

        if (firstSubtitle.includes('artist') && title && isValidArtistId(browseId)) {
          cardArtist = { id: browseId, name: title };
          parsedItems.push({
            type: 'artist',
            artist: {
              id: browseId,
              name: title,
              thumbnails: thumbList,
            },
          });
        } else if (title && videoId && isValidTrackId(videoId)) {
          parsedItems.push({
            type: 'track',
            track: {
              id: videoId,
              title,
              artists: [],
              thumbnails: thumbList,
            },
          });
        }

        // Parse contents inside musicCardShelfRenderer passing cardArtist context
        if (Array.isArray(cardShelf.contents)) {
          for (const itemRenderer of cardShelf.contents) {
            const item = (itemRenderer as Record<string, unknown>).musicResponsiveListItemRenderer;
            if (item) {
              const parsed = parseItem(item, cardArtist, recordDrop);
              if (parsed) {
                parsedItems.push(parsed);
              }
            }
          }
        }
      }

      // 2. musicShelfRenderer
      const shelf = sec.musicShelfRenderer as Record<string, unknown> | undefined;
      if (shelf && Array.isArray(shelf.contents)) {
        for (const itemRenderer of shelf.contents) {
          const item = (itemRenderer as Record<string, unknown>).musicResponsiveListItemRenderer;
          if (item) {
            const parsed = parseItem(item, undefined, recordDrop);
            if (parsed) {
              parsedItems.push(parsed);
            }
          }
        }
      }

      // 3. itemSectionRenderer (Default in general search results)
      const itemSection = sec.itemSectionRenderer as Record<string, unknown> | undefined;
      if (itemSection && Array.isArray(itemSection.contents)) {
        for (const itemRenderer of itemSection.contents) {
          const item = (itemRenderer as Record<string, unknown>).musicResponsiveListItemRenderer;
          if (item) {
            const parsed = parseItem(item, undefined, recordDrop);
            if (parsed) {
              parsedItems.push(parsed);
            }
          }
        }
      }
    }

    // Deduplicate items by ID, preserving first occurrence
    const seenIds = new Set<string>();
    const uniqueItems: SearchResultItem[] = [];

    for (const item of parsedItems) {
      const id =
        item.type === 'track'
          ? item.track.id
          : item.type === 'artist'
            ? item.artist.id
            : item.type === 'album'
              ? item.album.id
              : item.playlist.id;

      if (!seenIds.has(id)) {
        seenIds.add(id);
        uniqueItems.push(item);
      }
    }

    return uniqueItems;
  });

  const totalDrops = Object.values(dropCounts).reduce((a, b) => a + b, 0);
  if (totalDrops > 0) {
    logger.debug(`Search response parsing dropped ${totalDrops} items`, dropCounts);
  }

  const responseSizeBytes = JSON.stringify(rawBody).length;

  return ok({
    query,
    filter,
    items,
    parseDurationMs: durationMs,
    responseSizeBytes,
  });
}
