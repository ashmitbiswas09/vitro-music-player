/**
 * Real React Native AudioEngine adapter powered by expo-audio (Android Media3 / ExoPlayer).
 * Conforms to the AudioEngine port for playing live network streams and offline downloads.
 */

import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioSource,
  type AudioStatus,
} from 'expo-audio';
import {
  ok,
  err,
  AppError,
  type Result,
} from '@/backend/core';
import type {
  AudioEngine,
  AudioEngineState,
  AudioEngineError,
  AudioTrackMetadata,
} from '../types';

export class RnAudioEngine implements AudioEngine {
  private static audioModeConfigured = false;

  private player: AudioPlayer | null = null;
  private readonly activePlayers = new Set<AudioPlayer>();
  private statusSubscription: { remove: () => void } | null = null;
  private state: AudioEngineState = 'IDLE';
  private currentUrl?: string;
  private currentHeaders: Record<string, string> = {};
  private currentMetadata?: AudioTrackMetadata;
  private currentPositionMs = 0;
  private currentDurationMs = 0;
  private volume = 1.0;
  private hasFiredEndedForCurrentTrack = false;

  // Listeners
  private readonly stateListeners = new Set<(state: AudioEngineState) => void>();
  private readonly positionListeners = new Set<(positionMs: number) => void>();
  private readonly endListeners = new Set<() => void>();
  private readonly errorListeners = new Set<(error: AudioEngineError) => void>();

  get loadedUrl(): string | undefined {
    return this.currentUrl;
  }

  get loadedHeaders(): Record<string, string> {
    return this.currentHeaders;
  }

  get loadedMetadata(): AudioTrackMetadata | undefined {
    return this.currentMetadata;
  }

  get currentVolume(): number {
    return this.volume;
  }

  getState(): AudioEngineState {
    return this.state;
  }

