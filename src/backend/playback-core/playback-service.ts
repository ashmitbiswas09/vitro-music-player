/**
 * Headless Playback Service.
 * Pure TypeScript state machine coordinating audio engine, queue manager,
 * stream resolution, URL expiry checks, 403 recovery, prefetching, and state persistence.
 */

import {
  ok,
  err,
  type Result,
  type AppError,
  type Track,
  type Clock,
  type Logger,
  SystemClock,
  createLogger,
} from '@/backend/core';
import type { KeyValueStore } from '@/backend/platform';
import type { StreamResolver } from '@/backend/streaming';
import type { InnertubeClient } from '@/backend/innertube';
import type { PrefetchPlanner } from '@/backend/cache';
import { QueueManager } from './queue-manager';
import type {
  AudioEngine,
  AudioEngineState,
  AudioEngineError,
  AudioTrackMetadata,
  PlaybackState,
  RepeatMode,
  PlaybackServiceOptions,
  PlaybackStatus,
  PersistedPlaybackState,
} from './types';

const STORAGE_KEY_PLAYBACK_STATE = 'playback:state';

export class PlaybackService {
  private readonly audioEngine: AudioEngine;
  private readonly streamResolver: StreamResolver;
  private readonly innertube?: InnertubeClient;
  private readonly prefetchPlanner?: PrefetchPlanner;
  private readonly storage?: KeyValueStore;
  private readonly clock: Clock;
  private readonly logger: Logger;

  private readonly queueManager = new QueueManager();
  private state: PlaybackState = 'IDLE';
  private autoRadioEnabled: boolean;
  private currentPositionMs = 0;
  private currentDurationMs = 0;

  // Track error retry tracking (prevents infinite 403 reload loops)
  private retriedVideoIds = new Set<string>();

  // Status change listeners
  private readonly statusListeners = new Set<(status: PlaybackStatus) => void>();

  constructor(options: PlaybackServiceOptions) {
    this.audioEngine = options.audioEngine;
    this.streamResolver = options.streamResolver;
    this.innertube = options.innertube;
    this.prefetchPlanner = options.prefetchPlanner;
    this.storage = options.storage;
    this.clock = options.clock ?? new SystemClock();
    this.logger = options.logger ?? createLogger({ prefix: 'PlaybackService' });
    this.autoRadioEnabled = options.autoRadio ?? false;

    this.setupAudioEngineListeners();
  }

  get queue(): QueueManager {
    return this.queueManager;
  }

  getStatus(): PlaybackStatus {
    return {
      state: this.state,
      currentTrack: this.queueManager.getCurrentTrack(),
      currentIndex: this.queueManager.index,
      queueLength: this.queueManager.length,
      positionMs: this.currentPositionMs,
      durationMs: this.currentDurationMs,
      repeatMode: this.queueManager.currentRepeatMode,
      shuffle: this.queueManager.isShuffled,
      autoRadio: this.autoRadioEnabled,
    };
  }

