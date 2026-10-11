/**
 * High-resolution performance measurement and profiling utilities.
 * Includes defensive fallback to Date.now() if performance.now() is unavailable.
 */

function getTimestamp(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

export interface PerfMeasurement<T> {
  result: T;
  durationMs: number;
}

export class PerfTimer {
  private readonly marks = new Map<string, number>();

  mark(name: string): number {
    const timestamp = getTimestamp();
    this.marks.set(name, timestamp);
    return timestamp;
  }

  measure(name: string, startMark?: string): number {
    const end = getTimestamp();
    const start = startMark ? this.marks.get(startMark) : this.marks.get(name);

    if (start === undefined) {
      return 0;
    }

    return end - start;
  }

  clearMarks(): void {
    this.marks.clear();
  }

  measureSync<T>(name: string, fn: () => T): PerfMeasurement<T> {
    const start = getTimestamp();
    const result = fn();
    const durationMs = getTimestamp() - start;
    return { result, durationMs };
  }

  async measureAsync<T>(name: string, fn: () => Promise<T>): Promise<PerfMeasurement<T>> {
    const start = getTimestamp();
    const result = await fn();
    const durationMs = getTimestamp() - start;
    return { result, durationMs };
  }
}

export const perf = new PerfTimer();
