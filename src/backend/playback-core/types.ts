/**
 * Domain types and port interfaces for Playback Core.
 */

import type { Track, Clock, Logger } from '@/backend/core';
import type {
  KeyValueStore,
  AudioEngine,
  AudioEngineState,
  AudioTrackMetadata,
  AudioEngineError,
} from '@/backend/platform';
import type { StreamResolver } from '@/backend/streaming';
import type { InnertubeClient } from '@/backend/innertube';
import type { PrefetchPlanner } from '@/backend/cache';

export type { AudioEngine, AudioEngineState, AudioTrackMetadata, AudioEngineError };

export type PlaybackCoreState = AudioEngineState;
export type PlaybackState = AudioEngineState;

export type PlaybackRepeatMode = 'OFF' | 'ONE' | 'ALL';
export type RepeatMode = PlaybackRepeatMode;


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
