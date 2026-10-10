/**
 * Universal FetchHttpClient adapter.
 * Uses global fetch, compatible with both modern Node.js and React Native.
 */

import { ok, err, NetworkError, type Result } from '@/backend/core';
import type { HttpClient, HttpRequestOptions, HttpResponse } from '../types';

export interface FetchHttpClientOptions {
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  defaultTimeoutMs?: number;
}

export class FetchHttpClient implements HttpClient {
  private readonly baseUrl: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly defaultTimeoutMs: number;

  constructor(options: FetchHttpClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? '';
    this.defaultHeaders = options.defaultHeaders ?? {};
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 15000;
  }

  private buildUrl(pathOrUrl: string, params?: HttpRequestOptions['params']): string {
    let fullUrl =
      pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')
        ? pathOrUrl
        : `${this.baseUrl}${pathOrUrl}`;

    if (!params) {
      return fullUrl;
    }

    const urlObj = new URL(fullUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        urlObj.searchParams.set(key, String(value));
      }
    }
    return urlObj.toString();
  }

  async request<T = unknown>(
    url: string,
    options: HttpRequestOptions = {},
  ): Promise<Result<HttpResponse<T>, NetworkError>> {
    const startTime = performance.now();
    const targetUrl = this.buildUrl(url, options.params);
    const method = options.method ?? 'GET';
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;

    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      ...options.headers,
    };

    let body: BodyInit | undefined = undefined;
    if (
      options.body !== undefined &&
      options.body !== null &&
      method !== 'GET' &&
      method !== 'HEAD'
    ) {
      if (typeof options.body === 'string') {
        body = options.body;
      } else if (options.body instanceof Uint8Array) {
        body = options.body.buffer as ArrayBuffer;
      } else {
        body = JSON.stringify(options.body);
        if (!headers['Content-Type'] && !headers['content-type']) {
          headers['Content-Type'] = 'application/json';
        }
      }
    }

    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    if (options.signal) {
      options.signal.addEventListener('abort', () => controller.abort());
    }

    try {
      const response = await fetch(targetUrl, {
        method,
        headers,
        body,
        signal: controller.signal,
      });

      const durationMs = performance.now() - startTime;
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((val, key) => {
        responseHeaders[key.toLowerCase()] = val;
      });

      let parsedData: unknown;
      const contentType = responseHeaders['content-type'] ?? '';
      if (contentType.includes('application/json')) {
        parsedData = await response.json();
      } else {
        const text = await response.text();
        try {
          parsedData = JSON.parse(text);
        } catch {
          parsedData = text;
        }
      }

      if (!response.ok) {
        return err(
          new NetworkError(`HTTP ${response.status}: ${response.statusText}`, {
            statusCode: response.status,
            url: targetUrl,
            details: {
              statusText: response.statusText,
              headers: responseHeaders,
              data: parsedData,
            },
          }),
        );
      }

      return ok({
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        data: parsedData as T,
        durationMs,
      });
    } catch (caught) {
      const isAbort = controller.signal.aborted;
      const isOffline =
        caught instanceof TypeError && caught.message.toLowerCase().includes('fetch failed');

      const message = isAbort
        ? `Request timed out after ${timeoutMs} ms`
        : caught instanceof Error
          ? caught.message
          : 'Network request failed';

      return err(
        new NetworkError(message, {
          url: targetUrl,
          isOffline,
          cause: caught,
        }),
      );
    } finally {
      clearTimeout(timeoutTimer);
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
