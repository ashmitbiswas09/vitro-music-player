/**
 * Base strategy for InnerTube player endpoint stream resolution.
 */

import {
  type Result,
  type Clock,
  type Logger,
  type AudioCodec,
  SystemClock,
  createLogger,
  StreamError,
  err,
  ok,
} from '@/backend/core';
import type { HttpClient } from '@/backend/platform';
import type { StreamStrategy, ResolvedStream, ResolveOptions } from '../types';
import { parsePlayerResponse } from '../parsers/player-parser';

export interface BaseStrategyConfig {
  name: string;
  url?: string;
  clientName: string;
  clientVersion: string;
  clientPlatform?: string;
  clientNameHeader?: string;
  userAgent: string;
  extraClientContext?: Record<string, unknown>;
  extraBody?: Record<string, unknown>;
  preferredCodecs?: AudioCodec[];
  clock?: Clock;
  logger?: Logger;
}

export abstract class BaseInnertubeStreamStrategy implements StreamStrategy {
  readonly name: string;
  protected readonly httpClient: HttpClient;
  protected readonly url: string;
  protected readonly clientName: string;
  protected readonly clientVersion: string;
  protected readonly clientPlatform: string;
  protected readonly clientNameHeader?: string;
  protected readonly userAgent: string;
  protected readonly extraClientContext?: Record<string, unknown>;
  protected readonly extraBody?: Record<string, unknown>;
  protected readonly preferredCodecs: AudioCodec[];
  protected readonly clock: Clock;
  protected readonly logger: Logger;

  constructor(httpClient: HttpClient, config: BaseStrategyConfig) {
    this.httpClient = httpClient;
    this.name = config.name;
    this.url = config.url ?? 'https://www.youtube.com/youtubei/v1/player';
    this.clientName = config.clientName;
    this.clientVersion = config.clientVersion;
    this.clientPlatform = config.clientPlatform ?? 'DESKTOP';
    this.clientNameHeader = config.clientNameHeader;
    this.userAgent = config.userAgent;
    this.extraClientContext = config.extraClientContext;
    this.extraBody = config.extraBody;
    this.preferredCodecs = config.preferredCodecs ?? ['opus', 'aac', 'other'];
    this.clock = config.clock ?? new SystemClock();
    this.logger = config.logger ?? createLogger({ prefix: `StreamStrategy[${this.name}]` });
  }

  async resolve(
    videoId: string,
    options: ResolveOptions = {},
  ): Promise<Result<ResolvedStream, StreamError>> {
    this.logger.debug(`Resolving audio stream for videoId: "${videoId}"`);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': this.userAgent,
    };
    if (this.clientNameHeader) {
      headers['X-YouTube-Client-Name'] = this.clientNameHeader;
      headers['X-YouTube-Client-Version'] = this.clientVersion;
    }
    if (options.visitorData) {
      headers['X-Goog-Visitor-Id'] = options.visitorData;
    }

    const clientObj: Record<string, unknown> = {
      clientName: this.clientName,
      clientVersion: this.clientVersion,
      clientPlatform: this.clientPlatform,
      hl: 'en',
      gl: 'US',
      utcOffsetMinutes: 0,
      ...this.extraClientContext,
    };
    if (options.visitorData) {
      clientObj.visitorData = options.visitorData;
    }

    const body: Record<string, unknown> = {
      context: {
        client: clientObj,
        user: {
          lockedSafetyMode: false,
        },
        request: {
          useSsl: true,
        },
      },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
      ...this.extraBody,
    };

    const res = await this.httpClient.post<unknown>(this.url, body, {
      headers,
      signal: options.signal,
      timeoutMs: 15000,
    });

    if (!res.ok) {
      const statusCode = res.error.statusCode;
      const is403 = statusCode === 403;
      return err(
        new StreamError(
          `InnerTube player HTTP request failed: ${res.error.message}`,
          videoId,
          is403 ? 'HTTP_403' : 'UNPLAYABLE',
          { statusCode, strategy: this.name },
          res.error,
        ),
      );
    }

    const nowMs = this.clock.now();
    const parsed = parsePlayerResponse(res.value.data, {
      videoId,
      preferredCodecs: this.preferredCodecs,
      nowMs,
    });

    if (!parsed.ok) {
      return parsed;
    }

    return ok({
      stream: parsed.value.stream,
      strategyName: this.name,
      videoDetails: parsed.value.videoDetails,
      rawFormat: parsed.value.rawFormat,
    });
  }
}
