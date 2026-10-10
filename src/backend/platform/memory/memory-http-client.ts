/**
 * In-memory HttpClient adapter for tests and local Node CLI mock environments.
 */

import { ok, err, NetworkError, type Result } from '@/backend/core';
import type { HttpClient, HttpRequestOptions, HttpResponse } from '../types';

export type HttpRequestHandler = (
  url: string,
  options: HttpRequestOptions,
) => Promise<HttpResponse<unknown>> | HttpResponse<unknown>;

export interface RecordedRequest {
  url: string;
  options: HttpRequestOptions;
  timestamp: number;
}

export class MemoryHttpClient implements HttpClient {
  private readonly handlers = new Map<string, HttpRequestHandler>();
  readonly recordedRequests: RecordedRequest[] = [];
  defaultHandler?: HttpRequestHandler;

  addHandler(methodAndUrlPrefix: string, handler: HttpRequestHandler): void {
    this.handlers.set(methodAndUrlPrefix, handler);
  }

  whenGet<T>(urlPrefix: string, responseData: T, status = 200): void {
    this.addHandler(`GET:${urlPrefix}`, () => ({
      status,
      statusText: status === 200 ? 'OK' : 'Mock Response',
      headers: { 'content-type': 'application/json' },
      data: responseData,
      durationMs: 1,
    }));
  }

  whenPost<T>(urlPrefix: string, responseData: T, status = 200): void {
    this.addHandler(`POST:${urlPrefix}`, () => ({
      status,
      statusText: status === 200 ? 'OK' : 'Mock Response',
      headers: { 'content-type': 'application/json' },
      data: responseData,
      durationMs: 1,
    }));
  }

  clearRecordedRequests(): void {
    this.recordedRequests.length = 0;
  }

  async request<T = unknown>(
    url: string,
    options: HttpRequestOptions = {},
  ): Promise<Result<HttpResponse<T>, NetworkError>> {
    const method = options.method ?? 'GET';
    this.recordedRequests.push({ url, options, timestamp: Date.now() });

    const key = `${method}:${url}`;
    let handler: HttpRequestHandler | undefined = this.handlers.get(key);

    if (!handler) {
      for (const [pattern, h] of this.handlers.entries()) {
        const colonIdx = pattern.indexOf(':');
        const hMethod = pattern.slice(0, colonIdx);
        const hUrl = pattern.slice(colonIdx + 1);
        if (hMethod === method && url.startsWith(hUrl)) {
          handler = h;
          break;
        }
      }
    }

    if (!handler && this.defaultHandler) {
      handler = this.defaultHandler;
    }

    if (!handler) {
      return err(
        new NetworkError(`No mock handler registered for ${method} ${url}`, {
          url,
          statusCode: 404,
        }),
      );
    }

    try {
      const response = await handler(url, options);
      if (response.status >= 400) {
        return err(
          new NetworkError(`HTTP ${response.status}: ${response.statusText}`, {
            statusCode: response.status,
            url,
            details: { data: response.data },
          }),
        );
      }
      return ok(response as HttpResponse<T>);
    } catch (caught) {
      return err(
        new NetworkError(
          caught instanceof Error ? caught.message : 'MemoryHttpClient mock failed',
          { url, cause: caught },
        ),
      );
    }
  }

  get<T = unknown>(
    url: string,
    options?: Omit<HttpRequestOptions, 'method'>,
  ): Promise<Result<HttpResponse<T>, NetworkError>> {
    return this.request<T>(url, { ...options, method: 'GET' });
  }

  post<T = unknown>(
    url: string,
    body?: unknown,
    options?: Omit<HttpRequestOptions, 'method' | 'body'>,
  ): Promise<Result<HttpResponse<T>, NetworkError>> {
    return this.request<T>(url, { ...options, method: 'POST', body });
  }
}
