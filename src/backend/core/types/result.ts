/**
 * Result monad and helper functions for robust error handling without exceptions.
 */

import { AppError } from './errors';

export type Result<T, E = AppError> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(
  result: Result<T, E>,
): result is { readonly ok: true; readonly value: T } {
  return result.ok;
}

export function isErr<T, E>(
  result: Result<T, E>,
): result is { readonly ok: false; readonly error: E } {
  return !result.ok;
}

export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  if (result.ok) {
    return ok(fn(result.value));
  }
  return result;
}

export function flatMap<T, U, E, E2>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E2>,
): Result<U, E | E2> {
  if (result.ok) {
    return fn(result.value);
  }
  return result;
}

export function mapError<T, E, E2>(result: Result<T, E>, fn: (error: E) => E2): Result<T, E2> {
  if (!result.ok) {
    return err(fn(result.error));
  }
  return result;
}

export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) {
    return result.value;
  }
  if (result.error instanceof Error) {
    throw result.error;
  }
  throw new Error(`Unwrap failed on Result: ${String(result.error)}`);
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

export function tryCatch<T, E = AppError>(
  fn: () => T,
  onError: (thrown: unknown) => E,
): Result<T, E> {
  try {
    return ok(fn());
  } catch (caught) {
    return err(onError(caught));
  }
}

export async function tryCatchAsync<T, E = AppError>(
  fn: () => Promise<T>,
  onError: (thrown: unknown) => E,
): Promise<Result<T, E>> {
  try {
    const value = await fn();
    return ok(value);
  } catch (caught) {
    return err(onError(caught));
  }
}
