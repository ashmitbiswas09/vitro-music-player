/**
 * Phase 9: Downloads Module Unit Tests
 * Tests DownloadManager download lifecycle, events, SQLite persistence across restarts,
 * physical file cleanup on remove/clear, error handling, storage accounting,
 * and offline-first playback resolution via PlaybackService.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DownloadManager,
  DOWNLOADS_MODULE_NAME,
  type DownloadedTrack,
  type LyricsPreCacher,
} from '@/backend/downloads';
import {
  MemoryFileStore,
  MemorySqlDatabase,
  MemoryKeyValueStore,
} from '@/backend/platform';
import {
  FakeAudioEngine,
  PlaybackService,
} from '@/backend/playback-core';
import type { StreamResolver, ResolvedStream } from '@/backend/streaming';
import {
  ok,
  err,
  type Track,
  TestClock,
  StreamError,
} from '@/backend/core';

describe('Phase 9: Downloads Module', () => {
  let fileStore: MemoryFileStore;
  let sqlDatabase: MemorySqlDatabase;
  let mockStreamResolver: StreamResolver;
  let mockLyricsPreCacher: LyricsPreCacher;
  let manager: DownloadManager;

  const testTrack: Track = {
    id: 'track_test_123',
    title: 'Karma Police',
    artists: [{ id: 'artist_radiohead', name: 'Radiohead' }],
    thumbnails: [],
    album: { id: 'album_ok_computer', title: 'OK Computer' },
    durationSeconds: 261,
  };

  const testResolvedStream: ResolvedStream = {
    stream: {
      url: 'https://rr1---sn.googlevideo.com/videoplayback?id=123',
      mimeType: 'audio/webm',
      codec: 'opus',
      bitrate: 160000,
      expiresAt: Date.now() + 3600000,
    },
    strategyName: 'visionos',
    requestHeaders: {
      'User-Agent': 'Mozilla/5.0 VitroTest',
      Accept: '*/*',
    },
  };

  beforeEach(() => {
    fileStore = new MemoryFileStore();
    sqlDatabase = new MemorySqlDatabase();

    mockStreamResolver = {
      resolve: vi.fn().mockResolvedValue(ok(testResolvedStream)),
      resolveStream: vi.fn().mockResolvedValue(ok(testResolvedStream)),
      verifyStream: vi.fn(),
      verifyStreamFull: vi.fn(),
      invalidateStream: vi.fn().mockResolvedValue(undefined),
    } as unknown as StreamResolver;

    mockLyricsPreCacher = {
      getLyrics: vi.fn().mockResolvedValue(
        ok({
          videoId: testTrack.id,
          syncedLines: [{ startTimeMs: 0, text: 'Karma police, arrest this man' }],
          source: 'lrclib',
        }),
      ),
    };

    manager = new DownloadManager({
      fileStore,
      sqlDatabase,
      streamResolver: mockStreamResolver,
      lyricsService: mockLyricsPreCacher,
    });
  });

  describe('1. Module Definition & Basic Verification', () => {
    it('exports DOWNLOADS_MODULE_NAME', () => {
      expect(DOWNLOADS_MODULE_NAME).toBe('downloads');
    });
  });

  describe('2. Download Lifecycle & Events', () => {
    it('enqueues download, emits progress events, writes file, and persists record', async () => {
      const events: { type: string; payload: unknown }[] = [];
      const unsub = manager.onDownloadEvent((event) => {
        events.push({ type: event.type, payload: event });
      });

      const res = await manager.enqueueDownload(testTrack);
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      const downloaded: DownloadedTrack = res.value;
      expect(downloaded.videoId).toBe(testTrack.id);
      expect(downloaded.mimeType).toBe('audio/webm');
      expect(downloaded.codec).toBe('opus');
      expect(downloaded.bitrate).toBe(160000);
      expect(downloaded.sizeBytes).toBeGreaterThan(0);
      expect(downloaded.filePath).toContain(`downloads/${testTrack.id}.webm`);

      // Verify physical file was written to FileStore
      const existsRes = await fileStore.exists(downloaded.filePath);
      expect(existsRes.ok && existsRes.value).toBe(true);

      // Verify event emission sequence: enqueued -> started -> completed
      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain('enqueued');
      expect(eventTypes).toContain('started');
      expect(eventTypes).toContain('completed');

      // Verify best-effort lyrics pre-caching was called
      expect(mockLyricsPreCacher.getLyrics).toHaveBeenCalledWith({
        videoId: testTrack.id,
        trackTitle: testTrack.title,
        artistName: 'Radiohead',
        albumName: 'OK Computer',
        durationSeconds: 261,
      });

      unsub();
    });

    it('returns existing record if track is already downloaded', async () => {
      const first = await manager.enqueueDownload(testTrack);
      expect(first.ok).toBe(true);

      // Second download attempt should immediately return the existing downloaded track
      const second = await manager.enqueueDownload(testTrack);
      expect(second.ok).toBe(true);
      if (second.ok && first.ok) {
        expect(second.value.filePath).toBe(first.value.filePath);
      }

      // Stream resolver should only have been called once
      expect(mockStreamResolver.resolve).toHaveBeenCalledTimes(1);
    });
  });

  describe('3. SQLite Persistence Across Restarts', () => {
    it('re-loads downloads from SQLite database on a fresh DownloadManager instance', async () => {
      // 1. Download track with first manager
      const res = await manager.enqueueDownload(testTrack);
      expect(res.ok).toBe(true);

      // 2. Instantiate a second manager connected to the exact same sqlDatabase and fileStore
      const secondManager = new DownloadManager({
        fileStore,
        sqlDatabase,
        streamResolver: mockStreamResolver,
      });

      // 3. Verify track is immediately retrievable without re-downloading
      const retrieved = await secondManager.getDownloadedTrack(testTrack.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.videoId).toBe(testTrack.id);
      expect(retrieved?.track.title).toBe('Karma Police');
      expect(retrieved?.filePath).toContain(testTrack.id);

      const list = await secondManager.listDownloads();
      expect(list.length).toBe(1);
      expect(list[0].videoId).toBe(testTrack.id);
    });
  });

  describe('4. Storage Usage & Accounting', () => {
    it('accurately reports storage usage for completed downloads', async () => {
      const initialUsage = await manager.getStorageUsageBytes();
      expect(initialUsage).toBe(0);

      const res = await manager.enqueueDownload(testTrack);
      expect(res.ok).toBe(true);

      const afterUsage = await manager.getStorageUsageBytes();
      if (res.ok) {
        expect(afterUsage).toBe(res.value.sizeBytes);
        expect(afterUsage).toBeGreaterThan(0);
      }
    });
  });

  describe('5. Removal and Clear All Downloads', () => {
    it('removes download: deletes physical file and removes SQLite row', async () => {
      const res = await manager.enqueueDownload(testTrack);
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      const filePath = res.value.filePath;
      const existsBefore = await fileStore.exists(filePath);
      expect(existsBefore.ok && existsBefore.value).toBe(true);

      const removeRes = await manager.removeDownload(testTrack.id);
      expect(removeRes.ok).toBe(true);

      // Verify physical file was unlinked
      const existsAfter = await fileStore.exists(filePath);
      expect(existsAfter.ok && existsAfter.value).toBe(false);

      // Verify SQLite row was deleted
      const found = await manager.getDownloadedTrack(testTrack.id);
      expect(found).toBeNull();

      const list = await manager.listDownloads();
      expect(list.length).toBe(0);
    });

    it('clearAllDownloads removes all files and purges database table', async () => {
      const track2: Track = {
        id: 'track_test_456',
        title: 'Paranoid Android',
        artists: [{ id: 'artist_radiohead', name: 'Radiohead' }],
        thumbnails: [],
        album: { id: 'album_ok_computer', title: 'OK Computer' },
        durationSeconds: 383,
      };

      await manager.enqueueDownload(testTrack);
      await manager.enqueueDownload(track2);

      let list = await manager.listDownloads();
      expect(list.length).toBe(2);

      const clearRes = await manager.clearAllDownloads();
      expect(clearRes.ok).toBe(true);

      list = await manager.listDownloads();
      expect(list.length).toBe(0);

      const storageUsage = await manager.getStorageUsageBytes();
      expect(storageUsage).toBe(0);
    });
  });

  describe('6. Error Handling & Failed Downloads', () => {
    it('handles stream resolution error gracefully: marks FAILED and emits error event', async () => {
      const failedResolver = {
        resolve: vi.fn().mockResolvedValue(
          err(new StreamError('Network stream unavailable', testTrack.id, 'NETWORK')),
        ),
      } as unknown as StreamResolver;

      const failingManager = new DownloadManager({
        fileStore,
        sqlDatabase,
        streamResolver: failedResolver,
      });

      const events: string[] = [];
      failingManager.onDownloadEvent((e) => events.push(e.type));

      const res = await failingManager.enqueueDownload(testTrack);
      expect(res.ok).toBe(false);
      expect(events).toContain('failed');

      // Check SQLite table has no COMPLETED download
      const downloaded = await failingManager.getDownloadedTrack(testTrack.id);
      expect(downloaded).toBeNull();
    });

    it('reconciles interrupted stale DOWNLOADING and QUEUED rows on cold start', async () => {
      // 1. Manually seed SQLite table with a stale DOWNLOADING row and dummy partial file
      const partialFilePath = 'downloads/stale_track_1.webm';
      await fileStore.write(partialFilePath, new Uint8Array([1, 2, 3, 4]));
      const fileExistsBefore = await fileStore.exists(partialFilePath);
      expect(fileExistsBefore.ok && fileExistsBefore.value).toBe(true);

      await sqlDatabase.execute(`
        CREATE TABLE IF NOT EXISTS downloads (
          video_id TEXT PRIMARY KEY,
          track_json TEXT NOT NULL,
          file_path TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          mime_type TEXT NOT NULL,
          codec TEXT NOT NULL,
          bitrate INTEGER NOT NULL,
          downloaded_at INTEGER NOT NULL,
          status TEXT NOT NULL,
          error TEXT
        );
      `);

      await sqlDatabase.execute(
        `INSERT INTO downloads (video_id, track_json, file_path, size_bytes, mime_type, codec, bitrate, downloaded_at, status, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'stale_track_1',
          JSON.stringify(testTrack),
          partialFilePath,
          4,
          'audio/webm',
          'opus',
          160000,
          Date.now(),
          'DOWNLOADING',
          null,
        ],
      );

      // 2. Instantiate a fresh DownloadManager (simulating cold start restart)
      const freshManager = new DownloadManager({
        fileStore,
        sqlDatabase,
        streamResolver: mockStreamResolver,
      });

      // 3. Trigger init
      await freshManager.init();

      // 4. Verify partial file was deleted
      const fileExistsAfter = await fileStore.exists(partialFilePath);
      expect(fileExistsAfter.ok && fileExistsAfter.value).toBe(false);

      // 5. Verify row was transitioned to FAILED with 'Interrupted by app restart'
      const rowsRes = await sqlDatabase.query<{ status: string; error: string }>(
        `SELECT status, error FROM downloads WHERE video_id = ?`,
        ['stale_track_1'],
      );
      expect(rowsRes.ok).toBe(true);
      if (rowsRes.ok) {
        expect(rowsRes.value[0]?.status).toBe('FAILED');
        expect(rowsRes.value[0]?.error).toBe('Interrupted by app restart');
      }
    });
  });

  describe('7. Offline-First Playback Integration (PlaybackService)', () => {
    it('loads local downloaded file directly into AudioEngine with 0ms network resolution', async () => {
      // 1. Complete a download for testTrack
      const dlRes = await manager.enqueueDownload(testTrack);
      expect(dlRes.ok).toBe(true);
      if (!dlRes.ok) return;

      const downloaded = dlRes.value;

      // 2. Set up PlaybackService with FakeAudioEngine and downloadLookup
      const fakeEngine = new FakeAudioEngine();
      const storage = new MemoryKeyValueStore();
      const clock = new TestClock();

      const streamResolveSpy = vi.fn().mockResolvedValue(ok(testResolvedStream));
      const playbackStreamResolver = {
        resolve: streamResolveSpy,
        resolveStream: streamResolveSpy,
        verifyStream: vi.fn(),
        verifyStreamFull: vi.fn(),
        invalidateStream: vi.fn(),
      } as unknown as StreamResolver;

      const playback = new PlaybackService({
        audioEngine: fakeEngine,
        streamResolver: playbackStreamResolver,
        storage,
        clock,
        downloadLookup: {
          getLocalTrackFilePath: async (videoId: string) => {
            const dl = await manager.getDownloadedTrack(videoId);
            return dl ? dl.filePath : null;
          },
        },
      });

      // 3. Play the downloaded track
      await playback.setQueue([testTrack], 0);

      // 4. Verify FakeAudioEngine loaded the local filePath instead of the remote GoogleVideo stream URL
      expect(fakeEngine.loadedUrl).toBe(downloaded.filePath);
      expect(fakeEngine.loadedUrl).not.toContain('googlevideo.com');
      expect(fakeEngine.getState()).toBe('PLAYING');

      // 5. Verify streamResolver.resolve was NEVER called for the offline track
      expect(streamResolveSpy).not.toHaveBeenCalled();

      // 6. Test a track that is NOT downloaded
      const nonDownloadedTrack: Track = {
        id: 'track_online_only',
        title: 'No Surprises',
        artists: [{ id: 'artist_radiohead', name: 'Radiohead' }],
        thumbnails: [],
      };

      await playback.setQueue([nonDownloadedTrack], 0);

      // Now streamResolver.resolve SHOULD be called
      expect(streamResolveSpy).toHaveBeenCalledWith('track_online_only', expect.anything());
      expect(fakeEngine.loadedUrl).toBe(testResolvedStream.stream.url);
    });
  });
});
