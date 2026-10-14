/**
 * Phase 6: Library Module Unit & Contract Tests
 * Tests defensive parsing, auth gating, cache scoping, optimistic mutations,
 * offline queue persistence in SqlDatabase, and rollback on fatal rejection.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseUserPlaylistsResponse,
  parseLikedSongsResponse,
  parseHistoryResponse,
  InnertubeClient,
} from '@/backend/innertube';
import { LibraryService } from '@/backend/library';
import {
  MemoryHttpClient,
  MemorySecureStore,
  MemoryKeyValueStore,
  MemorySqlDatabase,
  NodeSha1,
} from '@/backend/platform';
import { AuthService } from '@/backend/auth';
import { CacheManager } from '@/backend/cache';
import { NetworkError, AuthError } from '@/backend/core';

describe('Phase 6: Library Module', () => {
  describe('1. Defensive Parsers', () => {
    it('parseUserPlaylistsResponse parses playlists from gridRenderer and extracts metadata', () => {
      const mockRaw = {
        contents: {
          singleColumnBrowseResultsRenderer: {
            tabs: [
              {
                tabRenderer: {
                  content: {
                    sectionListRenderer: {
                      contents: [
                        {
                          gridRenderer: {
                            items: [
                              {
                                musicTwoRowItemRenderer: {
                                  title: { runs: [{ text: 'Favorites 2026' }] },
                                  navigationEndpoint: {
                                    browseEndpoint: { browseId: 'VLPL123456789' },
                                  },
                                  subtitle: {
                                    runs: [
                                      { text: 'Playlist' },
                                      { text: ' • ' },
                                      { text: '25 songs' },
                                    ],
                                  },
                                  thumbnailRenderer: {
                                    musicThumbnailRenderer: {
                                      thumbnail: {
                                        thumbnails: [
                                          { url: 'https://lh3.googleusercontent.com/test1', width: 226, height: 226 },
                                        ],
                                      },
                                    },
                                  },
                                },
                              },
                              {
                                musicTwoRowItemRenderer: {
                                  title: { runs: [{ text: 'Workout Mix' }] },
                                  navigationEndpoint: {
                                    browseEndpoint: { browseId: 'PLworkout987' },
                                  },
                                  subtitle: {
                                    runs: [{ text: 'Ashmit' }, { text: ' • ' }, { text: '10 songs' }],
                                  },
                                  thumbnailRenderer: {
                                    musicThumbnailRenderer: {
                                      thumbnail: {
                                        thumbnails: [
                                          { url: 'https://lh3.googleusercontent.com/test2', width: 226, height: 226 },
                                        ],
                                      },
                                    },
                                  },
                                },
                              },
                            ],
                            continuations: [
                              {
                                nextContinuationData: {
                                  continuation: 'TOKEN_PLAYLIST_NEXT',
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
      };

      const res = parseUserPlaylistsResponse(mockRaw);
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.value.playlists).toHaveLength(2);
      expect(res.value.playlists[0]).toEqual({
        id: 'PL123456789', // Strips VL
        title: 'Favorites 2026',
        trackCount: 25,
        author: undefined,
        thumbnails: [{ url: 'https://lh3.googleusercontent.com/test1', width: 226, height: 226 }],
      });
      expect(res.value.playlists[1].id).toBe('PLworkout987');
      expect(res.value.playlists[1].author).toBe('Ashmit');
      expect(res.value.playlists[1].trackCount).toBe(10);
      expect(res.value.continuationToken).toBe('TOKEN_PLAYLIST_NEXT');
    });

    it('preserves full 34-character playlist IDs when stripping the leading VL prefix', () => {
      const full34CharId = 'PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj';
      expect(full34CharId.length).toBe(34);

      const mockRaw = {
        contents: {
          singleColumnBrowseResultsRenderer: {
            tabs: [
              {
                tabRenderer: {
                  content: {
                    sectionListRenderer: {
                      contents: [
                        {
                          gridRenderer: {
                            items: [
                              {
                                musicTwoRowItemRenderer: {
                                  title: { runs: [{ text: 'Long ID Playlist' }] },
                                  navigationEndpoint: {
                                    browseEndpoint: { browseId: `VL${full34CharId}` },
                                  },
                                },
                              },
                              {
                                musicTwoRowItemRenderer: {
                                  title: { runs: [{ text: 'Watch Endpoint Playlist' }] },
                                  navigationEndpoint: {
                                    watchEndpoint: { playlistId: full34CharId },
                                  },
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
      };

      const res = parseUserPlaylistsResponse(mockRaw);
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.value.playlists).toHaveLength(2);
      expect(res.value.playlists[0].id).toBe(full34CharId);
      expect(res.value.playlists[0].id.length).toBe(34);
      expect(res.value.playlists[1].id).toBe(full34CharId);
      expect(res.value.playlists[1].id.length).toBe(34);
    });

    it('parseLikedSongsResponse parses tracks, header count, and continuation', () => {
      const mockRaw = {
        header: {
          musicDetailHeaderRenderer: {
            subtitle: {
              runs: [{ text: 'Auto playlist' }, { text: ' • ' }, { text: '42 songs' }],
            },
          },
        },
        contents: {
          twoColumnBrowseResultsRenderer: {
            secondaryContents: {
              sectionListRenderer: {
                contents: [
                  {
                    musicPlaylistShelfRenderer: {
                      contents: [
                        {
                          musicResponsiveListItemRenderer: {
                            flexColumns: [
                              {
                                musicResponsiveListItemFlexColumnRenderer: {
                                  text: { runs: [{ text: 'Karma Police' }] },
                                },
                              },
                              {
                                musicResponsiveListItemFlexColumnRenderer: {
                                  text: {
                                    runs: [
                                      {
                                        text: 'Radiohead',
                                        navigationEndpoint: {
                                          browseEndpoint: { browseId: 'UC0123456789012345678901' },
                                        },
                                      },
                                      { text: ' • ' },
                                      { text: 'OK Computer' },
                                    ],
                                  },
                                },
                              },
                            ],
                            fixedColumns: [
                              {
                                musicResponsiveListItemFixedColumnRenderer: {
                                  text: { runs: [{ text: '4:24' }] },
                                },
                              },
                            ],
                            overlay: {
                              musicItemThumbnailOverlayRenderer: {
                                content: {
                                  musicPlayButtonRenderer: {
                                    playNavigationEndpoint: {
                                      watchEndpoint: { videoId: '12345678901' },
                                    },
                                  },
                                },
                              },
                            },
                            thumbnail: {
                              musicThumbnailRenderer: {
                                thumbnail: {
                                  thumbnails: [{ url: 'https://thumb.url', width: 120, height: 120 }],
                                },
                              },
                            },
                          },
                        },
                      ],
                      continuations: [
                        {
                          nextContinuationData: {
                            continuation: 'TOKEN_LIKES_NEXT',
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      };

      const res = parseLikedSongsResponse(mockRaw);
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.value.totalCount).toBe(42);
      expect(res.value.tracks).toHaveLength(1);
      expect(res.value.tracks[0].id).toBe('12345678901');
      expect(res.value.tracks[0].title).toBe('Karma Police');
      expect(res.value.tracks[0].durationSeconds).toBe(264);
      expect(res.value.tracks[0].artists[0].name).toBe('Radiohead');
      expect(res.value.tracks[0].artists[0].id).toBe('UC0123456789012345678901');
      expect(res.value.continuationToken).toBe('TOKEN_LIKES_NEXT');
    });

    it('parseHistoryResponse parses shelf sections with playedAt groupings', () => {
      const mockRaw = {
        contents: {
          singleColumnBrowseResultsRenderer: {
            tabs: [
              {
                tabRenderer: {
                  content: {
                    sectionListRenderer: {
                      contents: [
                        {
                          musicShelfRenderer: {
                            title: { runs: [{ text: 'Today' }] },
                            contents: [
                              {
                                musicResponsiveListItemRenderer: {
                                  flexColumns: [
                                    {
                                      musicResponsiveListItemFlexColumnRenderer: {
                                        text: { runs: [{ text: 'No Surprises' }] },
                                      },
                                    },
                                    {
                                      musicResponsiveListItemFlexColumnRenderer: {
                                        text: { runs: [{ text: 'Radiohead' }] },
                                      },
                                    },
                                  ],
                                  navigationEndpoint: {
                                    watchEndpoint: { videoId: 'nosurprise1' },
                                  },
                                  thumbnail: {
                                    musicThumbnailRenderer: {
                                      thumbnail: {
                                        thumbnails: [{ url: 'https://thumb.url/ns', width: 60, height: 60 }],
                                      },
                                    },
                                  },
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
      };

      const res = parseHistoryResponse(mockRaw);
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.value.items).toHaveLength(1);
      expect(res.value.items[0].track.title).toBe('No Surprises');
      expect(res.value.items[0].track.id).toBe('nosurprise1');
      expect(res.value.items[0].playedAt).toBe('Today');
    });

    it('handles empty or malformed payloads defensively without throwing', () => {
      expect(parseUserPlaylistsResponse(null).ok).toBe(true);
      expect(parseUserPlaylistsResponse({}).ok).toBe(true);
      expect(parseLikedSongsResponse('bad string').ok).toBe(true);
      expect(parseHistoryResponse(undefined).ok).toBe(true);
    });
  });

  describe('2. Auth Gating', () => {
    let service: LibraryService;
    let authService: AuthService;
    let httpClient: MemoryHttpClient;
    let sqlDatabase: MemorySqlDatabase;

    beforeEach(() => {
      httpClient = new MemoryHttpClient();
      const secureStore = new MemorySecureStore();
      const keyValueStore = new MemoryKeyValueStore();
      const sha1 = new NodeSha1();
      sqlDatabase = new MemorySqlDatabase();

      authService = new AuthService({
        secureStore,
        sha1,
        httpClient,
      });

      const innertube = new InnertubeClient({
        httpClient,
        keyValueStore,
      });
      innertube.setAuthService(authService);

      service = new LibraryService({
        innertube,
        authService,
        db: sqlDatabase,
      });
    });

    it('returns typed MISSING_SESSION AuthError on all methods when not signed in', async () => {
      const pRes = await service.fetchUserPlaylists();
      expect(pRes.ok).toBe(false);
      if (!pRes.ok) {
        expect(pRes.error.code).toBe('AUTH_ERROR');
        expect((pRes.error as AuthError).reason).toBe('MISSING_SESSION');
      }

      const lRes = await service.fetchLikedSongs();
      expect(lRes.ok).toBe(false);
      if (!lRes.ok) {
        expect((lRes.error as AuthError).reason).toBe('MISSING_SESSION');
      }

      const hRes = await service.fetchHistory();
      expect(hRes.ok).toBe(false);
      if (!hRes.ok) {
        expect((hRes.error as AuthError).reason).toBe('MISSING_SESSION');
      }

      const likeRes = await service.setLiked('9RfVp-GhKfs', 'LIKE');
      expect(likeRes.ok).toBe(false);
      if (!likeRes.ok) {
        expect((likeRes.error as AuthError).reason).toBe('MISSING_SESSION');
      }

      const addRes = await service.addTrackToPlaylist('PL123', '9RfVp-GhKfs');
      expect(addRes.ok).toBe(false);
      if (!addRes.ok) {
        expect((addRes.error as AuthError).reason).toBe('MISSING_SESSION');
      }

      const remRes = await service.removeTrackToPlaylist('PL123', '9RfVp-GhKfs');
      expect(remRes.ok).toBe(false);
      if (!remRes.ok) {
        expect((remRes.error as AuthError).reason).toBe('MISSING_SESSION');
      }

      const drainRes = await service.drainQueue();
      expect(drainRes.ok).toBe(false);
      if (!drainRes.ok) {
        expect((drainRes.error as AuthError).reason).toBe('MISSING_SESSION');
      }
    });
  });

  describe('3. Authenticated Read Operations & Cache Scoping', () => {
    let service: LibraryService;
    let authService: AuthService;
    let httpClient: MemoryHttpClient;
    let sqlDatabase: MemorySqlDatabase;
    let cache: CacheManager;

    beforeEach(async () => {
      httpClient = new MemoryHttpClient();
      const secureStore = new MemorySecureStore();
      const keyValueStore = new MemoryKeyValueStore();
      const sha1 = new NodeSha1();
      sqlDatabase = new MemorySqlDatabase();

      cache = new CacheManager({
        sqlDatabase,
      });

      authService = new AuthService({
        secureStore,
        sha1,
        httpClient,
      });

      // Sign in mock user
      await authService.setSessionFromCookies({
        SAPISID: 'mock_sapisid_token',
        SSID: 'mock_ssid_token',
        LOGIN_INFO: 'mock_login_info',
      });

      const innertube = new InnertubeClient({
        httpClient,
        keyValueStore,
      });
      innertube.setAuthService(authService);

      service = new LibraryService({
        innertube,
        authService,
        db: sqlDatabase,
        cache,
      });
    });

    it('fetches user playlists, caches with auth scope, and returns cache hit on subsequent calls', async () => {
      let callCount = 0;
      httpClient.addHandler('POST:https://music.youtube.com/youtubei/v1/browse', () => {
        callCount++;
        return {
          status: 200,
          statusText: 'OK',
          headers: {},
          durationMs: 1,
          data: {
            contents: {
              singleColumnBrowseResultsRenderer: {
                tabs: [
                  {
                    tabRenderer: {
                      content: {
                        sectionListRenderer: {
                          contents: [
                            {
                              gridRenderer: {
                                items: [
                                  {
                                    musicTwoRowItemRenderer: {
                                      title: { runs: [{ text: 'Indie Vibes' }] },
                                      navigationEndpoint: {
                                        browseEndpoint: { browseId: 'VLPLindie123' },
                                      },
                                    },
                                  },
                                ],
                              },
                            },
                          ],
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
        };
      });

      // Cold call
      const res1 = await service.fetchUserPlaylists();
      expect(res1.ok).toBe(true);
      if (!res1.ok) return;
      expect(res1.value.playlists).toHaveLength(1);
      expect(res1.value.playlists[0].title).toBe('Indie Vibes');
      expect(callCount).toBe(1);

      // Warm call (should be served from cache)
      const res2 = await service.fetchUserPlaylists();
      expect(res2.ok).toBe(true);
      if (!res2.ok) return;
      expect(res2.value.playlists[0].title).toBe('Indie Vibes');
      expect(callCount).toBe(1); // No new network call!
    });
  });

  describe('4. Optimistic Mutations & Offline Queue', () => {
    let service: LibraryService;
    let authService: AuthService;
    let httpClient: MemoryHttpClient;
    let sqlDatabase: MemorySqlDatabase;

    beforeEach(async () => {
      httpClient = new MemoryHttpClient();
      const secureStore = new MemorySecureStore();
      const keyValueStore = new MemoryKeyValueStore();
      const sha1 = new NodeSha1();
      sqlDatabase = new MemorySqlDatabase();

      authService = new AuthService({
        secureStore,
        sha1,
        httpClient,
      });

      await authService.setSessionFromCookies({
        SAPISID: 'mock_sapisid_token',
        SSID: 'mock_ssid_token',
      });

      const innertube = new InnertubeClient({
        httpClient,
        keyValueStore,
      });
      innertube.setAuthService(authService);

      service = new LibraryService({
        innertube,
        authService,
        db: sqlDatabase,
      });
    });

    it('setLiked executes on network and completes immediately when online', async () => {
      let likedVideoId: string | undefined;
      httpClient.addHandler('POST:https://music.youtube.com/youtubei/v1/like/like', (_url, options) => {
        likedVideoId = (options.body as { target?: { videoId?: string } })?.target?.videoId;
        return { status: 200, statusText: 'OK', headers: {}, data: {}, durationMs: 1 };
      });

      const res = await service.setLiked('9RfVp-GhKfs', 'LIKE');
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.value.success).toBe(true);
      expect(res.value.queued).toBe(false);
      expect(likedVideoId).toBe('9RfVp-GhKfs');

      // Check mutation queue is clean
      const session = (await authService.getSession()).ok ? (await authService.getSession()) : null;
      const accountId = session?.ok ? session.value?.accountId : '';
      const pending = await service.queue.getPending(accountId!);
      expect(pending.ok && pending.value.length === 0).toBe(true);
    });

    it('setLiked enqueues mutation in SQLite when network is offline/fails transiently', async () => {
      // Simulate network error
      httpClient.addHandler('POST:https://music.youtube.com/youtubei/v1/like/like', () => {
        throw new NetworkError('Device is offline', { isOffline: true });
      });

      const res = await service.setLiked('offline_trk1', 'LIKE');
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.value.success).toBe(true);
      expect(res.value.queued).toBe(true);

      const session = (await authService.getSession());
      const accountId = session.ok && session.value ? session.value.accountId : '';
      const pendingRes = await service.queue.getPending(accountId);
      expect(pendingRes.ok).toBe(true);
      if (!pendingRes.ok) return;

      expect(pendingRes.value).toHaveLength(1);
      expect(pendingRes.value[0].type).toBe('SET_LIKE');

      // Optimistic like status in SQLite reflects 'LIKE'
      const optimisticStatus = await service.queue.getOptimisticLike(accountId, 'offline_trk1');
      expect(optimisticStatus.ok && optimisticStatus.value === 'LIKE').toBe(true);
    });

    it('drainQueue processes queued offline mutations once connection is restored', async () => {
      // 1. Enqueue offline mutation
      httpClient.addHandler('POST:https://music.youtube.com/youtubei/v1/like/like', () => {
        throw new NetworkError('Device is offline');
      });
      await service.setLiked('offline_trk2', 'LIKE');

      // 2. Network recovers
      let drained = false;
      httpClient.addHandler('POST:https://music.youtube.com/youtubei/v1/like/like', () => {
        drained = true;
        return { status: 200, statusText: 'OK', headers: {}, data: {}, durationMs: 1 };
      });

      // 3. Drain queue
      const drainRes = await service.drainQueue();
      expect(drainRes.ok).toBe(true);
      if (!drainRes.ok) return;

      expect(drainRes.value.processed).toBe(1);
      expect(drainRes.value.remaining).toBe(0);
      expect(drained).toBe(true);
    });

    it('rolls back optimistic state on fatal network rejection (HTTP 400)', async () => {
      const session = await authService.getSession();
      const accountId = session.ok && session.value ? session.value.accountId : '';

      // Set initial like state
      await service.queue.setOptimisticLike(accountId, 'invalid_vid', 'INDIFFERENT');

      // Simulate fatal rejection (400 Bad Request)
      httpClient.addHandler('POST:https://music.youtube.com/youtubei/v1/like/like', () => {
        return {
          status: 400,
          statusText: 'Bad Request',
          headers: {},
          data: { error: { message: 'Invalid video ID' } },
          durationMs: 1,
        };
      });

      const res = await service.setLiked('invalid_vid', 'LIKE');
      expect(res.ok).toBe(false);

      // Verify rollback to INDIFFERENT
      const rollbackStatus = await service.queue.getOptimisticLike(accountId, 'invalid_vid');
      expect(rollbackStatus.ok && rollbackStatus.value === 'INDIFFERENT').toBe(true);
    });

    it('logout purges user_likes and pending_mutations from SQLite', async () => {
      const session = await authService.getSession();
      const accountId = session.ok && session.value ? session.value.accountId : '';

      // 1. Enqueue offline mutation and set optimistic like
      httpClient.addHandler('POST:https://music.youtube.com/youtubei/v1/like/like', () => {
        throw new NetworkError('Offline');
      });
      await service.setLiked('logout_trk', 'LIKE');

      // Verify records exist in SQLite
      const pendingBefore = await service.queue.getPending(accountId);
      expect(pendingBefore.ok && pendingBefore.value.length === 1).toBe(true);
      const likeBefore = await service.queue.getOptimisticLike(accountId, 'logout_trk');
      expect(likeBefore.ok && likeBefore.value === 'LIKE').toBe(true);

      // 2. Clear user library data (as wired in onLogout)
      await service.clearUserData(accountId);

      // 3. Verify SQLite tables are completely purged
      const pendingAfter = await service.queue.getPending(accountId);
      expect(pendingAfter.ok && pendingAfter.value.length === 0).toBe(true);
      const likeAfter = await service.queue.getOptimisticLike(accountId, 'logout_trk');
      expect(likeAfter.ok && likeAfter.value === null).toBe(true);
    });
  });
});
