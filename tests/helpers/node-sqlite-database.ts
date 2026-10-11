/**
 * Real SQLite adapter utilizing Node.js built-in `node:sqlite`.
 * Used for contract testing SqlDatabase and verifying real SQLite behavior against the in-memory fake.
 */

import { DatabaseSync } from 'node:sqlite';
import { ok, err, StorageError, type Result } from '@/backend/core';
import type { SqlDatabase, SqlQueryResult } from '@/backend/platform';

export class NodeSqliteDatabase implements SqlDatabase {
  private readonly db: DatabaseSync;
  private isClosed = false;

  constructor(location = ':memory:') {
    this.db = new DatabaseSync(location);
  }

  async execute(sql: string, params: unknown[] = []): Promise<Result<SqlQueryResult, StorageError>> {
    if (this.isClosed) {
      return err(new StorageError('Database is closed', 'EXECUTE'));
    }
    try {
      const trimmed = sql.trim();
      // Multi-statement DDL without params can run via exec
      if (params.length === 0 && (trimmed.includes(';') || trimmed.toUpperCase().startsWith('CREATE'))) {
        this.db.exec(sql);
        return ok({ rows: [], rowsAffected: 0 });
      }

      const stmt = this.db.prepare(sql);
      const res = stmt.run(...(params as (string | number | bigint | null | Uint8Array)[]));
      return ok({
        rows: [],
        rowsAffected: Number(res.changes),
        insertId: Number(res.lastInsertRowid),
      });
    } catch (e) {
      return err(new StorageError(`SQLite execute failed: ${String(e)}`, 'EXECUTE', undefined, undefined, e));
    }
  }

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<Result<T[], StorageError>> {
    if (this.isClosed) {
      return err(new StorageError('Database is closed', 'QUERY'));
    }
    try {
      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...(params as (string | number | bigint | null | Uint8Array)[]));
      return ok(rows as unknown as T[]);
    } catch (e) {
      return err(new StorageError(`SQLite query failed: ${String(e)}`, 'QUERY', undefined, undefined, e));
    }
  }

  async transaction<T>(fn: (tx: SqlDatabase) => Promise<T>): Promise<Result<T, StorageError>> {
    try {
      this.db.exec('BEGIN TRANSACTION');
      const res = await fn(this);
      this.db.exec('COMMIT');
      return ok(res);
    } catch (e) {
      this.db.exec('ROLLBACK');
      return err(new StorageError(`Transaction failed: ${String(e)}`, 'TRANSACTION', undefined, undefined, e));
    }
  }

  async close(): Promise<Result<void, StorageError>> {
    this.isClosed = true;
    this.db.close();
    return ok(undefined);
  }
}
