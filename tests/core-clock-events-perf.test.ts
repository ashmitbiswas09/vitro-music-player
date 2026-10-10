import { describe, it, expect, vi } from 'vitest';
import { TestClock, SystemClock, TypedEventEmitter, PerfTimer, perf } from '@/backend/core';

describe('Clock, Events & Perf Timing', () => {
  it('manipulates time deterministically with TestClock', async () => {
    const clock = new TestClock(1000);
    expect(clock.now()).toBe(1000);

    clock.advanceBy(500);
    expect(clock.now()).toBe(1500);

    await clock.sleep(200);
    expect(clock.now()).toBe(1700);
    expect(() => clock.advanceBy(-10)).toThrow();
  });

  it('provides real timestamps via SystemClock', () => {
    const clock = new SystemClock();
    expect(clock.now()).toBeGreaterThan(0);
    expect(clock.nowIso()).toContain('T');
  });

  it('manages typed events safely with TypedEventEmitter', () => {
    interface TestEvents {
      trackChange: [trackId: string, title: string];
      stateUpdate: [status: string];
    }

    const emitter = new TypedEventEmitter<TestEvents>();
    const trackSpy = vi.fn();
    const onceSpy = vi.fn();

    const unsubscribe = emitter.on('trackChange', trackSpy);
    emitter.once('stateUpdate', onceSpy);

    expect(emitter.listenerCount('trackChange')).toBe(1);
    expect(emitter.listenerCount('stateUpdate')).toBe(1);

    emitter.emit('trackChange', 'v1', 'Song A');
    expect(trackSpy).toHaveBeenCalledWith('v1', 'Song A');

    emitter.emit('stateUpdate', 'playing');
    emitter.emit('stateUpdate', 'paused');
    expect(onceSpy).toHaveBeenCalledTimes(1);
    expect(onceSpy).toHaveBeenCalledWith('playing');

    unsubscribe();
    expect(emitter.listenerCount('trackChange')).toBe(0);

    emitter.emit('trackChange', 'v2', 'Song B');
    expect(trackSpy).toHaveBeenCalledTimes(1);
  });

  it('measures synchronous and asynchronous execution with PerfTimer', async () => {
    const timer = new PerfTimer();
    timer.mark('start');

    const syncMeasurement = timer.measureSync('syncCalculation', () => {
      let sum = 0;
      for (let i = 0; i < 1000; i++) sum += i;
      return sum;
    });

    expect(syncMeasurement.result).toBe(499500);
    expect(syncMeasurement.durationMs).toBeGreaterThanOrEqual(0);

    const asyncMeasurement = await timer.measureAsync('asyncTask', async () => {
      return 'done';
    });

    expect(asyncMeasurement.result).toBe('done');
    expect(asyncMeasurement.durationMs).toBeGreaterThanOrEqual(0);

    const elapsed = timer.measure('start');
    expect(elapsed).toBeGreaterThanOrEqual(0);
  });

  it('exposes global perf singleton', () => {
    perf.mark('test');
    expect(perf.measure('test')).toBeGreaterThanOrEqual(0);
  });
});
