/**
 * Pure TypeScript queue manager with shuffle preservation, repeat modes, and index navigation.
 */

import type { Track } from '@/backend/core';
import type { RepeatMode } from './types';

export class QueueManager {
  private originalQueue: Track[] = [];
  private activeQueue: Track[] = [];
  private currentIndex = -1;
  private repeatMode: RepeatMode = 'OFF';
  private shuffle = false;

  get queue(): Track[] {
    return [...this.activeQueue];
  }

  get rawOriginalQueue(): Track[] {
    return [...this.originalQueue];
  }

  get index(): number {
    return this.currentIndex;
  }

  get currentRepeatMode(): RepeatMode {
    return this.repeatMode;
  }

  get isShuffled(): boolean {
    return this.shuffle;
  }

  get length(): number {
    return this.activeQueue.length;
  }

  setQueue(tracks: Track[], startIndex = 0): void {
    if (!tracks || tracks.length === 0) {
      this.clearQueue();
      return;
    }

    const safeStart = Math.max(0, Math.min(startIndex, tracks.length - 1));
    this.originalQueue = [...tracks];

    if (this.shuffle) {
      // Keep selected track first, shuffle the remaining tracks
      const selected = tracks[safeStart];
      const remaining = tracks.filter((_, i) => i !== safeStart);
      this.activeQueue = [selected, ...this.fisherYates(remaining)];
      this.currentIndex = 0;
    } else {
      this.activeQueue = [...tracks];
      this.currentIndex = safeStart;
    }
  }

  playNext(track: Track): void {
    if (this.activeQueue.length === 0) {
      this.setQueue([track], 0);
      return;
    }

    const insertIndex = this.currentIndex + 1;
    this.activeQueue.splice(insertIndex, 0, track);

    // Also update originalQueue
    const origIndex = this.getCurrentTrack()
      ? this.originalQueue.findIndex((t) => t.id === this.getCurrentTrack()?.id)
      : -1;
    if (origIndex !== -1) {
      this.originalQueue.splice(origIndex + 1, 0, track);
    } else {
      this.originalQueue.push(track);
    }
  }

  addToQueue(track: Track): void {
    if (this.activeQueue.length === 0) {
      this.setQueue([track], 0);
      return;
    }
    this.activeQueue.push(track);
    this.originalQueue.push(track);
  }

  removeFromQueue(index: number): void {
    if (index < 0 || index >= this.activeQueue.length) return;

    const removed = this.activeQueue.splice(index, 1)[0];
    const origIdx = this.originalQueue.findIndex((t) => t.id === removed.id);
    if (origIdx !== -1) {
      this.originalQueue.splice(origIdx, 1);
    }

    if (this.activeQueue.length === 0) {
      this.currentIndex = -1;
    } else if (index < this.currentIndex) {
      this.currentIndex = Math.max(0, this.currentIndex - 1);
    } else if (this.currentIndex >= this.activeQueue.length) {
      this.currentIndex = this.activeQueue.length - 1;
    }
  }

  moveInQueue(from: number, to: number): void {
    if (
      from < 0 ||
      from >= this.activeQueue.length ||
      to < 0 ||
      to >= this.activeQueue.length ||
      from === to
    ) {
      return;
    }

    const currentTrackId = this.getCurrentTrack()?.id;
    const [item] = this.activeQueue.splice(from, 1);
    this.activeQueue.splice(to, 0, item);

    // Adjust currentIndex
    if (currentTrackId) {
      const newIdx = this.activeQueue.findIndex((t) => t.id === currentTrackId);
      if (newIdx !== -1) {
        this.currentIndex = newIdx;
      }
    }
  }

  clearQueue(): void {
    this.originalQueue = [];
    this.activeQueue = [];
    this.currentIndex = -1;
  }

  getCurrentTrack(): Track | null {
    if (this.currentIndex >= 0 && this.currentIndex < this.activeQueue.length) {
      return this.activeQueue[this.currentIndex];
    }
    return null;
  }

  getTrackAt(index: number): Track | null {
    if (index >= 0 && index < this.activeQueue.length) {
      return this.activeQueue[index];
    }
    return null;
  }

