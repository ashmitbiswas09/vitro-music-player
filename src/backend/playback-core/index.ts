/**
 * Playback core module public API.
 * Pure logic state machine (play, next, prev, shuffle, repeat, radio), prefetch planner, AudioEngine interface.
 */

export const PLAYBACK_CORE_MODULE_NAME = 'playback-core' as const;

export type {
  AudioEngine,
  AudioEngineState,
  AudioEngineError,
  AudioTrackMetadata,
  PlaybackCoreState,
  PlaybackRepeatMode,
  PersistedPlaybackState,
  PlaybackServiceOptions,
  PlaybackCoreStatus,
} from './types';

export { FakeAudioEngine } from './fake-audio-engine';
export { QueueManager } from './queue-manager';
export { PlaybackService } from './playback-service';
