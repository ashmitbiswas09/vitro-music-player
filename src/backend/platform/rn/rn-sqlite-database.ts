/**
 * React Native SqlDatabase adapter using expo-sqlite.
 * Provides high-performance local SQLite storage for caching, playlists, and metadata.
 */

import * as SQLite from 'expo-sqlite';
import { ok, err, StorageError, type Result } from '@/backend/core';
import type { SqlDatabase, SqlQueryResult } from '../types';

export class RnSqliteDatabase implements SqlDatabase {
  private readonly dbName: string;
  private dbInstance: SQLite.SQLiteDatabase | null = null;
  private dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

  constructor(database: SQLite.SQLiteDatabase | string = 'vitro.db') {
    if (typeof database === 'string') {
      this.dbName = database;
    } else {
      this.dbInstance = database;
      this.dbName = database.databasePath;
    }
  }

  private async getDb(): Promise<SQLite.SQLiteDatabase> {
    if (this.dbInstance) {
      return this.dbInstance;
    }
    if (!this.dbPromise) {
      this.dbPromise = SQLite.openDatabaseAsync(this.dbName).then((db) => {
        this.dbInstance = db;
        return db;
      });
    }
    return this.dbPromise;
  }

  async execute(
    sql: string,
    params: unknown[] = [],
  ): Promise<Result<SqlQueryResult, StorageError>> {
    try {
      const db = await this.getDb();
      const res = await db.runAsync(sql, ...(params as SQLite.SQLiteVariadicBindParams));
      return ok({
        rows: [],
        rowsAffected: res.changes,
        insertId: res.lastInsertRowId,
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      return err(new StorageError(`SQLite execute failed: ${message}`, 'WRITE'));
    }
  }

  async query<T = unknown>(
    sql: string,
    params: unknown[] = [],
  ): Promise<Result<T[], StorageError>> {
    try {
      const db = await this.getDb();
      const rows = await db.getAllAsync<T>(sql, ...(params as SQLite.SQLiteVariadicBindParams));
      return ok(rows);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      return err(new StorageError(`SQLite query failed: ${message}`, 'READ'));
    }
  }

  async transaction<T>(fn: (tx: SqlDatabase) => Promise<T>): Promise<Result<T, StorageError>> {
    try {
      const db = await this.getDb();
      let result: T;
      await db.withExclusiveTransactionAsync(async () => {
        result = await fn(this);
      });
      return ok(result!);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      return err(new StorageError(`SQLite transaction failed: ${message}`, 'WRITE'));
    }
  }

  async close(): Promise<Result<void, StorageError>> {
    try {
      if (this.dbInstance) {
        await this.dbInstance.closeAsync();
        this.dbInstance = null;
        this.dbPromise = null;
      }
      return ok(undefined);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      return err(new StorageError(`SQLite close failed: ${message}`, 'DELETE'));
    }
  }
}
