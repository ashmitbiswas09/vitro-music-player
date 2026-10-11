/**
 * Unit and integration tests for Streaming module:
 * Format ranking, strategy fallback, URL expiry re-resolution, and playback verification.
 */

import { describe, it, expect, vi } from 'vitest';
import { ok, err, TestClock, StreamError, SilentLogger, AudioStreamSchema } from '@/backend/core';
import { MemoryHttpClient } from '@/backend/platform';
import {
  DefaultStreamResolver,
  selectBestAudioFormat,
  parsePlayerResponse,
  parseCodec,
  parseExpiresAt,
  type StreamStrategy,
} from '@/backend/streaming';
import fs from 'node:fs';
import path from 'node:path';

describe('Streaming Module - Format Parsing & Ranking', () => {
  it('correctly classifies codecs from mimeType', () => {
    expect(parseCodec('audio/webm; codecs="opus"')).toBe('opus');
    expect(parseCodec("audio/webm; codecs='opus'")).toBe('opus');
    expect(parseCodec('audio/mp4; codecs="mp4a.40.2"')).toBe('aac');
    expect(parseCodec('audio/mp4; codecs="mp4a.40.5"')).toBe('aac');
    expect(parseCodec('audio/aac')).toBe('aac');
    expect(parseCodec('audio/flac')).toBe('other');
  });

  it('parses expiry from URL query param or falls back to expiresInSeconds', () => {
    const urlWithExpire = 'https://googlevideo.com/videoplayback?expire=1791705600&itag=251';
    expect(parseExpiresAt(urlWithExpire, '21600', 1000000)).toBe(1791705600000);

    const urlWithoutExpire = 'https://googlevideo.com/videoplayback?itag=251';
    expect(parseExpiresAt(urlWithoutExpire, '21600', 1000000)).toBe(1000000 + 21600 * 1000);
  });

  it('selects highest bitrate Opus format by default', () => {
    const formats = [
      {
        itag: 139,
        url: 'https://googlevideo.com/videoplayback?expire=1800000000&itag=139',
        mimeType: 'audio/mp4; codecs="mp4a.40.5"',
        bitrate: 50454,
        audioSampleRate: '22050',
      },
      {
        itag: 140,
        url: 'https://googlevideo.com/videoplayback?expire=1800000000&itag=140',
        mimeType: 'audio/mp4; codecs="mp4a.40.2"',
        bitrate: 131086,
        audioSampleRate: '44100',
        loudnessDb: 3.88,
      },
      {
        itag: 249,
        url: 'https://googlevideo.com/videoplayback?expire=1800000000&itag=249',
        mimeType: 'audio/webm; codecs="opus"',
        bitrate: 57664,
        audioSampleRate: '48000',
      },
      {
        itag: 251,
        url: 'https://googlevideo.com/videoplayback?expire=1800000000&itag=251',
        mimeType: 'audio/webm; codecs="opus"',
        bitrate: 150149,
        audioSampleRate: '48000',
        loudnessDb: 3.88,
      },
    ];

    const result = selectBestAudioFormat(formats, ['opus', 'aac', 'other'], '21600', 0);
    expect(result).not.toBeNull();
    expect(result!.stream.codec).toBe('opus');
    expect(result!.stream.bitrate).toBe(150149);
    expect(result!.stream.loudnessDb).toBe(3.88);
    expect(result!.rawFormat.itag).toBe(251);
  });

  it('respects AAC preference if configured', () => {
    const formats = [
      {
        itag: 140,
        url: 'https://googlevideo.com/videoplayback?expire=1800000000&itag=140',
        mimeType: 'audio/mp4; codecs="mp4a.40.2"',
        bitrate: 131086,
      },
      {
        itag: 251,
        url: 'https://googlevideo.com/videoplayback?expire=1800000000&itag=251',
        mimeType: 'audio/webm; codecs="opus"',
        bitrate: 150149,
      },
    ];

    const result = selectBestAudioFormat(formats, ['aac', 'opus', 'other'], '21600', 0);
    expect(result).not.toBeNull();
    expect(result!.stream.codec).toBe('aac');
    expect(result!.rawFormat.itag).toBe(140);
  });

  it('handles player response with unplayable status', () => {
    const raw = {
      playabilityStatus: {
        status: 'LOGIN_REQUIRED',
        reason: 'Sign in to confirm you’re not a bot',
      },
      streamingData: {},
    };

    const parsed = parsePlayerResponse(raw, { videoId: 'test1234', nowMs: 1000 });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe('STREAM_ERROR');
      expect(parsed.error.reason).toBe('UNPLAYABLE');
      expect(parsed.error.message).toContain('Sign in to confirm you’re not a bot');
    }
  });
});

