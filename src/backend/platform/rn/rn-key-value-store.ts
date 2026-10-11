/**
 * React Native KeyValueStore adapter backed by SQLite.
 * Uses a dedicated table to avoid Android AsyncStorage cursor size limitations
 * while maintaining ACID reliability and fast indexed lookups.
 */

import { ok, err, StorageError, type Result } from '@/backend/core';
import type { KeyValueStore, SqlDatabase } from '../types';
import { RnSqliteDatabase } from './rn-sqlite-database';

export class RnKeyValueStore implements KeyValueStore {
  private readonly db: SqlDatabase;
  private readonly tableName: string;
  private initPromise: Promise<Result<unknown, StorageError>> | null = null;

  constructor(db?: SqlDatabase, tableName: string = 'kv_store') {
    this.db = db ?? new RnSqliteDatabase('vitro.db');
    this.tableName = tableName;
  }

  private async ensureInitialized(): Promise<Result<void, StorageError>> {
    if (!this.initPromise) {
      this.initPromise = this.db.execute(
        `CREATE TABLE IF NOT EXISTS ${this.tableName} (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
      );
    }
    const initRes = await this.initPromise;
    if (!initRes.ok) {
      this.initPromise = null;
      return err(initRes.error);
    }
    return ok(undefined);
  }

  async get<T = string>(key: string): Promise<Result<T | null, StorageError>> {
    const initRes = await this.ensureInitialized();
    if (!initRes.ok) return err(initRes.error);

    const res = await this.db.query<{ value: string }>(
      `SELECT value FROM ${this.tableName} WHERE key = ?;`,
      [key],
    );
    if (!res.ok) return err(res.error);
    if (!res.value || res.value.length === 0) return ok(null);

    const raw = res.value[0].value;
    try {
      return ok(JSON.parse(raw) as T);
    } catch {
      return ok(raw as unknown as T);
    }
  }

  async set<T = string>(key: string, value: T): Promise<Result<void, StorageError>> {
    const initRes = await this.ensureInitialized();
    if (!initRes.ok) return err(initRes.error);

    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    const res = await this.db.execute(
      `INSERT OR REPLACE INTO ${this.tableName} (key, value) VALUES (?, ?);`,
      [key, serialized],
    );
    if (!res.ok) return err(res.error);
    return ok(undefined);
  }

  async delete(key: string): Promise<Result<void, StorageError>> {
    const initRes = await this.ensureInitialized();
    if (!initRes.ok) return err(initRes.error);

    const res = await this.db.execute(
      `DELETE FROM ${this.tableName} WHERE key = ?;`,
      [key],
    );
    if (!res.ok) return err(res.error);
    return ok(undefined);
  }

  async clear(): Promise<Result<void, StorageError>> {
    const initRes = await this.ensureInitialized();
    if (!initRes.ok) return err(initRes.error);

    const res = await this.db.execute(`DELETE FROM ${this.tableName};`);
    if (!res.ok) return err(res.error);
    return ok(undefined);
  }

  async getAllKeys(): Promise<Result<string[], StorageError>> {
    const initRes = await this.ensureInitialized();
    if (!initRes.ok) return err(initRes.error);

    const res = await this.db.query<{ key: string }>(
      `SELECT key FROM ${this.tableName};`,
    );
    if (!res.ok) return err(res.error);
    return ok(res.value.map((row) => row.key));
  }
}
