import { describe, it, expect } from 'vitest';
import {
  ok,
  err,
  isOk,
  isErr,
  map,
  flatMap,
  mapError,
  unwrap,
  unwrapOr,
  tryCatch,
  tryCatchAsync,
  AppError,
  NetworkError,
  NotFoundError,
  AuthError,
  StreamError,
  StorageError,
  TimeoutError,
} from '@/backend/core';

describe('Result & Error Handling', () => {
  it('handles ok Result', () => {
    const res = ok(42);
    expect(isOk(res)).toBe(true);
    expect(isErr(res)).toBe(false);
    expect(unwrap(res)).toBe(42);
    expect(unwrapOr(res, 0)).toBe(42);
  });

  it('handles err Result', () => {
    const error = new NotFoundError('Track', 'track_123');
    const res = err(error);
    expect(isOk(res)).toBe(false);
    expect(isErr(res)).toBe(true);
    expect(() => unwrap(res)).toThrowError(NotFoundError);
    expect(unwrapOr(res, 99)).toBe(99);
  });

  it('transforms Result with map and flatMap', () => {
    const res = ok(10);
    const mapped = map(res, (n) => n * 2);
    expect(isOk(mapped) && mapped.value).toBe(20);

    const flatMapped = flatMap(mapped, (n) => ok(`Val: ${n}`));
    expect(isOk(flatMapped) && flatMapped.value).toBe('Val: 20');

    const errMapped = mapError(err(new AppError('oops')), (e) => new NetworkError(e.message));
    expect(isErr(errMapped) && errMapped.error.name).toBe('NetworkError');
  });

  it('wraps throwing functions safely with tryCatch', () => {
    const success = tryCatch(
      () => JSON.parse('{"a": 1}'),
      (e) => new AppError(String(e)),
    );
    expect(isOk(success)).toBe(true);

    const failure = tryCatch(
      () => JSON.parse('{invalid json}'),
      (e) => new AppError(String(e)),
    );
    expect(isErr(failure)).toBe(true);
  });

  it('wraps async promises safely with tryCatchAsync', async () => {
    const success = await tryCatchAsync(
      async () => Promise.resolve('data'),
      (e) => new AppError(String(e)),
    );
    expect(isOk(success) && success.value).toBe('data');

    const failure = await tryCatchAsync(
      async () => Promise.reject(new Error('connection reset')),
      (e) => new NetworkError('failed', { cause: e }),
    );
    expect(isErr(failure) && failure.error.name).toBe('NetworkError');
  });

  it('instantiates all typed domain error subclasses correctly', () => {
    const netErr = new NetworkError('Gateway timeout', { statusCode: 504, url: 'https://api.com' });
    expect(netErr.code).toBe('NETWORK_ERROR');
    expect(netErr.statusCode).toBe(504);

    const authErr = new AuthError('Session expired', 'EXPIRED');
    expect(authErr.code).toBe('AUTH_ERROR');
    expect(authErr.reason).toBe('EXPIRED');

    const streamErr = new StreamError('DRM restricted', 'vid_1', 'UNPLAYABLE');
    expect(streamErr.code).toBe('STREAM_ERROR');
    expect(streamErr.videoId).toBe('vid_1');

    const storageErr = new StorageError('Disk full', 'WRITE', '/cache/tracks');
    expect(storageErr.code).toBe('STORAGE_ERROR');
    expect(storageErr.pathOrKey).toBe('/cache/tracks');

    const timeoutErr = new TimeoutError(5000, 'Search');
    expect(timeoutErr.code).toBe('TIMEOUT_ERROR');
    expect(timeoutErr.timeoutMs).toBe(5000);
  });
});