describe('DefaultStreamResolver - Strategy Fallback & Caching', () => {
  it('falls back to secondary strategy when primary strategy fails', async () => {
    const clock = new TestClock(1000);
    const logger = new SilentLogger();

    const strategy1: StreamStrategy = {
      name: 'strategy-fail',
      resolve: vi
        .fn()
        .mockResolvedValue(err(new StreamError('Primary client failed', 'testVid', 'UNPLAYABLE'))),
    };

    const strategy2: StreamStrategy = {
      name: 'strategy-success',
      resolve: vi.fn().mockResolvedValue(
        ok({
          stream: {
            url: 'https://googlevideo.com/videoplayback?itag=251',
            mimeType: 'audio/webm; codecs="opus"',
            codec: 'opus',
            bitrate: 150000,
            expiresAt: 2000000,
          },
          strategyName: 'strategy-success',
        }),
      ),
    };

    const mockHttp = new MemoryHttpClient();
    const resolver = new DefaultStreamResolver({
      httpClient: mockHttp,
      clock,
      logger,
      strategies: [strategy1, strategy2],
      minRequestDelayMs: 0,
    });

    const res = await resolver.resolve('testVid');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.strategyName).toBe('strategy-success');
      expect(res.value.stream.bitrate).toBe(150000);
    }
    expect(strategy1.resolve).toHaveBeenCalledTimes(1);
    expect(strategy2.resolve).toHaveBeenCalledTimes(1);
  });

  it('returns typed error when all strategies fail', async () => {
    const clock = new TestClock(1000);
    const logger = new SilentLogger();

    const strategy1: StreamStrategy = {
      name: 'strategy-1',
      resolve: vi.fn().mockResolvedValue(err(new StreamError('Fail 1', 'testVid', 'UNPLAYABLE'))),
    };
    const strategy2: StreamStrategy = {
      name: 'strategy-2',
      resolve: vi.fn().mockResolvedValue(err(new StreamError('Fail 2', 'testVid', 'HTTP_403'))),
    };

    const mockHttp = new MemoryHttpClient();
    const resolver = new DefaultStreamResolver({
      httpClient: mockHttp,
      clock,
      logger,
      strategies: [strategy1, strategy2],
      minRequestDelayMs: 0,
    });

    const res = await resolver.resolve('testVid');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.reason).toBe('ALL_STRATEGIES_FAILED');
      expect(res.error.videoId).toBe('testVid');
    }
  });

  it('serves cached stream while valid, re-resolves after expiry', async () => {
    const clock = new TestClock(1000);
    const logger = new SilentLogger();

    let resolveCount = 0;
    const strategy: StreamStrategy = {
      name: 'strat',
      resolve: vi.fn().mockImplementation(async () => {
        resolveCount++;
        return ok({
          stream: {
            url: `https://googlevideo.com/videoplayback?v=${resolveCount}`,
            mimeType: 'audio/webm; codecs="opus"',
            codec: 'opus',
            bitrate: 150000,
            expiresAt: clock.now() + 120_000, // Valid for 2 minutes
          },
          strategyName: 'strat',
        });
      }),
    };

    const mockHttp = new MemoryHttpClient();
    const resolver = new DefaultStreamResolver({
      httpClient: mockHttp,
      clock,
      logger,
      strategies: [strategy],
      minRequestDelayMs: 0,
    });

    // 1. Initial resolve
    const firstRes = await resolver.resolve('vid1');
    expect(firstRes.ok).toBe(true);
    expect(resolveCount).toBe(1);

    // 2. Immediate second resolve -> Cache hit (no network call)
    const secondRes = await resolver.resolve('vid1');
    expect(secondRes.ok).toBe(true);
    expect(resolveCount).toBe(1);

    // 3. Advance clock past 60s threshold before expiry (advance 70s -> 50s left before expiry)
    clock.advanceBy(70_000);
    // Less than 60s left: expiresAt (121s) - now (71s) = 50s < 60s threshold -> re-resolve
    const thirdRes = await resolver.resolve('vid1');
    expect(thirdRes.ok).toBe(true);
    expect(resolveCount).toBe(2);
  });
});

describe('Sanitized Fixtures Verification', () => {
  it('validates recorded sanitized fixture against AudioStreamSchema', () => {
    const fixturePath = path.resolve(__dirname, '../fixtures/sanitized/resolve_9RfVp-GhKfs.json');
    if (fs.existsSync(fixturePath)) {
      const content = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
      expect(content.videoId).toBe('9RfVp-GhKfs');
      expect(content.strategy).toBe('visionos');

      const validation = AudioStreamSchema.safeParse(content.resolvedStream);
      expect(validation.success).toBe(true);
      if (validation.success) {
        expect(validation.data.codec).toBe('opus');
        expect(validation.data.bitrate).toBeGreaterThan(100000);
        expect(validation.data.url).toContain('sig=[REDACTED]');
      }
    }
  });
});
