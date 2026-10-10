/**
 * Innertube client for interacting with YouTube Music endpoints.
 */

import {
  type Result,
  AppError,
  NetworkError,
  type InnertubeClientConfig,
  type Logger,
  DEFAULT_INNERTUBE_CONFIG,
  createLogger,
  retryAsync,
  isRetryableError,
} from '@/backend/core';
import type { HttpClient } from '@/backend/platform';
import type { SearchFilter, SearchOptions, SearchResponse, InnertubeClientOptions } from './types';
import { ContextBuilder } from './context/context-builder';
import { VisitorDataManager } from './visitor/visitor-data-manager';
import { parseSearchResponse } from './parsers/search-parser';

// Publicly verified parameter tokens for YouTube Music category filtering
const SEARCH_FILTER_PARAMS: Record<SearchFilter, string | undefined> = {
  all: undefined,
  songs: 'EgWKAQIIAWoKEAkQChAKEAUQEQ%3D%3D',
  albums: 'EgWKAQIBAWoKEAkQChAKEAUQEQ%3D%3D',
  artists: 'EgWKAQIgAWoKEAkQChAKEAUQEQ%3D%3D',
  playlists: 'EgWKAQIoAWoKEAkQChAKEAUQEQ%3D%3D',
  videos: 'EgWKAQIQAWoKEAkQChAKEAUQEQ%3D%3D',
};

export class InnertubeClient {
  private readonly httpClient: HttpClient;
  private readonly config: InnertubeClientConfig;
  private readonly contextBuilder: ContextBuilder;
  private readonly visitorManager: VisitorDataManager;
  private readonly logger: Logger;

  constructor(options: InnertubeClientOptions) {
    this.httpClient = options.httpClient;
    this.config = {
      ...DEFAULT_INNERTUBE_CONFIG,
      ...options.config,
    };
    this.contextBuilder = new ContextBuilder(this.config);
    this.visitorManager = new VisitorDataManager({
      keyValueStore: options.keyValueStore,
      override: options.visitorDataOverride,
      httpClient: this.httpClient,
      config: this.config,
    });
    this.logger = options.logger ?? createLogger({ prefix: 'Innertube' });
  }

  async getVisitorData(): Promise<string | undefined> {
    return this.visitorManager.getVisitorData();
  }

  async setVisitorData(visitorData: string): Promise<void> {
    return this.visitorManager.setVisitorData(visitorData);
  }

  async getRawSearch(
    query: string,
    options: SearchOptions = {},
  ): Promise<Result<unknown, AppError>> {
    const visitorData = options.visitorData ?? (await this.visitorManager.getVisitorData());
    const filter = options.filter ?? 'all';
    const filterParam = SEARCH_FILTER_PARAMS[filter];

    const bodyParams: Record<string, unknown> = { query };
    if (filterParam) {
      bodyParams.params = filterParam;
    }
    if (options.continuationToken) {
      bodyParams.continuation = options.continuationToken;
    }

    const body = this.contextBuilder.buildBody(bodyParams, visitorData);
    const headers = this.contextBuilder.buildHeaders(visitorData);
    const url = `${this.config.baseUrl}/search`;

    this.logger.debug(`Fetching search for query: "${query}"`, { filter });

    const fetchRes = await retryAsync(
      async () => {
        const res = await this.httpClient.post<unknown>(url, body, {
          headers,
          signal: options.signal,
          timeoutMs: this.config.requestTimeoutMs,
        });
        if (!res.ok && isRetryableError(res.error)) {
          throw res.error;
        }
        return res;
      },
      {
        maxAttempts: this.config.maxRetryAttempts,
        initialDelayMs: this.config.retryInitialDelayMs,
      },
    ).catch((err: unknown) => {
      if (err instanceof AppError) {
        return { ok: false as const, error: err };
      }
      return {
        ok: false as const,
        error: new NetworkError(err instanceof Error ? err.message : String(err), { cause: err }),
      };
    });

    if (!fetchRes.ok) {
      return fetchRes;
    }

    await this.visitorManager.updateFromResponse(fetchRes.value.data);
    return fetchRes.value.data ? { ok: true, value: fetchRes.value.data } : fetchRes;
  }

  async search(
    query: string,
    options: SearchOptions = {},
  ): Promise<Result<SearchResponse, AppError>> {
    const rawRes = await this.getRawSearch(query, options);
    if (!rawRes.ok) {
      return rawRes;
    }

    const filter = options.filter ?? 'all';
    return parseSearchResponse(rawRes.value, query, filter);
  }
}
