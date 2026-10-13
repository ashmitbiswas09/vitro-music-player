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
  readonly name = 'authenticated-webremix';
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

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      'X-YouTube-Client-Name': '67', // WEB_REMIX
      'X-YouTube-Client-Version': '1.20240101.01.00',
      ...authHeadersRes.value,
    };

    if (options.visitorData) {
      headers['X-Goog-Visitor-Id'] = options.visitorData;
    }

    const body: Record<string, unknown> = {
      context: {
        client: {
          clientName: 'WEB_REMIX',
          clientVersion: '1.20240101.01.00',
          clientPlatform: 'DESKTOP',
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
        'User-Agent': headers['User-Agent'],
        Accept: '*/*',
        Cookie: authHeadersRes.value.Cookie,
      },
    });
  }
}
