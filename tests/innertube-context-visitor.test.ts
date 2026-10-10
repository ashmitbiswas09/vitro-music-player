import { describe, it, expect } from 'vitest';
import { ContextBuilder, VisitorDataManager } from '@/backend/innertube';
import { DEFAULT_INNERTUBE_CONFIG } from '@/backend/core';
import { MemoryKeyValueStore, MemoryHttpClient } from '@/backend/platform';

describe('Innertube ContextBuilder & VisitorDataManager', () => {
  describe('ContextBuilder', () => {
    const builder = new ContextBuilder(DEFAULT_INNERTUBE_CONFIG);

    it('builds standard request headers with client info', () => {
      const headers = builder.buildHeaders('VISITOR_TOKEN_123');
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['X-YouTube-Client-Name']).toBe('67');
      expect(headers['X-YouTube-Client-Version']).toBe(DEFAULT_INNERTUBE_CONFIG.clientVersion);
      expect(headers['X-Goog-Visitor-Id']).toBe('VISITOR_TOKEN_123');
      expect(headers['Origin']).toBe('https://music.youtube.com');
      expect(headers['Referer']).toBe('https://music.youtube.com/');
    });

    it('omits visitor header when visitorData is not present', () => {
      const headers = builder.buildHeaders();
      expect(headers['X-Goog-Visitor-Id']).toBeUndefined();
    });

    it('builds context body with client platform, locale, and query', () => {
      const body = builder.buildBody({ query: 'Radiohead' }, 'VISITOR_TOKEN_456');
      expect(body.context.client.clientName).toBe('WEB_REMIX');
      expect(body.context.client.hl).toBe('en');
      expect(body.context.client.gl).toBe('US');
      expect(body.context.client.visitorData).toBe('VISITOR_TOKEN_456');
      expect(body.query).toBe('Radiohead');
    });
  });

  describe('VisitorDataManager', () => {
    it('uses visitorDataOverride when provided', async () => {
      const manager = new VisitorDataManager({
        override: 'MANUAL_OVERRIDE_TOKEN',
        config: DEFAULT_INNERTUBE_CONFIG,
      });

      expect(await manager.getVisitorData()).toBe('MANUAL_OVERRIDE_TOKEN');
    });

    it('retrieves and reuses persisted visitorData from KeyValueStore', async () => {
      const kv = new MemoryKeyValueStore();
      await kv.set('ytm_visitor_data', 'STORED_TOKEN_789');

      const manager = new VisitorDataManager({
        keyValueStore: kv,
        config: DEFAULT_INNERTUBE_CONFIG,
      });

      const token = await manager.getVisitorData();
      expect(token).toBe('STORED_TOKEN_789');
    });

    it('updates visitorData dynamically from responseContext and persists it', async () => {
      const kv = new MemoryKeyValueStore();
      const manager = new VisitorDataManager({
        keyValueStore: kv,
        config: DEFAULT_INNERTUBE_CONFIG,
      });

      await manager.updateFromResponse({
        responseContext: {
          visitorData: 'DYNAMIC_TOKEN_FROM_API',
        },
      });

      expect(await manager.getVisitorData()).toBe('DYNAMIC_TOKEN_FROM_API');
      const inStore = await kv.get('ytm_visitor_data');
      expect(inStore.ok && inStore.value).toBe('DYNAMIC_TOKEN_FROM_API');
    });

    it('fetches guest visitorData via visitor_id endpoint on first use', async () => {
      const http = new MemoryHttpClient();
      http.whenPost(`${DEFAULT_INNERTUBE_CONFIG.baseUrl}/visitor_id`, {
        responseContext: { visitorData: 'GUEST_TOKEN_FROM_VISITOR_ID' },
      });

      const kv = new MemoryKeyValueStore();
      const manager = new VisitorDataManager({
        keyValueStore: kv,
        httpClient: http,
        config: DEFAULT_INNERTUBE_CONFIG,
      });

      const token = await manager.getVisitorData();
      expect(token).toBe('GUEST_TOKEN_FROM_VISITOR_ID');
      const inStore = await kv.get('ytm_visitor_data');
      expect(inStore.ok && inStore.value).toBe('GUEST_TOKEN_FROM_VISITOR_ID');
    });
  });
});
