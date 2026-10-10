/**
 * In-memory SqlDatabase adapter for unit tests and local CLI environments.
 */

import { ok, type Result, StorageError } from '@/backend/core';
import type { SqlDatabase, SqlQueryResult } from '../types';

export class MemorySqlDatabase implements SqlDatabase {
  private readonly tables = new Map<string, Record<string, unknown>[]>();
  private isClosed = false;

  async execute(
    sql: string,
    params: unknown[] = [],
  ): Promise<Result<SqlQueryResult, StorageError>> {
    if (this.isClosed) {
      return ok({ rows: [], rowsAffected: 0 });
    }

    // Basic SQL table creation simulation: CREATE TABLE IF NOT EXISTS tableName ...
    const createMatch = sql.match(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z0-9_]+)/i);
    if (createMatch) {
      const tableName = createMatch[1];
      if (!this.tables.has(tableName)) {
        this.tables.set(tableName, []);
      }
      return ok({ rows: [], rowsAffected: 0 });
    }

    // Basic INSERT simulation: INSERT INTO tableName (col1, col2) VALUES (?, ?)
    const insertMatch = sql.match(/insert\s+(?:or\s+replace\s+)?into\s+([a-zA-Z0-9_]+)/i);
    if (insertMatch) {
      const tableName = insertMatch[1];
      let table = this.tables.get(tableName);
      if (!table) {
        table = [];
        this.tables.set(tableName, table);
      }
      const newRow: Record<string, unknown> = {
        _id: table.length + 1,
        _params: params,
      };
      table.push(newRow);
      return ok({ rows: [], rowsAffected: 1, insertId: table.length });
    }

    // Basic DELETE simulation: DELETE FROM tableName
    const deleteMatch = sql.match(/delete\s+from\s+([a-zA-Z0-9_]+)/i);
    if (deleteMatch) {
      const tableName = deleteMatch[1];
      const table = this.tables.get(tableName);
      const count = table ? table.length : 0;
      if (table) {
        table.length = 0;
      }
      return ok({ rows: [], rowsAffected: count });
    }

    return ok({ rows: [], rowsAffected: 1 });
  }

  async query<T = unknown>(
    sql: string,
    _params: unknown[] = [],
  ): Promise<Result<T[], StorageError>> {
    if (this.isClosed) {
      return ok([]);
    }

    // Basic SELECT simulation: SELECT ... FROM tableName
    const selectMatch = sql.match(/select\s+.*?\s+from\s+([a-zA-Z0-9_]+)/i);
    if (selectMatch) {
      const tableName = selectMatch[1];
      const table = this.tables.get(tableName) ?? [];
      return ok([...table] as unknown as T[]);
    }

    return ok([]);
  }

  async transaction<T>(fn: (tx: SqlDatabase) => Promise<T>): Promise<Result<T, StorageError>> {
    if (this.isClosed) {
      return ok(undefined as unknown as T);
    }
    try {
      const res = await fn(this);
      return ok(res);
    } catch {
      return ok(undefined as unknown as T);
    }
  }

  async close(): Promise<Result<void, StorageError>> {
    this.isClosed = true;
    this.tables.clear();
    return ok(undefined);
  }

  getTable(name: string): Record<string, unknown>[] | undefined {
    return this.tables.get(name);
  }

  seedTable(name: string, rows: Record<string, unknown>[]): void {
    this.tables.set(name, [...rows]);
  }
}