  private async ensureAudioModeConfigured(): Promise<void> {
    if (RnAudioEngine.audioModeConfigured) return;
    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        interruptionMode: 'doNotMix',
      });
      RnAudioEngine.audioModeConfigured = true;
    } catch {
      // Non-fatal if setting audio mode fails in certain runtime environments
    }
  }

  private stopAndReleasePlayer(player: AudioPlayer): void {
    try {
      player.pause();
    } catch {
      // ignore
    }
    try {
      if (typeof player.clearLockScreenControls === 'function') {
        player.clearLockScreenControls();
      } else if (typeof player.setActiveForLockScreen === 'function') {
        player.setActiveForLockScreen(false);
      }
    } catch {
      // ignore
    }
    try {
      if (typeof player.remove === 'function') {
        player.remove();
      }
    } catch {
      // ignore
    }
    this.activePlayers.delete(player);
  }

  private cleanupPlayer(): void {
    if (this.statusSubscription) {
      try {
        this.statusSubscription.remove();
      } catch {
        // ignore subscription removal error
      }
      this.statusSubscription = null;
    }

    if (this.player) {
      this.stopAndReleasePlayer(this.player);
      this.player = null;
    }

    // Defensively ensure all active players are paused and released
    for (const player of Array.from(this.activePlayers)) {
      this.stopAndReleasePlayer(player);
    }
    this.activePlayers.clear();
  }

  private secondsToMs(seconds: number | undefined | null): number {
    if (seconds == null || Number.isNaN(seconds) || seconds < 0) {
      return 0;
    }
    return Math.round(seconds * 1000);
  }

  async load(
    url: string,
    headers: Record<string, string>,
    metadata: AudioTrackMetadata,
  ): Promise<Result<void, AppError>> {
    await this.ensureAudioModeConfigured();

    this.currentUrl = url;
    this.currentHeaders = { ...headers };
    this.currentMetadata = metadata;
    this.currentPositionMs = 0;
    this.currentDurationMs = (metadata.durationSeconds ?? 0) * 1000;
    this.hasFiredEndedForCurrentTrack = false;
    this.setState('LOADING');

    const isRemote = url.startsWith('http://') || url.startsWith('https://');
    const hasHeaders = headers && Object.keys(headers).length > 0;
    const source: AudioSource = isRemote && hasHeaders
      ? { uri: url, headers }
      : { uri: url };

    // Prevent duplicate ExoPlayer instances:
    // If an AudioPlayer already exists and supports replace(), swap the MediaSource in-place.
    // This avoids spawning a second ExoPlayer instance on Android and guarantees single-track playback.
    if (this.player && typeof this.player.replace === 'function') {
      try {
        // Halt any ongoing audio immediately so old audio never bleeds over
        this.player.pause();
        this.player.replace(source);
        this.player.volume = this.volume;

        // Configure lock-screen / notification controls
        try {
          if (typeof this.player.setActiveForLockScreen === 'function') {
            this.player.setActiveForLockScreen(true, {
              title: metadata.title,
              artist: metadata.artist,
              albumTitle: metadata.album,
              artworkUrl: metadata.artworkUrl,
            });
          }
        } catch {
          // Non-fatal lockscreen notification setup
        }

        return ok(undefined);
      } catch {
        // If replace fails, fall back to clean recreation
        this.cleanupPlayer();
      }
    } else {
      this.cleanupPlayer();
    }

    try {
      this.player = createAudioPlayer(source, { updateInterval: 250 });
      this.activePlayers.add(this.player);
      this.player.volume = this.volume;

      this.statusSubscription = this.player.addListener(
        'playbackStatusUpdate',
        (status: AudioStatus) => {
          this.handlePlaybackStatusUpdate(status);
        },
      );

      // Configure lock-screen / notification controls
      try {
        if (typeof this.player.setActiveForLockScreen === 'function') {
          this.player.setActiveForLockScreen(true, {
            title: metadata.title,
            artist: metadata.artist,
            albumTitle: metadata.album,
            artworkUrl: metadata.artworkUrl,
          });
        }
      } catch {
        // Non-fatal lockscreen notification setup
      }

      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.setState('ERROR');
      return err(new AppError(`Failed to load audio source: ${message}`, 'STREAM_ERROR'));
    }
  }

  private handlePlaybackStatusUpdate(status: AudioStatus): void {
    if (!this.player) return;

    if (typeof status.currentTime === 'number') {
      this.currentPositionMs = this.secondsToMs(status.currentTime);
    }
    if (typeof status.duration === 'number' && status.duration > 0) {
      this.currentDurationMs = this.secondsToMs(status.duration);
    }

    // 1. Check for player error
    if (status.error) {
      this.setState('ERROR');
      const isNetworkOrAuth =
        status.error.includes('403') ||
        status.error.includes('network') ||
        status.error.includes('HttpDataSource') ||
        status.error.includes('BehindLiveWindowException') ||
        status.error.includes('timeout') ||
        status.error.includes('Connection') ||
        status.error.includes('Source error');
      this.emitError({
        message: status.error,
        isNetworkOrAuthError: isNetworkOrAuth,
      });
      return;
    }

    // 2. Emit position update
    this.emitPosition(this.currentPositionMs);

    // 3. Check for track completion (emit ENDED and onTrackEnded exactly once)
    if (status.didJustFinish) {
      if (!this.hasFiredEndedForCurrentTrack) {
        this.hasFiredEndedForCurrentTrack = true;
        this.setState('ENDED');
        this.emitTrackEnded();
      }
      return;
    }

    // 4. Map native playback state to AudioEngineState
    if (status.isBuffering) {
      this.setState('BUFFERING');
    } else if (status.playing) {
      this.setState('PLAYING');
    } else if (status.isLoaded) {
      this.setState('PAUSED');
    } else {
      this.setState('LOADING');
    }
  }

  simulateError(errObj: AudioEngineError): void {
    this.setState('ERROR');
    this.emitError(errObj);
  }

  async play(): Promise<Result<void, AppError>> {
    if (!this.player) {
      return err(new AppError('No player loaded', 'APP_ERROR'));
    }
    // Pause any other active players before starting playback on current player
    for (const p of this.activePlayers) {
      if (p !== this.player) {
        try {
          p.pause();
        } catch {
          // ignore
        }
      }
    }
    try {
      this.hasFiredEndedForCurrentTrack = false;
      this.player.play();
      this.setState('PLAYING');
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err(new AppError(`Play failed: ${message}`, 'APP_ERROR'));
    }
  }

  async pause(): Promise<Result<void, AppError>> {
    // Explicitly pause ALL active players to guarantee zero sound escapes
    for (const p of this.activePlayers) {
      try {
        p.pause();
      } catch {
        // ignore
      }
    }
    if (this.player) {
      try {
        this.player.pause();
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return err(new AppError(`Pause failed: ${message}`, 'APP_ERROR'));
      }
    }
    this.setState('PAUSED');
    return ok(undefined);
  }

  async seekTo(positionMs: number): Promise<Result<void, AppError>> {
    const safePositionMs = Math.max(0, positionMs);
    const seconds = safePositionMs / 1000;
    this.currentPositionMs = safePositionMs;

    if (this.hasFiredEndedForCurrentTrack && safePositionMs < this.currentDurationMs) {
      this.hasFiredEndedForCurrentTrack = false;
    }

    if (this.player) {
      try {
        await this.player.seekTo(seconds);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return err(new AppError(`Seek failed: ${message}`, 'APP_ERROR'));
      }
    }

    this.emitPosition(safePositionMs);
    return ok(undefined);
  }

  async setVolume(volume: number): Promise<Result<void, AppError>> {
    this.volume = Math.max(0, Math.min(1, volume));
    for (const p of this.activePlayers) {
      try {
        p.volume = this.volume;
      } catch {
        // ignore
      }
    }
    return ok(undefined);
  }

  async stop(): Promise<Result<void, AppError>> {
    this.cleanupPlayer();
    this.currentPositionMs = 0;
    this.currentUrl = undefined;
    this.currentHeaders = {};
    this.currentMetadata = undefined;
    this.setState('IDLE');
    return ok(undefined);
  }

  async getPosition(): Promise<number> {
    if (this.player && typeof this.player.currentTime === 'number' && this.player.currentTime > 0) {
      this.currentPositionMs = this.secondsToMs(this.player.currentTime);
    }
    return this.currentPositionMs;
  }

  async getDuration(): Promise<number> {
    if (this.player && typeof this.player.duration === 'number' && this.player.duration > 0) {
      this.currentDurationMs = this.secondsToMs(this.player.duration);
    }
    return this.currentDurationMs;
  }

  // --- Subscriptions ---

  onStateChange(cb: (state: AudioEngineState) => void): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  onPositionChange(cb: (positionMs: number) => void): () => void {
    this.positionListeners.add(cb);
    return () => this.positionListeners.delete(cb);
  }

  onTrackEnded(cb: () => void): () => void {
    this.endListeners.add(cb);
    return () => this.endListeners.delete(cb);
  }

  onError(cb: (error: AudioEngineError) => void): () => void {
    this.errorListeners.add(cb);
    return () => this.errorListeners.delete(cb);
  }

  private setState(newState: AudioEngineState): void {
    if (this.state === newState) return;
    this.state = newState;
    for (const listener of this.stateListeners) {
      try {
        listener(newState);
      } catch {
        // ignore callback error
      }
    }
  }

  private emitPosition(posMs: number): void {
    for (const listener of this.positionListeners) {
      try {
        listener(posMs);
      } catch {
        // ignore callback error
      }
    }
  }

  private emitTrackEnded(): void {
    for (const listener of this.endListeners) {
      try {
        listener();
      } catch {
        // ignore callback error
      }
    }
  }

  private emitError(errObj: AudioEngineError): void {
    for (const listener of this.errorListeners) {
      try {
        listener(errObj);
      } catch {
        // ignore callback error
      }
    }
  }
}
