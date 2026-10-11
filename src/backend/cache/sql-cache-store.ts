/**
 * SQLite persistence layer for cache entries using the SqlDatabase port.
 */

import { isOk, logger } from '@/backend/core';
import type { SqlDatabase } from '@/backend/platform';
import type { CacheEntry, CacheDataType } from './types';

export class SqlCacheStore {
  private isInitialized = false;

  constructor(private readonly db: SqlDatabase) {}

  async init(): Promise<void> {
    if (this.isInitialized) return;

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS cache_entries (
        key TEXT PRIMARY KEY,
        data_type TEXT NOT NULL,
        value TEXT NOT NULL,
        scope TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        fresh_until INTEGER NOT NULL,
        stale_until INTEGER NOT NULL,
        size_bytes INTEGER NOT NULL
      );
    `);

    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS idx_cache_stale ON cache_entries(stale_until);
    `);

    this.isInitialized = true;
  }

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    await this.init();

    const res = await this.db.query<{
      key: string;
      data_type: string;
      value: string;
      scope: string;
      created_at: number;
      fresh_until: number;
      stale_until: number;
      size_bytes: number;
    }>('SELECT * FROM cache_entries WHERE key = ?', [key]);

    if (!isOk(res) || res.value.length === 0) {
      return null;
    }

    const row = res.value[0];
    try {
      const parsedValue = JSON.parse(row.value) as T;
      return {
        key: row.key,
        dataType: row.data_type as CacheDataType,
        value: parsedValue,
        scope: row.scope,
        createdAt: Number(row.created_at),
        freshUntil: Number(row.fresh_until),
        staleUntil: Number(row.stale_until),
        sizeBytes: Number(row.size_bytes),
      };
    } catch (e) {
      logger.warn(`[SqlCacheStore] Corrupted JSON payload for key ${key}`, { error: String(e) });
      await this.delete(key);
      return null;
    }
  }

  async set<T>(entry: CacheEntry<T>): Promise<void> {
    await this.init();

    const serializedValue = JSON.stringify(entry.value);
    const sizeBytes = serializedValue.length * 2;

    await this.db.execute(
      `INSERT OR REPLACE INTO cache_entries (key, data_type, value, scope, created_at, fresh_until, stale_until, size_bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.key,
        entry.dataType,
        serializedValue,
        entry.scope,
        entry.createdAt,
        entry.freshUntil,
        entry.staleUntil,
        sizeBytes,
      ],
    );
  }

  async delete(key: string): Promise<void> {
    await this.init();
    await this.db.execute('DELETE FROM cache_entries WHERE key = ?', [key]);
  }

  async deleteExpired(now: number): Promise<number> {
    await this.init();
    const res = await this.db.execute('DELETE FROM cache_entries WHERE stale_until < ?', [now]);
    return isOk(res) ? res.value.rowsAffected : 0;
  }

  async clear(): Promise<void> {
    await this.init();
    await this.db.execute('DELETE FROM cache_entries');
  }

  async count(): Promise<number> {
    await this.init();
    const res = await this.db.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM cache_entries',
    );
    if (isOk(res) && res.value.length > 0) {
      return Number(res.value[0].count);
    }
    return 0;
  }
}
