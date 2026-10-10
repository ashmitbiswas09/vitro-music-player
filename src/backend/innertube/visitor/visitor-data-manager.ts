/**
 * Manages visitorData lifecycle:
 * Automatically fetches guest visitorData on first use, persists it in KeyValueStore,
 * reuses it, and allows an optional override.
 */

import type { InnertubeClientConfig } from '@/backend/core';
import type { HttpClient, KeyValueStore } from '@/backend/platform';

const VISITOR_DATA_KEY = 'ytm_visitor_data';

export class VisitorDataManager {
  private inMemoryVisitorData?: string;
  private readonly keyValueStore?: KeyValueStore;
  private readonly override?: string;
  private readonly httpClient?: HttpClient;
  private readonly config: InnertubeClientConfig;

  constructor(options: {
    keyValueStore?: KeyValueStore;
    override?: string;
    httpClient?: HttpClient;
    config: InnertubeClientConfig;
  }) {
    this.keyValueStore = options.keyValueStore;
    this.override = options.override;
    this.httpClient = options.httpClient;
    this.config = options.config;
    if (this.override) {
      this.inMemoryVisitorData = this.override;
    }
  }

  async getVisitorData(): Promise<string | undefined> {
    if (this.override) {
      return this.override;
    }

    if (this.inMemoryVisitorData) {
      return this.inMemoryVisitorData;
    }

    // Check persistence
    if (this.keyValueStore) {
      const stored = await this.keyValueStore.get<string>(VISITOR_DATA_KEY);
      if (stored.ok && stored.value) {
        this.inMemoryVisitorData = stored.value;
        return this.inMemoryVisitorData;
      }
    }

    // Attempt to fetch fresh guest visitorData via visitor_id endpoint
    if (this.httpClient) {
      const fetched = await this.fetchGuestVisitorData();
      if (fetched) {
        await this.setVisitorData(fetched);
        return fetched;
      }
    }

    return undefined;
  }

  async setVisitorData(visitorData: string): Promise<void> {
    if (!visitorData || this.override) return;
    this.inMemoryVisitorData = visitorData;

    if (this.keyValueStore) {
      await this.keyValueStore.set(VISITOR_DATA_KEY, visitorData);
    }
  }

  async updateFromResponse(responseBody: unknown): Promise<void> {
    if (this.override || !responseBody || typeof responseBody !== 'object') return;

    const bodyObj = responseBody as {
      responseContext?: {
        visitorData?: string;
      };
    };

    const visitorData = bodyObj.responseContext?.visitorData;
    if (
      visitorData &&
      typeof visitorData === 'string' &&
      visitorData !== this.inMemoryVisitorData
    ) {
      await this.setVisitorData(visitorData);
    }
  }

  private async fetchGuestVisitorData(): Promise<string | undefined> {
    if (!this.httpClient) return undefined;

    try {
      const url = `${this.config.baseUrl}/visitor_id`;
      const res = await this.httpClient.post<{ responseContext?: { visitorData?: string } }>(
        url,
        {
          context: {
            client: {
              clientName: this.config.clientName,
              clientVersion: this.config.clientVersion,
              hl: this.config.defaultLocale,
              gl: this.config.defaultCountry,
            },
          },
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': this.config.userAgent,
            'X-YouTube-Client-Name': this.config.clientNameHeader,
            'X-YouTube-Client-Version': this.config.clientVersion,
            Origin: this.config.origin,
            Referer: this.config.referer,
          },
          timeoutMs: 5000,
        },
      );

      if (res.ok && res.value.data?.responseContext?.visitorData) {
        return res.value.data.responseContext.visitorData;
      }
    } catch {
      // Graceful fallback: visitorData can be acquired from first search response
    }

    return undefined;
  }
}
