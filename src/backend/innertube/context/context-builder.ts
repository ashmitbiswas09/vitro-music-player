/**
 * Builds request context and headers for InnerTube API calls.
 */

import type { InnertubeClientConfig } from '@/backend/core';

export interface InnertubeContextPayload {
  context: {
    client: {
      clientName: string;
      clientVersion: string;
      clientPlatform: string;
      hl: string;
      gl: string;
      visitorData?: string;
    };
    user: {
      lockedSafetyMode: boolean;
    };
  };
  [key: string]: unknown;
}

export class ContextBuilder {
  private readonly config: InnertubeClientConfig;

  constructor(config: InnertubeClientConfig) {
    this.config = config;
  }

  buildHeaders(
    visitorData?: string,
    extraHeaders: Record<string, string> = {},
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': this.config.userAgent,
      'X-YouTube-Client-Name': this.config.clientNameHeader,
      'X-YouTube-Client-Version': this.config.clientVersion,
      Origin: this.config.origin,
      Referer: this.config.referer,
      ...extraHeaders,
    };

    if (visitorData) {
      headers['X-Goog-Visitor-Id'] = visitorData;
    }

    return headers;
  }

  buildBody(params: Record<string, unknown> = {}, visitorData?: string): InnertubeContextPayload {
    return {
      context: {
        client: {
          clientName: this.config.clientName,
          clientVersion: this.config.clientVersion,
          clientPlatform: this.config.clientPlatform,
          hl: this.config.defaultLocale,
          gl: this.config.defaultCountry,
          ...(visitorData ? { visitorData } : {}),
        },
        user: {
          lockedSafetyMode: false,
        },
      },
      ...params,
    };
  }
}
