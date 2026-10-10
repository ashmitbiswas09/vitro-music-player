/**
 * Defensive parser for YouTube Music search responses.
 * Validates only consumed fields, degrades gracefully, and records parse timing.
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
} from '@/backend/core';
import type { SearchFilter, SearchResponse, SearchResultItem } from '../types';

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

function parseItem(renderer: unknown): SearchResultItem | null {
  const parseResult = ResponsiveListItemSchema.safeParse(renderer);
  if (!parseResult.success) {
    return null;
  }

  const data = parseResult.data;
  const cols = data.flexColumns ?? [];
  if (cols.length === 0) return null;

  const titleRuns = cols[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [];
  if (titleRuns.length === 0) return null;

  const title = titleRuns[0].text;
  const titleEndpoint = titleRuns[0].navigationEndpoint;

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
    titleEndpoint?.watchEndpoint?.videoId ||
    data.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
      ?.playNavigationEndpoint?.watchEndpoint?.videoId;

  const firstSubtitle = subtitleRuns[0]?.text?.toLowerCase().trim();
  const pageType =
    titleEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs
      ?.browseEndpointContextMusicConfig?.pageType;
  const browseId = titleEndpoint?.browseEndpoint?.browseId;

  // Track item
  if (videoId) {
    const artists: { id?: string; name: string }[] = [];
    let album: { id?: string; title: string } | undefined;
    let durationSeconds: number | undefined;

    for (let i = 0; i < subtitleRuns.length; i++) {
      const run = subtitleRuns[i];
      const text = run.text.trim();
      if (text === '•' || text === '&' || text === ',' || !text) continue;

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
        runPageType === 'MUSIC_PAGE_TYPE_ALBUM' ||
        (runBrowseId && runBrowseId.startsWith('MPRE'))
      ) {
        album = { id: runBrowseId, title: text };
      } else {
        const dur = parseDurationSeconds(text);
        if (dur !== undefined) {
          durationSeconds = dur;
        } else if (text !== 'Song' && text !== 'Video' && artists.length === 0 && !album) {
          artists.push({ id: runBrowseId, name: text });
        }
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

  // Artist item
  if (firstSubtitle === 'artist' || pageType === 'MUSIC_PAGE_TYPE_ARTIST') {
    const artist: Artist = {
      id: browseId ?? `artist_${title.toLowerCase().replace(/\s+/g, '_')}`,
      name: title,
      thumbnails,
    };
    return { type: 'artist', artist };
  }

  // Album item
  if (
    firstSubtitle === 'album' ||
    firstSubtitle === 'ep' ||
    firstSubtitle === 'single' ||
    pageType === 'MUSIC_PAGE_TYPE_ALBUM'
  ) {
    const artists: { id?: string; name: string }[] = [];
    if (subtitleRuns.length > 2) {
      artists.push({
        id: subtitleRuns[2].navigationEndpoint?.browseEndpoint?.browseId,
        name: subtitleRuns[2].text,
      });
    }

    const album: Album = {
      id: browseId ?? `album_${title.toLowerCase().replace(/\s+/g, '_')}`,
      title,
      artists,
      thumbnails,
    };
    return { type: 'album', album };
  }

  // Playlist item
  if (firstSubtitle === 'playlist') {
    const playlist: Playlist = {
      id: browseId ?? `playlist_${title.toLowerCase().replace(/\s+/g, '_')}`,
      title,
      thumbnails,
    };
    return { type: 'playlist', playlist };
  }

  return null;
}

export function parseSearchResponse(
  rawBody: unknown,
  query: string,
  filter: SearchFilter = 'all',
): Result<SearchResponse, never> {
  const { result: items, durationMs } = perf.measureSync('parseSearch', () => {
    const parsedItems: SearchResultItem[] = [];
    if (!rawBody || typeof rawBody !== 'object') return parsedItems;

    const root = rawBody as Record<string, unknown>;
    const contents = root.contents as Record<string, unknown> | undefined;
    if (!contents) return parsedItems;

    // Traverse tabbedSearchResultsRenderer or sectionListRenderer
    const tabbed = contents.tabbedSearchResultsRenderer as Record<string, unknown> | undefined;
    let sections: unknown[] = [];

    if (tabbed && Array.isArray(tabbed.tabs)) {
      const firstTab = tabbed.tabs[0] as Record<string, unknown> | undefined;
      const tabContent = firstTab?.tabRenderer as Record<string, unknown> | undefined;
      const sectionList = tabContent?.content as Record<string, unknown> | undefined;
      const sectionListRenderer = sectionList?.sectionListRenderer as
        Record<string, unknown> | undefined;
      if (Array.isArray(sectionListRenderer?.contents)) {
        sections = sectionListRenderer.contents;
      }
    } else if (
      contents.sectionListRenderer &&
      Array.isArray((contents.sectionListRenderer as Record<string, unknown>).contents)
    ) {
      sections = (contents.sectionListRenderer as Record<string, unknown>).contents as unknown[];
    }

    for (const section of sections) {
      if (!section || typeof section !== 'object') continue;
      const sec = section as Record<string, unknown>;

      // 1. musicCardShelfRenderer (Top result card + attached items)
      const cardShelf = sec.musicCardShelfRenderer as Record<string, unknown> | undefined;
      if (cardShelf) {
        const titleRuns = (cardShelf.title as Record<string, unknown> | undefined)
          ?.runs as unknown[];
        const title = (titleRuns?.[0] as { text?: string } | undefined)?.text ?? '';
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

        if (firstSubtitle.includes('artist') && title) {
          parsedItems.push({
            type: 'artist',
            artist: {
              id: browseId ?? `artist_${title.toLowerCase().replace(/\s+/g, '_')}`,
              name: title,
              thumbnails: thumbList,
            },
          });
        } else if (title && videoId) {
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

        // Also parse contents inside musicCardShelfRenderer
        if (Array.isArray(cardShelf.contents)) {
          for (const itemRenderer of cardShelf.contents) {
            const item = (itemRenderer as Record<string, unknown>).musicResponsiveListItemRenderer;
            if (item) {
              const parsed = parseItem(item);
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
            const parsed = parseItem(item);
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
            const parsed = parseItem(item);
            if (parsed) {
              parsedItems.push(parsed);
            }
          }
        }
      }
    }

    return parsedItems;
  });

  const responseSizeBytes = JSON.stringify(rawBody).length;

  return ok({
    query,
    filter,
    items,
    parseDurationMs: durationMs,
    responseSizeBytes,
  });
}
