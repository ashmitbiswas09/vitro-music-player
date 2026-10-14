/**
 * In-memory Fake AudioEngine for testing and headless environments.
 * Simulates playback lifecycle and event subscriptions.
 */

import { ok, type Result, type AppError } from '@/backend/core';
import type {
  AudioEngine,
  AudioEngineState,
  AudioEngineError,
  AudioTrackMetadata,
} from './types';

export class FakeAudioEngine implements AudioEngine {
  private state: AudioEngineState = 'IDLE';
  private currentUrl?: string;
  private currentHeaders: Record<string, string> = {};
  private currentMetadata?: AudioTrackMetadata;
  private positionMs = 0;
  private durationMs = 0;
  private volume = 1.0;

  // Listeners
  private readonly stateListeners = new Set<(state: AudioEngineState) => void>();
  private readonly positionListeners = new Set<(pos: number) => void>();
  private readonly endListeners = new Set<() => void>();
  private readonly errorListeners = new Set<(err: AudioEngineError) => void>();

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

  async load(
    url: string,
    headers: Record<string, string>,
    metadata: AudioTrackMetadata,
  ): Promise<Result<void, AppError>> {
    this.currentUrl = url;
    this.currentHeaders = { ...headers };
    this.currentMetadata = metadata;
    this.positionMs = 0;
    this.durationMs = (metadata.durationSeconds ?? 0) * 1000;
    this.setState('LOADING');
    return ok(undefined);
  }

  async play(): Promise<Result<void, AppError>> {
    this.setState('PLAYING');
    return ok(undefined);
  }

  async pause(): Promise<Result<void, AppError>> {
    this.setState('PAUSED');
    return ok(undefined);
  }

  async seekTo(positionMs: number): Promise<Result<void, AppError>> {
    this.positionMs = Math.max(0, positionMs);
    this.emitPosition(this.positionMs);
    return ok(undefined);
  }

  async setVolume(volume: number): Promise<Result<void, AppError>> {
    this.volume = Math.max(0, Math.min(1, volume));
    return ok(undefined);
  }

  async stop(): Promise<Result<void, AppError>> {
    this.positionMs = 0;
    this.setState('IDLE');
    return ok(undefined);
  }

  async getPosition(): Promise<number> {
    return this.positionMs;
  }

  async getDuration(): Promise<number> {
    return this.durationMs;
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

  // --- Test & Simulation Helpers ---

  setState(newState: AudioEngineState): void {
    this.state = newState;
    for (const listener of this.stateListeners) {
      listener(newState);
    }
  }

  emitPosition(posMs: number): void {
    this.positionMs = posMs;
    for (const listener of this.positionListeners) {
      listener(posMs);
    }
  }

  simulateTrackEnded(): void {
    this.setState('ENDED');
    for (const listener of this.endListeners) {
      listener();
    }
  }

  simulateError(error: AudioEngineError): void {
    this.setState('ERROR');
    for (const listener of this.errorListeners) {
      listener(error);
    }
  }
}
