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
});
