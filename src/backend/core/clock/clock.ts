/**
 * Clock interface and implementations for time abstraction and deterministic testing.
 */

export interface Clock {
  now(): number;
  nowIso(): string;
  sleep(ms: number): Promise<void>;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }

  nowIso(): string {
    return new Date().toISOString();
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export class TestClock implements Clock {
  private currentTime: number;

  constructor(initialEpochMs: number = 1700000000000) {
    this.currentTime = initialEpochMs;
  }

  now(): number {
    return this.currentTime;
  }

  nowIso(): string {
    return new Date(this.currentTime).toISOString();
  }

  advanceBy(ms: number): void {
    if (ms < 0) {
      throw new Error('TestClock cannot go backwards');
    }
    this.currentTime += ms;
  }

  setTime(epochMs: number): void {
    this.currentTime = epochMs;
  }

  sleep(ms: number): Promise<void> {
    this.advanceBy(ms);
    return Promise.resolve();
  }
}

export const defaultClock: Clock = new SystemClock();
