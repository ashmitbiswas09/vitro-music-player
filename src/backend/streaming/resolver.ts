/**
 * DefaultStreamResolver orchestrating stream strategies, automatic fallback,
 * in-memory TTL caching, URL expiry re-resolution, and ranged playback verification.
 */

import {
  type Result,
  type Clock,
  type Logger,
  type AudioCodec,
  SystemClock,
  createLogger,
  DEFAULT_INNERTUBE_CONFIG,
  StreamError,
  err,
  ok,
} from '@/backend/core';
import type { HttpClient } from '@/backend/platform';
import { VisitorDataManager } from '@/backend/innertube';
import type {
  StreamResolver,
  StreamResolverOptions,
  StreamStrategy,
  ResolvedStream,
  ResolveOptions,
  StreamVerificationOptions,
  StreamVerificationResult,
  FullVerificationOptions,
  FullVerificationResult,
} from './types';
import { VisionOsStreamStrategy } from './strategies/visionos-strategy';
import { AndroidVrStreamStrategy } from './strategies/android-vr-strategy';
import { AuthenticatedStreamStrategy } from './strategies/authenticated-strategy';
import type { AuthService } from '@/backend/auth';

export class DefaultStreamResolver implements StreamResolver {
  private readonly httpClient: HttpClient;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly strategies: StreamStrategy[];
  private readonly preferredCodecs: AudioCodec[];
  private readonly minRequestDelayMs: number;
  private readonly visitorDataManager?: VisitorDataManager;
  private readonly cache = new Map<string, ResolvedStream>();
  private authService?: AuthService;
  private authenticatedStrategy?: AuthenticatedStreamStrategy;
  private readonly enableAuthFallback: boolean;
  private lastRequestTime = 0;

  constructor(options: StreamResolverOptions) {
    this.httpClient = options.httpClient;
    this.clock = options.clock ?? new SystemClock();
    this.logger = options.logger ?? createLogger({ prefix: 'StreamResolver' });
    this.preferredCodecs = options.preferredCodecs ?? ['opus', 'aac', 'other'];
    this.minRequestDelayMs = options.minRequestDelayMs ?? 300;
    this.authService = options.authService;
    this.enableAuthFallback = options.enableAuthFallback ?? false;
    if (options.authService) {
      this.authenticatedStrategy = new AuthenticatedStreamStrategy(this.httpClient, {
        authService: options.authService,
        preferredCodecs: this.preferredCodecs,
        clock: this.clock,
        logger: this.logger,
      });
    }
    this.visitorDataManager =
      options.visitorDataManager ??
      new VisitorDataManager({
        httpClient: this.httpClient,
        config: DEFAULT_INNERTUBE_CONFIG,
      });

    this.strategies =
      options.strategies && options.strategies.length > 0
        ? options.strategies
        : [
            new VisionOsStreamStrategy(this.httpClient, {
              preferredCodecs: this.preferredCodecs,
              clock: this.clock,
              logger: this.logger,
            }),
            new AndroidVrStreamStrategy(this.httpClient, {
              preferredCodecs: this.preferredCodecs,
              clock: this.clock,
              logger: this.logger,
            }),
          ];
  }

  setAuthService(authService?: AuthService): void {
    this.authService = authService;
    if (authService) {
      this.authenticatedStrategy = new AuthenticatedStreamStrategy(this.httpClient, {
        authService,
        preferredCodecs: this.preferredCodecs,
        clock: this.clock,
        logger: this.logger,
      });
    } else {
      this.authenticatedStrategy = undefined;
    }
  }

  getAuthenticatedStrategy(): AuthenticatedStreamStrategy | undefined {
    return this.authenticatedStrategy;
  }

  invalidate(videoId: string): void {
    this.cache.delete(videoId);
  }

  invalidateStream(videoId: string): void {
    this.invalidate(videoId);
  }

