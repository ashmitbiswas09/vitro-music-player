/**
 * High-resolution performance measurement and profiling utilities.
 */

export interface PerfMeasurement<T> {
  result: T;
  durationMs: number;
}

export class PerfTimer {
  private readonly marks = new Map<string, number>();

  mark(name: string): number {
    const timestamp = performance.now();
    this.marks.set(name, timestamp);
    return timestamp;
  }

  measure(name: string, startMark?: string): number {
    const end = performance.now();
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
    const start = performance.now();
    const result = fn();
    const durationMs = performance.now() - start;
    return { result, durationMs };
  }

  async measureAsync<T>(name: string, fn: () => Promise<T>): Promise<PerfMeasurement<T>> {
    const start = performance.now();
    const result = await fn();
    const durationMs = performance.now() - start;
    return { result, durationMs };
  }
}

export const perf = new PerfTimer();
