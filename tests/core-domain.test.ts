import { describe, it, expect } from 'vitest';
import { TrackSchema, ThumbnailSchema, AudioStreamSchema, perf } from '@/backend/core';

describe('Core Domain Models & Defensive Parsing', () => {
  it('parses minimal Track and measures parse duration', () => {
    const rawTrack = {
      id: 'video_123',
      title: 'Creep',
      extraIgnoredField: 'something huge that we do not care about',
      complexNestedMetadataTree: { foo: 'bar', deeplyNested: [1, 2, 3] },
    };

    const { result: parsed, durationMs } = perf.measureSync('parseTrack', () =>
      TrackSchema.parse(rawTrack),
    );

    expect(parsed.id).toBe('video_123');
    expect(parsed.title).toBe('Creep');
    expect(parsed.artists).toEqual([]);
    expect(parsed.thumbnails).toEqual([
      { url: 'https://i.ytimg.com/vi/video_123/hqdefault.jpg' },
    ]);
    expect(durationMs).toBeGreaterThanOrEqual(0);
  });

  it('parses full Track defensively with artists and album', () => {
    const rawTrack = {
      id: 'abc_456',
      title: 'Karma Police',
      artists: [{ id: 'art_1', name: 'Radiohead' }],
      album: { id: 'alb_1', title: 'OK Computer' },
      durationSeconds: 261,
      thumbnails: [
        { url: 'https://lh3.googleusercontent.com/photo1', width: 120, height: 120 },
        { url: 'https://lh3.googleusercontent.com/photo2' },
      ],
      isExplicit: false,
    };

    const parsed = TrackSchema.parse(rawTrack);
    expect(parsed.id).toBe('abc_456');
    expect(parsed.artists[0].name).toBe('Radiohead');
    expect(parsed.album?.title).toBe('OK Computer');
    expect(parsed.durationSeconds).toBe(261);
    expect(parsed.thumbnails).toHaveLength(2);
  });

  it('rejects Track missing essential id or title', () => {
    expect(() => TrackSchema.parse({ title: 'No ID' })).toThrow();
    expect(() => TrackSchema.parse({ id: 'only_id' })).toThrow();
  });

  it('validates Thumbnail schema', () => {
    const thumb = ThumbnailSchema.parse({ url: 'https://img.com/a.jpg', width: 300, height: 300 });
    expect(thumb.url).toBe('https://img.com/a.jpg');
    expect(thumb.width).toBe(300);
  });

  it('validates AudioStream schema prioritizing opus codec', () => {
    const stream = AudioStreamSchema.parse({
      url: 'https://googlevideo.com/videoplayback?id=123',
      mimeType: 'audio/webm; codecs="opus"',
      codec: 'opus',
      bitrate: 160000,
      sampleRate: 48000,
      expiresAt: Date.now() + 6 * 3600 * 1000,
    });

    expect(stream.codec).toBe('opus');
    expect(stream.bitrate).toBe(160000);
    expect(stream.url).toContain('videoplayback');
  });
});
