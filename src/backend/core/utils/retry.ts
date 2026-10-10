/**
 * Retry helper with exponential backoff and jitter.
 */

import { NetworkError } from '../types/errors';

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  backoffFactor?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof NetworkError) {
    if (error.statusCode) {
      // 5xx server errors, 429 rate limit are retryable. 4xx client errors are not.
      return error.statusCode >= 500 || error.statusCode === 429;
    }
    // Network timeouts or connection drops without status code are retryable
    return true;
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('timeout') || msg.includes('econnreset') || msg.includes('fetch failed');
  }
  return false;
}

export async function retryAsync<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const initialDelay = options.initialDelayMs ?? 500;
  const factor = options.backoffFactor ?? 2;
  const maxDelay = options.maxDelayMs ?? 5000;
  const shouldRetry = options.shouldRetry ?? isRetryableError;

  let attempt = 1;
  let currentDelay = initialDelay;

  while (attempt <= maxAttempts) {
    try {
      return await fn();
    } catch (caught) {
      if (attempt >= maxAttempts || !shouldRetry(caught, attempt)) {
        throw caught;
      }

      // Add jitter (±20%)
      const jitter = currentDelay * (0.8 + Math.random() * 0.4);
      await new Promise((resolve) => setTimeout(resolve, jitter));

      currentDelay = Math.min(currentDelay * factor, maxDelay);
      attempt++;
    }
  }

  throw new Error('Retry exhausted attempts');
}