  getNextTrack(): Track | null {
    if (this.activeQueue.length === 0) return null;
    if (this.repeatMode === 'ONE') {
      return this.getCurrentTrack();
    }
    if (this.currentIndex < this.activeQueue.length - 1) {
      return this.activeQueue[this.currentIndex + 1];
    }
    if (this.repeatMode === 'ALL') {
      return this.activeQueue[0];
    }
    return null;
  }

  getUpcomingTracks(count = 2): Track[] {
    const upcoming: Track[] = [];
    if (this.activeQueue.length === 0) return upcoming;

    for (let i = 1; i <= count; i++) {
      let targetIndex = this.currentIndex + i;
      if (targetIndex >= this.activeQueue.length) {
        if (this.repeatMode === 'ALL') {
          targetIndex = targetIndex % this.activeQueue.length;
        } else {
          break;
        }
      }
      upcoming.push(this.activeQueue[targetIndex]);
    }
    return upcoming;
  }

  next(forceAdvance = false): Track | null {
    if (this.activeQueue.length === 0) return null;

    if (this.repeatMode === 'ONE' && !forceAdvance) {
      return this.getCurrentTrack();
    }

    if (this.currentIndex < this.activeQueue.length - 1) {
      this.currentIndex++;
      return this.activeQueue[this.currentIndex];
    }

    if (this.repeatMode === 'ALL') {
      this.currentIndex = 0;
      return this.activeQueue[this.currentIndex];
    }

    return null;
  }

  previous(positionMs = 0): Track | null {
    if (this.activeQueue.length === 0) return null;

    // If playback has progressed past 3 seconds, restart current track
    if (positionMs > 3000) {
      return this.getCurrentTrack();
    }

    if (this.currentIndex > 0) {
      this.currentIndex--;
      return this.activeQueue[this.currentIndex];
    }

    if (this.repeatMode === 'ALL') {
      this.currentIndex = this.activeQueue.length - 1;
      return this.activeQueue[this.currentIndex];
    }

    return this.getCurrentTrack();
  }

  jumpTo(index: number): Track | null {
    if (index >= 0 && index < this.activeQueue.length) {
      this.currentIndex = index;
      return this.activeQueue[this.currentIndex];
    }
    return null;
  }

  setRepeatMode(mode: RepeatMode): void {
    this.repeatMode = mode;
  }

  setShuffle(enabled: boolean): void {
    if (this.shuffle === enabled) return;
    this.shuffle = enabled;

    const currentTrack = this.getCurrentTrack();

    if (enabled) {
      // Shuffle active queue, preserving the current track at index 0
      if (!currentTrack) {
        this.activeQueue = this.fisherYates([...this.originalQueue]);
        this.currentIndex = this.activeQueue.length > 0 ? 0 : -1;
      } else {
        const remaining = this.originalQueue.filter((t) => t.id !== currentTrack.id);
        this.activeQueue = [currentTrack, ...this.fisherYates(remaining)];
        this.currentIndex = 0;
      }
    } else {
      // Un-shuffle: restore originalQueue order and preserve current track's index
      this.activeQueue = [...this.originalQueue];
      if (currentTrack) {
        const restoredIdx = this.activeQueue.findIndex((t) => t.id === currentTrack.id);
        this.currentIndex = restoredIdx !== -1 ? restoredIdx : 0;
      }
    }
  }

  restore(persisted: {
    queue: Track[];
    originalQueue?: Track[];
    currentIndex: number;
    repeatMode?: RepeatMode;
    shuffle?: boolean;
  }): void {
    this.originalQueue = persisted.originalQueue && persisted.originalQueue.length > 0
      ? [...persisted.originalQueue]
      : [...persisted.queue];
    this.activeQueue = [...persisted.queue];
    this.currentIndex = Math.max(-1, Math.min(persisted.currentIndex, this.activeQueue.length - 1));
    if (persisted.repeatMode) {
      this.repeatMode = persisted.repeatMode;
    }
    if (persisted.shuffle !== undefined) {
      this.shuffle = persisted.shuffle;
    }
  }

  private fisherYates(array: Track[]): Track[] {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}
