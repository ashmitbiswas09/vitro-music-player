import { describe, it, expect } from 'vitest';
import {
  MemorySecureStore,
  MemoryKeyValueStore,
  MemorySqlDatabase,
  MemoryFileStore,
  MemoryHttpClient,
} from '@/backend/platform';
import { isOk, isErr } from '@/backend/core';

describe('Platform In-Memory Adapters', () => {
  describe('MemorySecureStore', () => {
    it('sets, gets, and deletes sensitive key-values', async () => {
      const store = new MemorySecureStore();
      expect(isOk(await store.set('cookie_token', 'secret123'))).toBe(true);

      const getRes = await store.get('cookie_token');
      expect(isOk(getRes) && getRes.value).toBe('secret123');

      const missing = await store.get('nonexistent');
      expect(isOk(missing) && missing.value).toBeNull();

      await store.delete('cookie_token');
      const afterDel = await store.get('cookie_token');
      expect(isOk(afterDel) && afterDel.value).toBeNull();
    });
  });

  describe('MemoryKeyValueStore', () => {
    it('stores and retrieves typed values and lists keys', async () => {
      const store = new MemoryKeyValueStore();
      await store.set('theme', { dark: true, accent: 'teal' });
      await store.set('volume', 85);

      const themeRes = await store.get<{ dark: boolean; accent: string }>('theme');
      expect(isOk(themeRes) && themeRes.value?.accent).toBe('teal');

      const keysRes = await store.getAllKeys();
      expect(isOk(keysRes) && keysRes.value).toEqual(['theme', 'volume']);

      await store.clear();
      const emptyKeys = await store.getAllKeys();
      expect(isOk(emptyKeys) && emptyKeys.value).toEqual([]);
    });
  });

  describe('MemorySqlDatabase', () => {
    it('executes tables creation, insert, delete, and query in memory', async () => {
      const db = new MemorySqlDatabase();
      const createRes = await db.execute(
        'CREATE TABLE IF NOT EXISTS search_cache (id TEXT PRIMARY KEY, query TEXT)',
      );
      expect(isOk(createRes)).toBe(true);

      const insertRes = await db.execute('INSERT INTO search_cache (query) VALUES (?)', [
        'Radiohead',
      ]);
      expect(isOk(insertRes) && insertRes.value.rowsAffected).toBe(1);

      const queryRes = await db.query('SELECT * FROM search_cache');
      expect(isOk(queryRes) && queryRes.value).toHaveLength(1);

      const txRes = await db.transaction(async () => {
        return 'transaction_ok';
      });
      expect(isOk(txRes) && txRes.value).toBe('transaction_ok');

      await db.close();
    });
  });

  describe('MemoryFileStore', () => {
    it('writes, reads, checks existence, and deletes virtual files', async () => {
      const fs = new MemoryFileStore();
      const path = 'tracks/song_1.bin';

      const writeRes = await fs.write(path, 'audio-binary-data');
      expect(isOk(writeRes)).toBe(true);

      const existsRes = await fs.exists(path);
      expect(isOk(existsRes) && existsRes.value).toBe(true);

      const textRes = await fs.readText(path);
      expect(isOk(textRes) && textRes.value).toBe('audio-binary-data');

      const metaRes = await fs.getMetadata(path);
      expect(isOk(metaRes) && metaRes.value.sizeBytes).toBeGreaterThan(0);

      await fs.delete(path);
      const afterDelete = await fs.exists(path);
      expect(isOk(afterDelete) && afterDelete.value).toBe(false);

      const readMissing = await fs.read(path);
      expect(isErr(readMissing)).toBe(true);
    });
  });

  describe('MemoryHttpClient', () => {
    it('dispatches to registered mock handlers and records requests', async () => {
      const http = new MemoryHttpClient();
      http.whenGet('https://api.music.com/tracks/1', { id: '1', title: 'Creep' });
      http.whenPost('https://api.music.com/feedback', { status: 'acknowledged' });

      const getRes = await http.get<{ id: string; title: string }>(
        'https://api.music.com/tracks/1',
      );
      expect(isOk(getRes) && getRes.value.data.title).toBe('Creep');

      const postRes = await http.post<{ status: string }>('https://api.music.com/feedback', {
        rating: 5,
      });
      expect(isOk(postRes) && postRes.value.data.status).toBe('acknowledged');

      expect(http.recordedRequests).toHaveLength(2);
      expect(http.recordedRequests[0].url).toBe('https://api.music.com/tracks/1');

      // Unregistered route returns 404 network error
      const missingRes = await http.get('https://api.music.com/unknown');
      expect(isErr(missingRes) && missingRes.error.statusCode).toBe(404);
    });
  });
});
