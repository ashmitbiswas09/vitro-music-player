/**
 * Phase 7: Playback Core Module Unit Tests
 * Tests AudioEngine port, FakeAudioEngine, QueueManager (shuffle/repeat/navigation),
 * PlaybackService state machine, URL expiry re-resolution, 403 retry recovery,
 * prefetch triggering, auto-radio continuation, and cold-start state restoration.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  FakeAudioEngine,
  QueueManager,
  PlaybackService,
} from '@/backend/playback-core';
import {
  MemoryHttpClient,
  MemoryKeyValueStore,
} from '@/backend/platform';
import { DefaultStreamResolver, type StreamStrategy } from '@/backend/streaming';
import { ok, type Track, TestClock } from '@/backend/core';

describe('Phase 7: Playback Core Module', () => {
  const sampleTracks: Track[] = [
    {
      id: 'vid_111111111',
      title: 'Song One',
      artists: [{ id: 'UC_artist1', name: 'Artist One' }],
      album: { id: 'alb_1', title: 'Album One' },
      durationSeconds: 200,
      thumbnails: [{ url: 'https://example.com/thumb1.jpg', width: 300, height: 300 }],
    },
    {
      id: 'vid_222222222',
      title: 'Song Two',
      artists: [{ id: 'UC_artist2', name: 'Artist Two' }],
      album: { id: 'alb_2', title: 'Album Two' },
      durationSeconds: 180,
      thumbnails: [{ url: 'https://example.com/thumb2.jpg', width: 300, height: 300 }],
    },
    {
      id: 'vid_333333333',
      title: 'Song Three',
      artists: [{ id: 'UC_artist3', name: 'Artist Three' }],
      album: { id: 'alb_3', title: 'Album Three' },
      durationSeconds: 240,
      thumbnails: [{ url: 'https://example.com/thumb3.jpg', width: 300, height: 300 }],
    },
  ];

  describe('1. AudioEngine Port & FakeAudioEngine', () => {
    it('loads stream URL, passes requestHeaders, and updates state', async () => {
      const engine = new FakeAudioEngine();
      const stateHistory: string[] = [];
      engine.onStateChange((s) => stateHistory.push(s));

      const loadRes = await engine.load(
        'https://googlevideo.com/videoplayback?id=123',
        { 'User-Agent': 'VitroTest/1.0', Accept: '*/*' },
        {
          id: 'vid_1',
          title: 'Test Song',
          artist: 'Test Artist',
          durationSeconds: 200,
        },
      );

      expect(loadRes.ok).toBe(true);
      expect(engine.loadedUrl).toBe('https://googlevideo.com/videoplayback?id=123');
      expect(engine.loadedHeaders['User-Agent']).toBe('VitroTest/1.0');
      expect(engine.getState()).toBe('LOADING');

      await engine.play();
      expect(engine.getState()).toBe('PLAYING');

      await engine.pause();
      expect(engine.getState()).toBe('PAUSED');

      await engine.seekTo(45000);
      expect(await engine.getPosition()).toBe(45000);

      await engine.setVolume(0.8);
      expect(engine.currentVolume).toBe(0.8);

      await engine.stop();
      expect(engine.getState()).toBe('IDLE');
      expect(await engine.getPosition()).toBe(0);
    });

    it('emits position, trackEnded, and error events to subscribers', async () => {
      const engine = new FakeAudioEngine();
      let endedCalled = false;
      let errorReceived: string | undefined;
      let lastPos = 0;

      engine.onTrackEnded(() => {
        endedCalled = true;
      });
      engine.onError((e) => {
        errorReceived = e.message;
      });
      engine.onPositionChange((pos) => {
        lastPos = pos;
      });

      engine.emitPosition(12000);
      expect(lastPos).toBe(12000);

      engine.simulateTrackEnded();
      expect(endedCalled).toBe(true);
      expect(engine.getState()).toBe('ENDED');

      engine.simulateError({ message: 'HTTP 403 Forbidden', statusCode: 403 });
      expect(errorReceived).toBe('HTTP 403 Forbidden');
      expect(engine.getState()).toBe('ERROR');
    });
  });

  describe('2. QueueManager', () => {
    let queue: QueueManager;

    beforeEach(() => {
      queue = new QueueManager();
    });

    it('sets queue, respects startIndex, and reports current track', () => {
      queue.setQueue(sampleTracks, 1);
      expect(queue.length).toBe(3);
      expect(queue.index).toBe(1);
      expect(queue.getCurrentTrack()?.id).toBe('vid_222222222');
    });

    it('playNext inserts immediately after current index', () => {
      queue.setQueue([sampleTracks[0], sampleTracks[2]], 0);
      queue.playNext(sampleTracks[1]);

      expect(queue.length).toBe(3);
      expect(queue.queue[1].id).toBe(sampleTracks[1].id);
      expect(queue.getNextTrack()?.id).toBe(sampleTracks[1].id);
    });

    it('addToQueue appends to the end of the queue', () => {
      queue.setQueue([sampleTracks[0]], 0);
      queue.addToQueue(sampleTracks[1]);

      expect(queue.length).toBe(2);
      expect(queue.queue[1].id).toBe(sampleTracks[1].id);
    });

    it('removeFromQueue adjusts currentIndex properly', () => {
      queue.setQueue(sampleTracks, 2);
      queue.removeFromQueue(0);

      expect(queue.length).toBe(2);
      expect(queue.index).toBe(1);
      expect(queue.getCurrentTrack()?.id).toBe('vid_333333333');
    });

    it('moveInQueue reorders items and tracks currentIndex', () => {
      queue.setQueue(sampleTracks, 0); // Currently on track 0
      queue.moveInQueue(0, 2); // Move track 0 to position 2

      expect(queue.queue[2].id).toBe('vid_111111111');
      expect(queue.index).toBe(2);
      expect(queue.getCurrentTrack()?.id).toBe('vid_111111111');
    });

    it('next and previous navigate queue respecting boundaries', () => {
      queue.setQueue(sampleTracks, 0);

      // Advance
      expect(queue.next()?.id).toBe('vid_222222222');
      expect(queue.next()?.id).toBe('vid_333333333');
      expect(queue.next()).toBeNull(); // End of queue in REPEAT_OFF

      // Previous restarts if pos > 3000ms
      expect(queue.previous(5000)?.id).toBe('vid_333333333'); // Restarts current
      expect(queue.index).toBe(2);

      // Previous navigates back if pos <= 3000ms
      expect(queue.previous(1000)?.id).toBe('vid_222222222');
      expect(queue.index).toBe(1);
    });

    it('handles repeat modes: OFF, ALL, ONE', () => {
      queue.setQueue(sampleTracks, 2); // At last track

      // 1. REPEAT_OFF
      queue.setRepeatMode('OFF');
      expect(queue.next()).toBeNull();

      // 2. REPEAT_ALL loops back to index 0
      queue.setRepeatMode('ALL');
      expect(queue.next()?.id).toBe('vid_111111111');
      expect(queue.index).toBe(0);

      // 3. REPEAT_ONE returns current track unless forceAdvance is true
      queue.setRepeatMode('ONE');
      expect(queue.next()?.id).toBe('vid_111111111');
      expect(queue.index).toBe(0);

      expect(queue.next(true)?.id).toBe('vid_222222222');
      expect(queue.index).toBe(1);
    });

    it('shuffles remaining tracks while keeping current track, and restores on un-shuffle', () => {
      queue.setQueue(sampleTracks, 1); // Current: vid_222222222
      expect(queue.getCurrentTrack()?.id).toBe('vid_222222222');

      // Enable shuffle
      queue.setShuffle(true);
      expect(queue.isShuffled).toBe(true);
      // Current track must remain playing at index 0
      expect(queue.index).toBe(0);
      expect(queue.getCurrentTrack()?.id).toBe('vid_222222222');
      expect(queue.length).toBe(3);

      // Disable shuffle
      queue.setShuffle(false);
      expect(queue.isShuffled).toBe(false);
      // Restores original array order and points to current track index
      expect(queue.queue[1].id).toBe('vid_222222222');
      expect(queue.index).toBe(1);
    });
  });

  describe('3. PlaybackService State Machine & Stream Integration', () => {
    let clock: TestClock;
    let httpClient: MemoryHttpClient;
    let engine: FakeAudioEngine;
    let storage: MemoryKeyValueStore;
    let resolver: DefaultStreamResolver;
    let service: PlaybackService;

    beforeEach(() => {
      clock = new TestClock(1_000_000);
      httpClient = new MemoryHttpClient();
      engine = new FakeAudioEngine();
      storage = new MemoryKeyValueStore();

      // Fake stream strategy that returns predictable audio streams
      const mockStrategy: StreamStrategy = {
        name: 'test-strategy',
        resolve: async (videoId: string, options?: { forceFresh?: boolean }) => {
          return ok({
            stream: {
              url: `https://googlevideo.com/videoplayback?id=${videoId}&ts=${clock.now()}`,
              mimeType: 'audio/webm; codecs="opus"',
              codec: 'opus',
              bitrate: 150000,
              formatId: '251',
              expiresAt: clock.now() + 3600_000, // 1 hour TTL
            },
            requestHeaders: {
              'User-Agent': 'Vitro/1.0',
              Accept: '*/*',
            },
            strategyName: 'test-strategy',
          });
        },
      };

      resolver = new DefaultStreamResolver({
        httpClient,
        clock,
        minRequestDelayMs: 0,
        strategies: [mockStrategy],
      });

      service = new PlaybackService({
        audioEngine: engine,
        streamResolver: resolver,
        storage,
        clock,
      });
    });

    it('loads, plays, and passes stream.requestHeaders to AudioEngine', async () => {
      const res = await service.setQueue(sampleTracks, 0);
      expect(res.ok).toBe(true);

      expect(service.getStatus().state).toBe('PLAYING');
      expect(service.getStatus().currentTrack?.id).toBe('vid_111111111');
      expect(engine.loadedUrl).toContain('vid_111111111');
      expect(engine.loadedHeaders['User-Agent']).toBe('Vitro/1.0');
      expect(engine.loadedHeaders['Accept']).toBe('*/*');
    });

    it('pauses, resumes, seeks, and transitions states accurately', async () => {
      await service.setQueue(sampleTracks, 0);
      expect(service.getStatus().state).toBe('PLAYING');

      await service.pause();
      expect(service.getStatus().state).toBe('PAUSED');

      await service.play();
      expect(service.getStatus().state).toBe('PLAYING');

      await service.seekTo(50000);
      expect(service.getStatus().positionMs).toBe(50000);

      await service.stop();
      expect(service.getStatus().state).toBe('IDLE');
    });

    it('re-resolves stream if URL expires within 60 seconds', async () => {
      let resolveCallCount = 0;
      const expiringStrategy: StreamStrategy = {
        name: 'expiring-strategy',
        resolve: async (videoId: string) => {
          resolveCallCount++;
          // First call expires in 30s (triggering refresh), second expires in 1h
          const ttl = resolveCallCount === 1 ? 30_000 : 3600_000;
          return ok({
            stream: {
              url: `https://googlevideo.com/videoplayback?id=${videoId}&call=${resolveCallCount}`,
              mimeType: 'audio/webm; codecs="opus"',
              codec: 'opus',
              bitrate: 150000,
              formatId: '251',
              expiresAt: clock.now() + ttl,
            },
            requestHeaders: { 'User-Agent': 'Vitro/1.0' },
            strategyName: 'expiring-strategy',
          });
        },
      };

      const freshResolver = new DefaultStreamResolver({
        httpClient,
        clock,
        minRequestDelayMs: 0,
        strategies: [expiringStrategy],
      });

      const freshService = new PlaybackService({
        audioEngine: engine,
        streamResolver: freshResolver,
        clock,
      });

      await freshService.setQueue([sampleTracks[0]], 0);

      // Verify it detected <60s expiry and called resolve again
      expect(resolveCallCount).toBe(2);
      expect(engine.loadedUrl).toContain('call=2');
    });

    it('automatically recovers and retries once on HTTP 403 error from AudioEngine', async () => {
      let track1Resolves = 0;
      const failOnceStrategy: StreamStrategy = {
        name: 'fail-once',
        resolve: async (videoId: string) => {
          if (videoId === sampleTracks[0].id) {
            track1Resolves++;
          }
          return ok({
            stream: {
              url: `https://googlevideo.com/videoplayback?id=${videoId}&attempt=${track1Resolves}`,
              mimeType: 'audio/webm; codecs="opus"',
              codec: 'opus',
              bitrate: 150000,
              formatId: '251',
              expiresAt: clock.now() + 3600_000,
            },
            requestHeaders: { 'User-Agent': 'Vitro/1.0' },
            strategyName: 'fail-once',
          });
        },
      };

      const recoverResolver = new DefaultStreamResolver({
        httpClient,
        clock,
        minRequestDelayMs: 0,
        strategies: [failOnceStrategy],
      });

      const recoverService = new PlaybackService({
        audioEngine: engine,
        streamResolver: recoverResolver,
        clock,
      });

      await recoverService.setQueue(sampleTracks, 0);
      expect(engine.loadedUrl).toContain('attempt=1');

      // Audio engine encounters CDN HTTP 403 Forbidden
      engine.simulateError({
        message: 'HTTP 403: Forbidden - link expired or invalid signature',
        statusCode: 403,
        isNetworkOrAuthError: true,
      });

      // Wait for async recovery handler to complete
      await new Promise((r) => setTimeout(r, 50));

      // PlaybackService automatically invalidated cached URL and re-resolved fresh attempt
      expect(track1Resolves).toBe(2);
      expect(engine.loadedUrl).toContain('attempt=2');
      expect(recoverService.getStatus().state).toBe('PLAYING');
    });

    it('triggers prefetching for upcoming tracks into stream cache', async () => {
      const resolvedIds: string[] = [];
      const prefetchStrategy: StreamStrategy = {
        name: 'prefetch-strategy',
        resolve: async (videoId: string) => {
          resolvedIds.push(videoId);
          return ok({
            stream: {
              url: `https://googlevideo.com/${videoId}`,
              mimeType: 'audio/webm; codecs="opus"',
              codec: 'opus',
              bitrate: 150000,
              formatId: '251',
              expiresAt: clock.now() + 3600_000,
            },
            requestHeaders: {},
            strategyName: 'prefetch-strategy',
          });
        },
      };

      const prefetchResolver = new DefaultStreamResolver({
        httpClient,
        clock,
        minRequestDelayMs: 0,
        strategies: [prefetchStrategy],
      });

      const prefetchService = new PlaybackService({
        audioEngine: engine,
        streamResolver: prefetchResolver,
        clock,
      });

      await prefetchService.setQueue(sampleTracks, 0);

      // Current track vid_111111111 resolved immediately, upcoming tracks vid_222222222 and vid_333333333 prefetched
      await new Promise((r) => setTimeout(r, 50));
      expect(resolvedIds).toContain('vid_111111111');
      expect(resolvedIds).toContain('vid_222222222');
      expect(resolvedIds).toContain('vid_333333333');
    });

    it('persists queue state to storage and restores on cold-start', async () => {
      await service.setQueue(sampleTracks, 1);
      await service.seekTo(75000);
      service.setRepeatMode('ALL');

      // Cold start: instantiate brand new PlaybackService sharing the same storage
      const newEngine = new FakeAudioEngine();
      const coldStartService = new PlaybackService({
        audioEngine: newEngine,
        streamResolver: resolver,
        storage,
        clock,
      });

      const restored = await coldStartService.restoreState();
      expect(restored).toBe(true);

      const status = coldStartService.getStatus();
      expect(status.queueLength).toBe(3);
      expect(status.currentIndex).toBe(1);
      expect(status.currentTrack?.id).toBe('vid_222222222');
      expect(status.positionMs).toBe(75000);
      expect(status.repeatMode).toBe('ALL');
      expect(status.state).toBe('PAUSED'); // Cold-start restores paused ready to play
    });
  });
});
