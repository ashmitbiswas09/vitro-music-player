import { describe, it, expect } from 'vitest';
import { createBackend } from '@/backend/services';
import {
  FetchHttpClient,
  MemorySecureStore,
  MemoryKeyValueStore,
  MemorySqlDatabase,
  MemoryFileStore,
} from '@/backend/platform';

describe('Services - createBackend', () => {
  it('creates backend facade with default adapters', () => {
    const backend = createBackend();
    expect(backend).toBeDefined();
    expect(backend.innertube).toBeDefined();
    expect(backend.streaming).toBeDefined();
    expect(backend.adapters.httpClient).toBeDefined();
    expect(backend.adapters.secureStore).toBeDefined();
    expect(backend.adapters.keyValueStore).toBeDefined();
    expect(backend.adapters.sqlDatabase).toBeDefined();
    expect(backend.adapters.fileStore).toBeDefined();
  });

  it('accepts custom injected adapters', () => {
    const secureStore = new MemorySecureStore();
    const keyValueStore = new MemoryKeyValueStore();
    const sqlDatabase = new MemorySqlDatabase();
    const fileStore = new MemoryFileStore();
    const httpClient = new FetchHttpClient();

    const backend = createBackend({
      httpClient,
      secureStore,
      keyValueStore,
      sqlDatabase,
      fileStore,
    });

    expect(backend.adapters.secureStore).toBe(secureStore);
    expect(backend.adapters.keyValueStore).toBe(keyValueStore);
    expect(backend.adapters.sqlDatabase).toBe(sqlDatabase);
    expect(backend.adapters.fileStore).toBe(fileStore);
    expect(backend.adapters.httpClient).toBe(httpClient);
  });

  it('warmUp initializes backing stores and restores state in parallel', async () => {
    const keyValueStore = new MemoryKeyValueStore();
    await keyValueStore.set('ytm_visitor_data', 'persisted-visitor-token-123');
    await keyValueStore.set(
      'playback:state',
      JSON.stringify({
        queue: [
          {
            id: 'd7lbzUUXj0k',
            title: 'Black Star',
            artists: [{ name: 'Radiohead' }],
            thumbnails: [],
          },
        ],
        currentIndex: 0,
        positionMs: 12000,
        repeatMode: 'off',
        isShuffled: false,
      }),
    );

    const backend = createBackend({ keyValueStore });
    await expect(backend.warmUp()).resolves.toBeUndefined();

    // Verify visitorData restored
    const visitorData = await backend.innertube.getVisitorData();
    expect(visitorData).toBe('persisted-visitor-token-123');

    // Verify playback queue restored
    const state = backend.playback.getState();
    expect(state.queue.length).toBe(1);
    expect(state.queue[0]?.id).toBe('d7lbzUUXj0k');
    expect(state.positionMs).toBe(12000);
  });

  it('search triggers background pre-resolution for top track result', async () => {
    const backend = createBackend();
    let streamResolvedId: string | null = null;
    backend.streaming.resolve = async (id: string) => {
      streamResolvedId = id;
      return {
        ok: true,
        value: {
          url: 'https://example.com/stream.webm',
          mimeType: 'audio/webm',
          codec: 'opus',
          bitrateKbps: 150,
          strategy: 'visionos',
          resolvedAt: Date.now(),
          expiresAt: Date.now() + 21600000,
        },
      } as any;
    };

    backend.innertube.search = async () => ({
      ok: true,
      value: {
        query: 'Radiohead',
        filter: 'all',
        items: [
          {
            type: 'track',
            track: {
              id: '9RfVp-GhKfs',
              title: 'Creep',
              artists: [{ name: 'Radiohead' }],
              thumbnails: [],
            },
          },
        ],
        parseDurationMs: 10,
        responseSizeBytes: 500,
      },
    });

    const res = await backend.search('Radiohead');
    expect(res.ok).toBe(true);

    // Wait a brief tick for the fire-and-forget promise
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(streamResolvedId).toBe('9RfVp-GhKfs');
  });
});
