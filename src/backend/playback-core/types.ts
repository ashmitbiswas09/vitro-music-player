/**
 * Domain types and port interfaces for Playback Core.
 */

import type { Result, AppError, Track, Clock, Logger } from '@/backend/core';
import type { KeyValueStore } from '@/backend/platform';
import type { StreamResolver } from '@/backend/streaming';
import type { InnertubeClient } from '@/backend/innertube';
import type { PrefetchPlanner } from '@/backend/cache';

export type AudioEngineState =
  | 'IDLE'
  | 'LOADING'
  | 'BUFFERING'
  | 'PLAYING'
  | 'PAUSED'
  | 'ENDED'
  | 'ERROR';

export type PlaybackCoreState = AudioEngineState;
export type PlaybackState = AudioEngineState;

export type PlaybackRepeatMode = 'OFF' | 'ONE' | 'ALL';
export type RepeatMode = PlaybackRepeatMode;

export interface AudioTrackMetadata {
  id: string;
  title: string;
  artist: string;
  album?: string;
  durationSeconds?: number;
  artworkUrl?: string;
}

export interface AudioEngineError {
  message: string;
  statusCode?: number;
  code?: string;
  isNetworkOrAuthError?: boolean;
}

/**
 * Port interface for the native audio platform engine.
 * Implemented by React Native Track Player or platform media players.
 */
export interface AudioEngine {
  /**
   * Load and prepare an audio stream with required HTTP headers and track metadata.
   * CRITICAL: headers MUST pass stream.requestHeaders (e.g. User-Agent, Accept).
   */
  load(url: string, headers: Record<string, string>, metadata: AudioTrackMetadata): Promise<Result<void, AppError>>;

  play(): Promise<Result<void, AppError>>;
  pause(): Promise<Result<void, AppError>>;
  seekTo(positionMs: number): Promise<Result<void, AppError>>;
  setVolume(volume: number): Promise<Result<void, AppError>>;
  stop(): Promise<Result<void, AppError>>;

  getPosition(): Promise<number>;
  getDuration(): Promise<number>;
  getState(): AudioEngineState;

  // Subscriptions
  onStateChange(cb: (state: AudioEngineState) => void): () => void;
  onPositionChange(cb: (positionMs: number) => void): () => void;
  onTrackEnded(cb: () => void): () => void;
  onError(cb: (error: AudioEngineError) => void): () => void;
}

export interface PersistedPlaybackState {
  queue: Track[];
  originalQueue: Track[];
  currentIndex: number;
  positionMs: number;
  repeatMode: RepeatMode;
  shuffle: boolean;
  autoRadio: boolean;
  savedAt: number;
}

export interface DownloadLookup {
  getLocalTrackFilePath(videoId: string): Promise<string | null>;
}

export interface PlaybackServiceOptions {
  audioEngine: AudioEngine;
  streamResolver: StreamResolver;
  innertube?: InnertubeClient;
  prefetchPlanner?: PrefetchPlanner;
  storage?: KeyValueStore;
  clock?: Clock;
  logger?: Logger;
  autoRadio?: boolean;
  downloadLookup?: DownloadLookup;
}

export interface PlaybackCoreStatus {
  state: PlaybackState;
  currentTrack: Track | null;
  currentIndex: number;
  queueLength: number;
  positionMs: number;
  durationMs: number;
  repeatMode: RepeatMode;
  shuffle: boolean;
  autoRadio: boolean;
  bufferedMs?: number;
}

export type PlaybackStatus = PlaybackCoreStatus;
