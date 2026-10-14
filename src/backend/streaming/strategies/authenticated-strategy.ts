/**
 * Authenticated Stream Strategy for resolving age-restricted, members-only,
 * or login-required streams via signed session headers.
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
import type { AuthService } from '@/backend/auth';
import type { StreamStrategy, ResolvedStream, ResolveOptions } from '../types';
import { parsePlayerResponse } from '../parsers/player-parser';

export interface AuthenticatedStrategyConfig {
  authService: AuthService;
  preferredCodecs?: AudioCodec[];
  clock?: Clock;
  logger?: Logger;
}

export class AuthenticatedStreamStrategy implements StreamStrategy {
  readonly name = 'authenticated-visionos';
  private readonly httpClient: HttpClient;
  private readonly authService: AuthService;
  private readonly preferredCodecs: AudioCodec[];
  private readonly clock: Clock;
  private readonly logger: Logger;

  constructor(httpClient: HttpClient, config: AuthenticatedStrategyConfig) {
    this.httpClient = httpClient;
    this.authService = config.authService;
    this.preferredCodecs = config.preferredCodecs ?? ['opus', 'aac', 'other'];
    this.clock = config.clock ?? new SystemClock();
    this.logger = config.logger ?? createLogger({ prefix: `StreamStrategy[${this.name}]` });
  }

  async resolveStream(
    videoId: string,
    options: ResolveOptions = {},
  ): Promise<Result<ResolvedStream, StreamError>> {
    return this.resolve(videoId, options);
  }

  async resolve(
    videoId: string,
    options: ResolveOptions = {},
  ): Promise<Result<ResolvedStream, StreamError>> {
    this.logger.debug(`Attempting authenticated stream resolution for videoId: "${videoId}"`);

    const authHeadersRes = await this.authService.getAuthHeaders('https://music.youtube.com');
    if (!authHeadersRes.ok) {
      return err(
        new StreamError(
          `Cannot resolve stream with auth: ${authHeadersRes.error.message}`,
          videoId,
          'LOGIN_REQUIRED',
          undefined,
          authHeadersRes.error,
          true,
        ),
      );
    }

    const userAgent =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': userAgent,
      'X-YouTube-Client-Name': '101',
      'X-YouTube-Client-Version': '1.02',
      'X-Origin': 'https://music.youtube.com',
      'X-Goog-AuthUser': '0',
      ...authHeadersRes.value,
    };

    if (options.visitorData) {
      headers['X-Goog-Visitor-Id'] = options.visitorData;
    }

    const body: Record<string, unknown> = {
      context: {
        client: {
          clientName: 'VISIONOS',
          clientVersion: '1.02',
          clientPlatform: 'MOBILE',
          deviceMake: 'Apple',
          deviceModel: 'RealityDevice17,1',
          osName: 'visionOS',
          osVersion: '26.5.23O471',
          hl: 'en',
          gl: 'US',
          utcOffsetMinutes: 0,
          ...(options.visitorData ? { visitorData: options.visitorData } : {}),
        },
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
    };

    const url = 'https://music.youtube.com/youtubei/v1/player';
    const res = await this.httpClient.post<unknown>(url, body, {
      headers,
      signal: options.signal,
      timeoutMs: 15000,
    });

    if (!res.ok) {
      const statusCode = res.error.statusCode;
      return err(
        new StreamError(
          `Authenticated player request failed: ${res.error.message}`,
          videoId,
          statusCode === 403 ? 'HTTP_403' : 'NETWORK',
          { statusCode, strategy: this.name },
          res.error,
          false,
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
      requestHeaders: {
        'User-Agent': userAgent,
        Accept: '*/*',
      },
    });
  }
}