  onStatusChange(cb: (status: PlaybackStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  private notifyStatus(): void {
    const status = this.getStatus();
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  private setState(newState: PlaybackState): void {
    if (this.state === newState) return;
    this.state = newState;
    this.logger.debug(`Playback state transition -> ${newState}`);
    this.notifyStatus();
  }

  private setupAudioEngineListeners(): void {
    this.audioEngine.onStateChange((engineState: AudioEngineState) => {
      this.setState(engineState);
    });

    this.audioEngine.onPositionChange((pos: number) => {
      this.currentPositionMs = pos;
      this.notifyStatus();
    });

    this.audioEngine.onTrackEnded(async () => {
      await this.handleTrackEnded();
    });

    this.audioEngine.onError(async (error: AudioEngineError) => {
      await this.handleAudioEngineError(error);
    });
  }

  // --- Queue Operations ---

  async setQueue(tracks: Track[], startIndex = 0): Promise<Result<void, AppError>> {
    this.queueManager.setQueue(tracks, startIndex);
    this.retriedVideoIds.clear();
    await this.saveState();
    this.notifyStatus();

    if (this.queueManager.getCurrentTrack()) {
      return this.loadAndPlayCurrent();
    }
    return ok(undefined);
  }

  async play(): Promise<Result<void, AppError>> {
    if (this.state === 'PAUSED') {
      return this.audioEngine.play();
    }
    if (this.state === 'IDLE' || this.state === 'ENDED') {
      return this.loadAndPlayCurrent();
    }
    return ok(undefined);
  }

  async pause(): Promise<Result<void, AppError>> {
    const res = await this.audioEngine.pause();
    if (res.ok) {
      await this.saveState();
    }
    return res;
  }

  async togglePlayPause(): Promise<Result<void, AppError>> {
    if (this.state === 'PLAYING') {
      return this.pause();
    }
    return this.play();
  }

  async seekTo(positionMs: number): Promise<Result<void, AppError>> {
    const res = await this.audioEngine.seekTo(positionMs);
    if (res.ok) {
      this.currentPositionMs = positionMs;
      await this.saveState();
    }
    return res;
  }

  async setVolume(volume: number): Promise<Result<void, AppError>> {
    return this.audioEngine.setVolume(volume);
  }

  async stop(): Promise<Result<void, AppError>> {
    const res = await this.audioEngine.stop();
    this.setState('IDLE');
    this.currentPositionMs = 0;
    return res;
  }

  async next(forceAdvance = false): Promise<Result<void, AppError>> {
    const nextTrack = this.queueManager.next(forceAdvance);
    if (!nextTrack) {
      if (this.autoRadioEnabled && this.queueManager.getCurrentTrack()) {
        const loadedRadio = await this.fetchAndAppendAutoRadio();
        if (loadedRadio) {
          const radioNext = this.queueManager.next(true);
          if (radioNext) {
            return this.loadAndPlayCurrent();
          }
        }
      }
      this.setState('ENDED');
      return ok(undefined);
    }

    return this.loadAndPlayCurrent();
  }

  async previous(): Promise<Result<void, AppError>> {
    this.queueManager.previous(this.currentPositionMs);
    return this.loadAndPlayCurrent();
  }

  async playNext(track: Track): Promise<void> {
    this.queueManager.playNext(track);
    await this.saveState();
    this.notifyStatus();
    this.triggerPrefetch();
  }

  async addToQueue(track: Track): Promise<void> {
    this.queueManager.addToQueue(track);
    await this.saveState();
    this.notifyStatus();
  }

  async removeFromQueue(index: number): Promise<void> {
    const isCurrent = index === this.queueManager.index;
    this.queueManager.removeFromQueue(index);
    await this.saveState();
    this.notifyStatus();

    if (isCurrent) {
      if (this.queueManager.getCurrentTrack()) {
        await this.loadAndPlayCurrent();
      } else {
        await this.stop();
      }
    }
  }

  async moveInQueue(from: number, to: number): Promise<void> {
    this.queueManager.moveInQueue(from, to);
    await this.saveState();
    this.notifyStatus();
  }

  async clearQueue(): Promise<void> {
    await this.stop();
    this.queueManager.clearQueue();
    await this.saveState();
    this.notifyStatus();
  }

  setRepeatMode(mode: RepeatMode): void {
    this.queueManager.setRepeatMode(mode);
    this.saveState();
    this.notifyStatus();
  }

  toggleShuffle(): void {
    this.queueManager.setShuffle(!this.queueManager.isShuffled);
    this.saveState();
    this.notifyStatus();
    this.triggerPrefetch();
  }

  setAutoRadio(enabled: boolean): void {
    this.autoRadioEnabled = enabled;
    this.saveState();
    this.notifyStatus();
  }

  // --- Core Playback Execution ---

  private async loadAndPlayCurrent(forceFresh = false): Promise<Result<void, AppError>> {
    const track = this.queueManager.getCurrentTrack();
    if (!track) {
      this.setState('IDLE');
      return ok(undefined);
    }

    this.setState('LOADING');
    this.currentPositionMs = 0;
    this.currentDurationMs = (track.durationSeconds ?? 0) * 1000;

    // 1. Resolve stream URL
    this.logger.info(`Resolving audio stream for "${track.id}" (${track.title})...`);
    let res = await this.streamResolver.resolve(track.id, { forceFresh });

    if (!res.ok) {
      this.logger.error(`Failed to resolve stream for track "${track.id}": ${res.error.message}`);
      this.setState('ERROR');
      return err(res.error);
    }

    // 2. Check stream expiry: If expiring within 60s, invalidate and re-resolve
    const now = this.clock.now();
    if (now >= res.value.stream.expiresAt - 60_000) {
      this.logger.info(`Resolved stream for "${track.id}" is expiring within 60s. Refreshing...`);
      await this.streamResolver.invalidateStream?.(track.id);
      res = await this.streamResolver.resolve(track.id, { forceFresh: true });
      if (!res.ok) {
        this.setState('ERROR');
        return err(res.error);
      }
    }

    const { stream, requestHeaders } = res.value;

    // 3. Prepare metadata
    const metadata: AudioTrackMetadata = {
      id: track.id,
      title: track.title,
      artist: track.artists.map((a) => a.name).join(', ') || 'Unknown Artist',
      album: track.album?.title,
      durationSeconds: track.durationSeconds,
      artworkUrl: track.thumbnails?.[0]?.url,
    };

    // 4. Load into AudioEngine with critical request headers
    const loadRes = await this.audioEngine.load(stream.url, requestHeaders, metadata);
    if (!loadRes.ok) {
      this.setState('ERROR');
      return loadRes;
    }

    // 5. Play
    const playRes = await this.audioEngine.play();
    if (!playRes.ok) {
      this.setState('ERROR');
      return playRes;
    }

    this.setState('PLAYING');
    await this.saveState();

    // 6. Trigger prefetching for next 1-2 tracks
    this.triggerPrefetch();

    return ok(undefined);
  }

  private async handleTrackEnded(): Promise<void> {
    this.logger.info('Track ended event received');
    if (this.queueManager.currentRepeatMode === 'ONE') {
      await this.audioEngine.seekTo(0);
      await this.audioEngine.play();
      return;
    }

    await this.next(false);
  }

  private async handleAudioEngineError(error: AudioEngineError): Promise<void> {
    const track = this.queueManager.getCurrentTrack();
    if (!track) {
      this.setState('ERROR');
      return;
    }

    const is403 = error.statusCode === 403 || error.message.includes('403');
    const isNetworkOrAuth = error.isNetworkOrAuthError || is403;

    if (isNetworkOrAuth && !this.retriedVideoIds.has(track.id)) {
      this.logger.warn(
        `AudioEngine encountered network/auth error (HTTP 403). Retrying track "${track.id}" once...`,
      );
      this.retriedVideoIds.add(track.id);
      await this.streamResolver.invalidateStream?.(track.id);
      const retryRes = await this.loadAndPlayCurrent(true);
      if (retryRes.ok) {
        this.logger.info(`Successfully recovered and resumed playback for "${track.id}"`);
        return;
      }
    }

    this.logger.error(`Fatal audio error for track "${track.id}": ${error.message}`);
    this.setState('ERROR');
  }

  // --- Prefetching & Auto-Radio ---

  private triggerPrefetch(): void {
    const upcoming = this.queueManager.getUpcomingTracks(2);
    if (upcoming.length === 0) return;

    for (const nextTrack of upcoming) {
      this.logger.debug(`Triggering prefetch for upcoming track: "${nextTrack.id}"`);
      // Pre-resolve stream URL into memory cache in the background
      this.streamResolver.resolve(nextTrack.id).catch(() => {
        // Ignored in background
      });
    }
  }

  private async fetchAndAppendAutoRadio(): Promise<boolean> {
    const currentTrack = this.queueManager.getCurrentTrack();
    if (!currentTrack || !this.innertube) return false;

    this.logger.info(`Queue reached end. Fetching auto-radio continuations for "${currentTrack.id}"...`);
    try {
      const nextRes = await this.innertube.getNext(currentTrack.id);
      if (nextRes.ok && nextRes.value.queue.length > 0) {
        const existingIds = new Set(this.queueManager.queue.map((t) => t.id));
        const newTracks = nextRes.value.queue.filter((t: Track) => !existingIds.has(t.id));

        if (newTracks.length > 0) {
          for (const t of newTracks) {
            this.queueManager.addToQueue(t);
          }
          await this.saveState();
          this.notifyStatus();
          this.logger.info(`Auto-radio appended ${newTracks.length} tracks to queue`);
          return true;
        }
      }
    } catch (caught) {
      this.logger.warn(`Failed to fetch auto-radio continuation: ${String(caught)}`);
    }
    return false;
  }

  // --- Persistence & State Restoration ---

  async saveState(): Promise<void> {
    if (!this.storage) return;

    const persisted: PersistedPlaybackState = {
      queue: this.queueManager.queue,
      originalQueue: this.queueManager.rawOriginalQueue,
      currentIndex: this.queueManager.index,
      positionMs: this.currentPositionMs,
      repeatMode: this.queueManager.currentRepeatMode,
      shuffle: this.queueManager.isShuffled,
      autoRadio: this.autoRadioEnabled,
      savedAt: this.clock.now(),
    };

    try {
      await this.storage.set(STORAGE_KEY_PLAYBACK_STATE, JSON.stringify(persisted));
      this.logger.debug('Playback state successfully persisted to storage');
    } catch (caught) {
      this.logger.warn(`Failed to persist playback state: ${String(caught)}`);
    }
  }

  async restoreState(): Promise<boolean> {
    if (!this.storage) return false;

    try {
      const res = await this.storage.get(STORAGE_KEY_PLAYBACK_STATE);
      if (!res.ok || !res.value) return false;

      const data = JSON.parse(res.value) as PersistedPlaybackState;
      if (!Array.isArray(data.queue) || data.queue.length === 0) return false;

      this.queueManager.restore({
        queue: data.queue,
        originalQueue: data.originalQueue,
        currentIndex: data.currentIndex,
        repeatMode: data.repeatMode,
        shuffle: data.shuffle,
      });

      this.autoRadioEnabled = data.autoRadio ?? false;
      this.currentPositionMs = data.positionMs ?? 0;
      const currentTrack = this.queueManager.getCurrentTrack();
      this.currentDurationMs = (currentTrack?.durationSeconds ?? 0) * 1000;
      this.setState('PAUSED');

      this.logger.info(
        `Restored playback state on cold-start: ${data.queue.length} tracks, index ${data.currentIndex}, pos ${data.positionMs}ms`,
      );
      this.notifyStatus();
      return true;
    } catch (caught) {
      this.logger.warn(`Failed to restore playback state: ${String(caught)}`);
      return false;
    }
  }
}
