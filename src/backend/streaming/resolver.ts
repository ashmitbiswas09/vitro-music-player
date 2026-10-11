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
} from './types';
import { VisionOsStreamStrategy } from './strategies/visionos-strategy';
import { AndroidVrStreamStrategy } from './strategies/android-vr-strategy';

export class DefaultStreamResolver implements StreamResolver {
  private readonly httpClient: HttpClient;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly strategies: StreamStrategy[];
  private readonly preferredCodecs: AudioCodec[];
  private readonly minRequestDelayMs: number;
  private readonly visitorDataManager?: VisitorDataManager;
  private readonly cache = new Map<string, ResolvedStream>();
  private lastRequestTime = 0;

  constructor(options: StreamResolverOptions) {
    this.httpClient = options.httpClient;
    this.clock = options.clock ?? new SystemClock();
    this.logger = options.logger ?? createLogger({ prefix: 'StreamResolver' });
    this.preferredCodecs = options.preferredCodecs ?? ['opus', 'aac', 'other'];
    this.minRequestDelayMs = options.minRequestDelayMs ?? 300;
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

    return err(
      new StreamError(
        `All stream resolution strategies failed for videoId "${videoId}"`,
        videoId,
        'ALL_STRATEGIES_FAILED',
        { attempts },
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
      const response = await fetch(streamUrl, {
        method: 'GET',
        headers: {
          Range: 'bytes=0-1023',
          'User-Agent':
            options.userAgent ??
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
        },
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

  async resolveAndVerify(
    videoId: string,
    options: ResolveOptions = {},
  ): Promise<
    Result<{ resolved: ResolvedStream; verification: StreamVerificationResult }, StreamError>
  > {
    const visitorData = options.visitorData ?? (await this.visitorDataManager?.getVisitorData());
    const resolveOpts: ResolveOptions = { ...options, visitorData };

    // Try resolving through strategies, verifying each candidate
    const attempts: { strategy: string; error: string }[] = [];

    for (const strategy of this.strategies) {
      await this.throttle();
      const res = await strategy.resolve(videoId, resolveOpts);

      if (!res.ok) {
        attempts.push({ strategy: strategy.name, error: res.error.message });
        continue;
      }

      const verification = await this.verify(res.value.stream.url, {
        signal: options.signal,
      });

      if (verification.isPlayable) {
        this.cache.set(videoId, res.value);
        return ok({
          resolved: res.value,
          verification,
        });
      }

      this.logger.warn(
        `Verification failed for strategy "${strategy.name}" on video "${videoId}": HTTP ${verification.statusCode} (${verification.error})`,
      );
      this.cache.delete(videoId);
      attempts.push({
        strategy: strategy.name,
        error: `Verification failed: HTTP ${verification.statusCode}`,
      });
    }

    return err(
      new StreamError(
        `No working stream found for videoId "${videoId}" across all strategies`,
        videoId,
        'UNPLAYABLE',
        { attempts },
      ),
    );
  }
}