  private async throttle(): Promise<void> {
    const now = this.clock.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minRequestDelayMs) {
      const waitTime = this.minRequestDelayMs - elapsed;
      await new Promise((r) => setTimeout(r, waitTime));
    }
    this.lastRequestTime = this.clock.now();
  }

  async resolve(
    videoId: string,
    options: ResolveOptions = {},
  ): Promise<Result<ResolvedStream, StreamError>> {
    // 1. Check cached stream unless forceFresh is requested
    const cached = this.cache.get(videoId);
    if (cached && !options.forceFresh) {
      const now = this.clock.now();
      // Cache hit if stream does not expire within 60 seconds
      if (now < cached.stream.expiresAt - 60_000) {
        this.logger.debug(`Cache hit for stream: videoId "${videoId}"`, {
          strategy: cached.strategyName,
          expiresAt: cached.stream.expiresAt,
        });
        return ok(cached);
      }
      this.logger.debug(
        `Cached stream for "${videoId}" has expired or is expiring soon. Re-resolving...`,
      );
      this.cache.delete(videoId);
    }

    const visitorData = options.visitorData ?? (await this.visitorDataManager?.getVisitorData());
    const resolveOpts: ResolveOptions = { ...options, visitorData };

    // 2. Iterate through strategies with automatic fallback
    const attempts: { strategy: string; error: string; reason: string }[] = [];
    let hadRecoverableWithAuth = false;

    for (const strategy of this.strategies) {
      await this.throttle();
      const res = await strategy.resolve(videoId, resolveOpts);

      if (res.ok) {
        this.logger.info(`Successfully resolved stream for "${videoId}" via "${strategy.name}"`, {
          codec: res.value.stream.codec,
          bitrate: res.value.stream.bitrate,
          expiresAt: res.value.stream.expiresAt,
        });
        this.cache.set(videoId, res.value);
        return res;
      }

      if (res.error.recoverableWithAuth) {
        hadRecoverableWithAuth = true;
      }

      this.logger.warn(
        `Strategy "${strategy.name}" failed for video "${videoId}": ${res.error.message}`,
        {
          reason: res.error.reason,
        },
      );
      attempts.push({
        strategy: strategy.name,
        error: res.error.message,
        reason: res.error.reason,
      });
    }

    // 3. Fallback to authenticated strategy only if explicitly enabled (disabled by default because
    // empirical testing showed native contexts reject web SAPISIDHASH cookies with HTTP 400 and WEB_REMIX returns UNPLAYABLE)
    if (this.enableAuthFallback && this.authenticatedStrategy && this.authService) {
      const signedIn = await this.authService.isSignedIn();
      if (signedIn) {
        this.logger.info(
          `Attempting authenticated strategy fallback for "${videoId}"`,
        );
        await this.throttle();
        const authRes = await this.authenticatedStrategy.resolve(videoId, resolveOpts);

        if (authRes.ok) {
          this.logger.info(
            `Successfully resolved stream for "${videoId}" via "${this.authenticatedStrategy.name}"`,
            {
              codec: authRes.value.stream.codec,
              bitrate: authRes.value.stream.bitrate,
              expiresAt: authRes.value.stream.expiresAt,
            },
          );
          this.cache.set(videoId, authRes.value);
          return authRes;
        }

        this.logger.warn(
          `Authenticated strategy failed for video "${videoId}": ${authRes.error.message}`,
          { reason: authRes.error.reason },
        );
        attempts.push({
          strategy: this.authenticatedStrategy.name,
          error: authRes.error.message,
          reason: authRes.error.reason,
        });
      }
    }

    return err(
      new StreamError(
        `All stream resolution strategies failed for videoId "${videoId}"`,
        videoId,
        'ALL_STRATEGIES_FAILED',
        { attempts },
        undefined,
        hadRecoverableWithAuth,
      ),
    );
  }

  async verify(
    streamUrl: string,
    options: StreamVerificationOptions = {},
  ): Promise<StreamVerificationResult> {
    const startTime = performance.now();
    const timeoutMs = options.timeoutMs ?? 10000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    if (options.signal) {
      options.signal.addEventListener('abort', () => controller.abort());
    }

    try {
      const headers: Record<string, string> = {
        Range: 'bytes=0-1023',
        Accept: '*/*',
        ...(options.headers ?? {}),
      };
      if (options.userAgent && !headers['User-Agent']) {
        headers['User-Agent'] = options.userAgent;
      }
      if (!headers['User-Agent']) {
        headers['User-Agent'] =
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
      }

      const response = await fetch(streamUrl, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      const timeToFirstByteMs = performance.now() - startTime;
      const statusCode = response.status;
      const contentType = response.headers.get('content-type');
      const contentRange = response.headers.get('content-range');

      let bytesReceived = 0;
      if (response.ok || statusCode === 206) {
        const buf = await response.arrayBuffer();
        bytesReceived = buf.byteLength;
      }

      const isPlayable = (statusCode === 200 || statusCode === 206) && bytesReceived > 0;

      return {
        isPlayable,
        statusCode,
        contentType,
        contentRange,
        bytesReceived,
        timeToFirstByteMs,
        error: isPlayable ? undefined : `HTTP ${statusCode}`,
      };
    } catch (caught: unknown) {
      const timeToFirstByteMs = performance.now() - startTime;
      const isAbort = controller.signal.aborted;
      const errorMessage = isAbort
        ? `Verification timed out after ${timeoutMs} ms`
        : caught instanceof Error
          ? caught.message
          : 'Verification network request failed';

      return {
        isPlayable: false,
        statusCode: 0,
        contentType: null,
        contentRange: null,
        bytesReceived: 0,
        timeToFirstByteMs,
        error: errorMessage,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async verifyFull(
    resolved: ResolvedStream,
    options: FullVerificationOptions = {},
  ): Promise<FullVerificationResult> {
    const durationSeconds = options.durationSeconds ?? 30;
    const chunkSizeBytes = options.chunkSizeBytes ?? 64 * 1024;
    const paceDelayMs = options.paceDelayMs ?? 50;
    const timeoutMs = options.timeoutMs ?? 30000;

    const stream = resolved.stream;
    const bytesPerSec = stream.bitrate / 8;
    let targetBytes = Math.ceil(bytesPerSec * durationSeconds);
    if (stream.contentLength && stream.contentLength < targetBytes) {
      targetBytes = stream.contentLength;
    }

    const startTime = performance.now();
    let currentStart = 0;
    let totalBytes = 0;
    let chunkIndex = 0;
    let throttledOr403 = false;
    let lastStatusCode = 200;
    let lastError: string | undefined;
    const chunkDetails: FullVerificationResult['chunkDetails'] = [];

    const headers: Record<string, string> = {
      Accept: '*/*',
      ...resolved.requestHeaders,
    };

    while (currentStart < targetBytes) {
      const currentEnd = Math.min(currentStart + chunkSizeBytes - 1, targetBytes - 1);
      const rangeHeader = `bytes=${currentStart}-${currentEnd}`;
      const chunkStartTime = performance.now();

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      if (options.signal) {
        options.signal.addEventListener('abort', () => controller.abort());
      }

      try {
        const res = await fetch(stream.url, {
          method: 'GET',
          headers: {
            ...headers,
            Range: rangeHeader,
          },
          signal: controller.signal,
        });
        clearTimeout(timer);

        lastStatusCode = res.status;
        const chunkLatencyMs = performance.now() - chunkStartTime;

        if (res.status === 403 || res.status === 429) {
          throttledOr403 = true;
          lastError = `HTTP ${res.status} (${res.status === 429 ? 'Throttled / Rate Limited' : 'Forbidden / Expired'})`;
          chunkDetails.push({
            chunkIndex,
            range: rangeHeader,
            bytes: 0,
            statusCode: res.status,
            latencyMs: chunkLatencyMs,
          });
          break;
        }

        if (!res.ok && res.status !== 206) {
          lastError = `HTTP ${res.status}: ${res.statusText}`;
          chunkDetails.push({
            chunkIndex,
            range: rangeHeader,
            bytes: 0,
            statusCode: res.status,
            latencyMs: chunkLatencyMs,
          });
          break;
        }

        const buf = await res.arrayBuffer();
        const bytesReceived = buf.byteLength;
        totalBytes += bytesReceived;

        chunkDetails.push({
          chunkIndex,
          range: rangeHeader,
          bytes: bytesReceived,
          statusCode: res.status,
          latencyMs: chunkLatencyMs,
        });

        if (bytesReceived === 0) {
          lastError = 'Unexpected 0 bytes received in stream chunk';
          break;
        }

        currentStart += bytesReceived;
        chunkIndex++;

        // Normal pace delay between sequential requests
        if (currentStart < targetBytes && paceDelayMs > 0) {
          await new Promise((r) => setTimeout(r, paceDelayMs));
        }
      } catch (caught: unknown) {
        clearTimeout(timer);
        const errMessage = caught instanceof Error ? caught.message : String(caught);
        lastError = errMessage;
        throttledOr403 = throttledOr403 || errMessage.includes('403') || errMessage.includes('429');
        chunkDetails.push({
          chunkIndex,
          range: rangeHeader,
          bytes: 0,
          statusCode: 0,
          latencyMs: performance.now() - chunkStartTime,
        });
        break;
      }
    }

    const totalDurationMs = performance.now() - startTime;
    const elapsedSec = totalDurationMs / 1000;
    const averageThroughputBytesPerSec = elapsedSec > 0 ? totalBytes / elapsedSec : 0;
    const throughputKbps = averageThroughputBytesPerSec / 1024;
    const throughputMbps = (averageThroughputBytesPerSec * 8) / 1_000_000;

    const isPlayable = !throttledOr403 && totalBytes > 0 && !lastError;

    return {
      isPlayable,
      totalBytesReceived: totalBytes,
      expectedBytes: targetBytes,
      durationSeconds,
      chunksCount: chunkIndex,
      averageThroughputBytesPerSec,
      throughputKbps,
      throughputMbps,
      totalDurationMs,
      throttledOr403,
      statusCode: lastStatusCode,
      error: lastError,
      chunkDetails,
    };
  }

  async resolveAndVerify(
    videoId: string,
    options: ResolveOptions & { verifyFull?: boolean } = {},
  ): Promise<
    Result<
      {
        resolved: ResolvedStream;
        verification: StreamVerificationResult;
        fullVerification?: FullVerificationResult;
      },
      StreamError
    >
  > {
    const visitorData = options.visitorData ?? (await this.visitorDataManager?.getVisitorData());
    const resolveOpts: ResolveOptions = { ...options, visitorData };

    // Try resolving through strategies, verifying each candidate
    const attempts: { strategy: string; error: string }[] = [];

    let hadRecoverableWithAuth = false;

    for (const strategy of this.strategies) {
      await this.throttle();
      const res = await strategy.resolve(videoId, resolveOpts);

      if (!res.ok) {
        if (res.error.recoverableWithAuth) {
          hadRecoverableWithAuth = true;
        }
        attempts.push({ strategy: strategy.name, error: res.error.message });
        continue;
      }

      const verification = await this.verify(res.value.stream.url, {
        signal: options.signal,
        headers: res.value.requestHeaders,
      });

      if (!verification.isPlayable) {
        this.logger.warn(
          `Verification failed for strategy "${strategy.name}" on video "${videoId}": HTTP ${verification.statusCode} (${verification.error})`,
        );
        this.cache.delete(videoId);
        attempts.push({
          strategy: strategy.name,
          error: `Verification failed: HTTP ${verification.statusCode}`,
        });
        continue;
      }

      let fullVerification: FullVerificationResult | undefined;
      if (options.verifyFull) {
        fullVerification = await this.verifyFull(res.value, {
          signal: options.signal,
        });

        if (!fullVerification.isPlayable) {
          this.logger.warn(
            `Full verification failed for strategy "${strategy.name}" on video "${videoId}": ${fullVerification.error}`,
          );
          this.cache.delete(videoId);
          attempts.push({
            strategy: strategy.name,
            error: `Full verification failed: ${fullVerification.error ?? 'Unknown error'}`,
          });
          continue;
        }
      }

      this.cache.set(videoId, res.value);
      return ok({
        resolved: res.value,
        verification,
        fullVerification,
      });
    }

    // Fallback to authenticated strategy if an active signed-in session is present
    if (this.authenticatedStrategy && this.authService) {
      const signedIn = await this.authService.isSignedIn();
      if (signedIn) {
        this.logger.info(
          `Attempting authenticated strategy fallback in resolveAndVerify for "${videoId}"`,
        );
        await this.throttle();
        const res = await this.authenticatedStrategy.resolve(videoId, resolveOpts);

        if (res.ok) {
          const verification = await this.verify(res.value.stream.url, {
            signal: options.signal,
            headers: res.value.requestHeaders,
          });

          if (verification.isPlayable) {
            let fullVerification: FullVerificationResult | undefined;
            if (options.verifyFull) {
              fullVerification = await this.verifyFull(res.value, {
                signal: options.signal,
              });

              if (!fullVerification.isPlayable) {
                this.logger.warn(
                  `Full verification failed for strategy "${this.authenticatedStrategy.name}" on video "${videoId}": ${fullVerification.error}`,
                );
                this.cache.delete(videoId);
                attempts.push({
                  strategy: this.authenticatedStrategy.name,
                  error: `Full verification failed: ${fullVerification.error ?? 'Unknown error'}`,
                });
                return err(
                  new StreamError(
                    `No working stream found for videoId "${videoId}" across all strategies`,
                    videoId,
                    'UNPLAYABLE',
                    { attempts },
                    undefined,
                    hadRecoverableWithAuth,
                  ),
                );
              }
            }

            this.cache.set(videoId, res.value);
            return ok({
              resolved: res.value,
              verification,
              fullVerification,
            });
          }

          attempts.push({
            strategy: this.authenticatedStrategy.name,
            error: `Verification failed: HTTP ${verification.statusCode}`,
          });
        } else {
          attempts.push({
            strategy: this.authenticatedStrategy.name,
            error: res.error.message,
          });
        }
      }
    }

    return err(
      new StreamError(
        `No working stream found for videoId "${videoId}" across all strategies`,
        videoId,
        'UNPLAYABLE',
        { attempts },
        undefined,
        hadRecoverableWithAuth,
      ),
    );
  }
}
