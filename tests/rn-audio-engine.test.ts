/**
 * Phase 11: Real Native AudioEngine Adapter Unit Tests (RnAudioEngine)
 * Tests expo-audio adapter lifecycle, header forwarding, seconds <-> ms conversions,
 * lock-screen metadata registration, native player leak prevention, and state transitions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AudioTrackMetadata, AudioEngineState, AudioEngineError } from '@/backend/platform';

interface MockStatus {
  id?: string;
  currentTime?: number;
  duration?: number;
  playing?: boolean;
  isBuffering?: boolean;
  isLoaded?: boolean;
  didJustFinish?: boolean;
  error?: string | null;
}

class MockAudioPlayer {
  id = 'mock-player-id';
  playing = false;
  muted = false;
  loop = false;
  paused = true;
  isLoaded = true;
  isBuffering = false;
  currentTime = 0;
  duration = 0;
  volume = 1.0;
  playbackRate = 1.0;
  source: unknown;
  options: unknown;

  listeners: Record<string, ((status: unknown) => void)[]> = {};
  removed = false;
  lockScreenActive = false;
  lockScreenMetadata: unknown = null;
  lockScreenOptions: unknown = null;
  pauseCalls = 0;

  constructor(source: unknown, options: unknown) {
    this.source = source;
    this.options = options;
    mockAudioPlayerInstances.push(this);
  }

  addListener(event: string, cb: (status: unknown) => void) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(cb);
    return {
      remove: () => {
        const arr = this.listeners[event];
        if (arr) {
          const idx = arr.indexOf(cb);
          if (idx !== -1) arr.splice(idx, 1);
        }
      },
    };
  }

  emit(event: string, data: MockStatus) {
    if (typeof data.currentTime === 'number') {
      this.currentTime = data.currentTime;
    }
    if (typeof data.duration === 'number') {
      this.duration = data.duration;
    }
    const arr = this.listeners[event];
    if (arr) {
      for (const cb of [...arr]) {
        cb(data);
      }
    }
  }

  play() {
    this.playing = true;
    this.paused = false;
  }

  pause() {
    this.playing = false;
    this.paused = true;
    this.pauseCalls++;
  }

  async seekTo(seconds: number) {
    this.currentTime = seconds;
  }

  setActiveForLockScreen(active: boolean, metadata?: unknown) {
    this.lockScreenActive = active;
    this.lockScreenMetadata = metadata;
  }

  clearLockScreenControls() {
    this.lockScreenActive = false;
  }

  remove() {
    this.removed = true;
  }
}

let mockAudioPlayerInstances: MockAudioPlayer[] = [];
let mockSetAudioModeCalls: unknown[] = [];

vi.mock('expo-audio', () => ({
  createAudioPlayer: vi.fn((source, options) => new MockAudioPlayer(source, options)),
  setAudioModeAsync: vi.fn(async (mode) => {
    mockSetAudioModeCalls.push(mode);
  }),
}));

// Dynamic import to ensure vi.mock has hoisted
const { RnAudioEngine } = await import('@/backend/platform/rn/rn-audio-engine');

describe('Phase 11: RnAudioEngine Adapter (expo-audio)', () => {
  const sampleMetadata: AudioTrackMetadata = {
    id: '9RfVp-GhKfs',
    title: 'Creep',
    artist: 'Radiohead',
    album: 'Pablo Honey',
    durationSeconds: 238,
    artworkUrl: 'https://i.ytimg.com/vi/9RfVp-GhKfs/hqdefault.jpg',
  };

  beforeEach(() => {
    mockAudioPlayerInstances = [];
    mockSetAudioModeCalls = [];
  });

  it('configures audio mode with silent mode, background playback, and doNotMix on first load', async () => {
    const engine = new RnAudioEngine();
    await engine.load(
      'https://rr4---sn-test.googlevideo.com/videoplayback?id=123',
      { 'User-Agent': 'TestUA', Accept: '*/*' },
      sampleMetadata,
    );

    expect(mockSetAudioModeCalls.length).toBeGreaterThanOrEqual(1);
    expect(mockSetAudioModeCalls[0]).toEqual({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    });
  });

  it('forwards custom request headers on remote http/https URLs into AudioSource.headers', async () => {
    const engine = new RnAudioEngine();
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Android; Mobile)',
      Accept: 'audio/webm',
    };
    await engine.load(
      'https://rr4---sn-test.googlevideo.com/videoplayback?id=123',
      headers,
      sampleMetadata,
    );

    expect(mockAudioPlayerInstances.length).toBe(1);
    const player = mockAudioPlayerInstances[0];
    expect(player.source).toEqual({
      uri: 'https://rr4---sn-test.googlevideo.com/videoplayback?id=123',
      headers,
    });
  });

  it('omits headers and passes clean uri for local file:/// URLs', async () => {
    const engine = new RnAudioEngine();
    const localUri = 'file:///data/user/0/com.anonymous.mymusicapp/files/downloads/9RfVp-GhKfs.webm';
    await engine.load(localUri, { 'User-Agent': 'Unused' }, sampleMetadata);

    expect(mockAudioPlayerInstances.length).toBe(1);
    const player = mockAudioPlayerInstances[0];
    expect(player.source).toEqual({
      uri: localUri,
    });
  });

  it('registers track title, artist, album, and artwork with setActiveForLockScreen', async () => {
    const engine = new RnAudioEngine();
    await engine.load(
      'https://example.com/audio.webm',
      {},
      sampleMetadata,
    );

    const player = mockAudioPlayerInstances[0];
    expect(player.lockScreenActive).toBe(true);
    expect(player.lockScreenMetadata).toEqual({
      title: 'Creep',
      artist: 'Radiohead',
      albumTitle: 'Pablo Honey',
      artworkUrl: 'https://i.ytimg.com/vi/9RfVp-GhKfs/hqdefault.jpg',
    });
  });

  it('prevents native player leaks by explicitly pausing and removing previous player when loading a new track', async () => {
    const engine = new RnAudioEngine();
    await engine.load('https://example.com/track1.webm', {}, sampleMetadata);
    expect(mockAudioPlayerInstances.length).toBe(1);
    const firstPlayer = mockAudioPlayerInstances[0];
    expect(firstPlayer.removed).toBe(false);

    // Load second track
    await engine.load('https://example.com/track2.webm', {}, { ...sampleMetadata, id: 'track2' });
    expect(mockAudioPlayerInstances.length).toBe(2);
    expect(firstPlayer.removed).toBe(true);
    // Crucial: ensure pause() was explicitly called so ExoPlayer doesn't leak audio in native background
    expect(firstPlayer.pauseCalls).toBeGreaterThanOrEqual(1);
    expect(mockAudioPlayerInstances[1].removed).toBe(false);
  });

  it('reuses existing AudioPlayer via replace() when replace method is available', async () => {
    const engine = new RnAudioEngine();
    await engine.load('https://example.com/track1.webm', {}, sampleMetadata);
    expect(mockAudioPlayerInstances.length).toBe(1);
    const player = mockAudioPlayerInstances[0];

    // Attach replace method to player mock
    const replaceMock = vi.fn();
    (player as unknown as { replace: unknown }).replace = replaceMock;

    // Load second track
    await engine.load('https://example.com/track2.webm', {}, { ...sampleMetadata, id: 'track2' });

    // Should NOT create a second player instance; reuses the existing one
    expect(mockAudioPlayerInstances.length).toBe(1);
    expect(replaceMock).toHaveBeenCalledWith({ uri: 'https://example.com/track2.webm' });
    expect(player.pauseCalls).toBeGreaterThanOrEqual(1);
  });

  it('pauses all active players when pause() is called', async () => {
    const engine = new RnAudioEngine();
    await engine.load('https://example.com/track1.webm', {}, sampleMetadata);
    const player = mockAudioPlayerInstances[0];

    await engine.play();
    expect(player.playing).toBe(true);

    await engine.pause();
    expect(player.pauseCalls).toBeGreaterThanOrEqual(1);
    expect(engine.getState()).toBe('PAUSED');
  });

  it('converts seconds to milliseconds for currentTime, duration, and position updates', async () => {
    const engine = new RnAudioEngine();
    const positions: number[] = [];
    engine.onPositionChange((pos) => positions.push(pos));

    await engine.load('https://example.com/track.webm', {}, sampleMetadata);
    const player = mockAudioPlayerInstances[0];

    // Status update with 15.42 seconds
    player.emit('playbackStatusUpdate', {
      currentTime: 15.42,
      duration: 238.0,
      playing: true,
      isLoaded: true,
      isBuffering: false,
      didJustFinish: false,
    });

    expect(positions).toContain(15420);
    expect(await engine.getPosition()).toBe(15420);
    expect(await engine.getDuration()).toBe(238000);
  });

  it('converts seek milliseconds to seconds when calling player.seekTo', async () => {
    const engine = new RnAudioEngine();
    await engine.load('https://example.com/track.webm', {}, sampleMetadata);
    const player = mockAudioPlayerInstances[0];

    await engine.seekTo(45000); // 45,000 ms = 45 seconds
    expect(player.currentTime).toBe(45);
    expect(await engine.getPosition()).toBe(45000);
  });

  it('maps native status transitions cleanly to AudioEngineState', async () => {
    const engine = new RnAudioEngine();
    const states: AudioEngineState[] = [];
    engine.onStateChange((state) => states.push(state));

    await engine.load('https://example.com/track.webm', {}, sampleMetadata);
    expect(states).toContain('LOADING');

    const player = mockAudioPlayerInstances[0];

    // Buffering
    player.emit('playbackStatusUpdate', {
      isBuffering: true,
      playing: true,
      isLoaded: true,
    });
    expect(states[states.length - 1]).toBe('BUFFERING');

    // Playing
    player.emit('playbackStatusUpdate', {
      isBuffering: false,
      playing: true,
      isLoaded: true,
    });
    expect(states[states.length - 1]).toBe('PLAYING');

    // Paused
    player.emit('playbackStatusUpdate', {
      isBuffering: false,
      playing: false,
      isLoaded: true,
    });
    expect(states[states.length - 1]).toBe('PAUSED');
  });

  it('emits ENDED and invokes onTrackEnded exactly once on didJustFinish', async () => {
    const engine = new RnAudioEngine();
    let endCount = 0;
    engine.onTrackEnded(() => {
      endCount++;
    });

    await engine.load('https://example.com/track.webm', {}, sampleMetadata);
    const player = mockAudioPlayerInstances[0];

    // First didJustFinish status
    player.emit('playbackStatusUpdate', {
      didJustFinish: true,
      currentTime: 238.0,
      duration: 238.0,
    });

    expect(endCount).toBe(1);
    expect(engine.getState()).toBe('ENDED');

    // Duplicate didJustFinish status should NOT trigger onTrackEnded again
    player.emit('playbackStatusUpdate', {
      didJustFinish: true,
      currentTime: 238.0,
      duration: 238.0,
    });

    expect(endCount).toBe(1);
  });

  it('emits ERROR and notifies onError when playback error occurs with isNetworkOrAuthError detection', async () => {
    const engine = new RnAudioEngine();
    const errors: AudioEngineError[] = [];
    engine.onError((err) => errors.push(err));

    await engine.load('https://example.com/track.webm', {}, sampleMetadata);
    const player = mockAudioPlayerInstances[0];

    player.emit('playbackStatusUpdate', {
      error: 'HttpDataSource$InvalidResponseCodeException: Response code: 403',
      playing: false,
    });

    expect(engine.getState()).toBe('ERROR');
    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain('403');
    expect(errors[0].isNetworkOrAuthError).toBe(true);
  });

  it('cleans up resources and resets position on stop()', async () => {
    const engine = new RnAudioEngine();
    await engine.load('https://example.com/track.webm', {}, sampleMetadata);
    const player = mockAudioPlayerInstances[0];

    await engine.seekTo(30000);
    expect(await engine.getPosition()).toBe(30000);

    await engine.stop();
    expect(player.removed).toBe(true);
    expect(engine.getState()).toBe('IDLE');
    expect(await engine.getPosition()).toBe(0);
  });

  it('sets and clamps volume between 0.0 and 1.0', async () => {
    const engine = new RnAudioEngine();
    await engine.load('https://example.com/track.webm', {}, sampleMetadata);
    const player = mockAudioPlayerInstances[0];

    await engine.setVolume(0.8);
    expect(player.volume).toBe(0.8);
    expect(engine.currentVolume).toBe(0.8);

    await engine.setVolume(1.5); // clamped to 1.0
    expect(player.volume).toBe(1.0);

    await engine.setVolume(-0.2); // clamped to 0.0
    expect(player.volume).toBe(0.0);
  });
});
