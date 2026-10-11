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

    // Basic INSERT simulation: INSERT OR REPLACE INTO tableName (col1, col2) VALUES (?, ?)
    const insertMatch = sql.match(
      /insert\s+(?:or\s+replace\s+)?into\s+([a-zA-Z0-9_]+)\s*(?:\(([^)]+)\))?/i,
    );
    if (insertMatch) {
      const tableName = insertMatch[1];
      const columnNames = insertMatch[2]
        ? insertMatch[2].split(',').map((c) => c.trim())
        : [];
      let table = this.tables.get(tableName);
      if (!table) {
        table = [];
        this.tables.set(tableName, table);
      }
      const newRow: Record<string, unknown> = {
        _id: table.length + 1,
        _params: params,
      };
      if (columnNames.length > 0) {
        for (let i = 0; i < columnNames.length; i++) {
          newRow[columnNames[i]] = params[i];
        }
      }

      // Check if primary key (key or id) exists in table to replace
      const pkName = columnNames.includes('key')
        ? 'key'
        : columnNames.includes('id')
          ? 'id'
          : undefined;
      if (pkName && newRow[pkName] !== undefined) {
        const existingIdx = table.findIndex((r) => r[pkName] === newRow[pkName]);
        if (existingIdx !== -1) {
          table[existingIdx] = newRow;
          return ok({
            rows: [],
            rowsAffected: 1,
            insertId: (newRow._id as number) ?? existingIdx + 1,
          });
        }
      }

      table.push(newRow);
      return ok({ rows: [], rowsAffected: 1, insertId: table.length });
    }

    // DELETE FROM tableName WHERE col = ?
    const deleteWhereMatch = sql.match(
      /delete\s+from\s+([a-zA-Z0-9_]+)\s+where\s+([a-zA-Z0-9_]+)\s*=\s*\?/i,
    );
    if (deleteWhereMatch) {
      const tableName = deleteWhereMatch[1];
      const colName = deleteWhereMatch[2];
      const table = this.tables.get(tableName);
      if (table) {
        const initialLen = table.length;
        const filtered = table.filter((r) => r[colName] !== params[0]);
        this.tables.set(tableName, filtered);
        return ok({ rows: [], rowsAffected: initialLen - filtered.length });
      }
      return ok({ rows: [], rowsAffected: 0 });
    }

    // DELETE FROM tableName WHERE col < ?
    const deleteLtMatch = sql.match(
      /delete\s+from\s+([a-zA-Z0-9_]+)\s+where\s+([a-zA-Z0-9_]+)\s*<\s*\?/i,
    );
    if (deleteLtMatch) {
      const tableName = deleteLtMatch[1];
      const colName = deleteLtMatch[2];
      const table = this.tables.get(tableName);
      if (table) {
        const initialLen = table.length;
        const filtered = table.filter(
          (r) => Number(r[colName]) >= Number(params[0]),
        );
        this.tables.set(tableName, filtered);
        return ok({ rows: [], rowsAffected: initialLen - filtered.length });
      }
      return ok({ rows: [], rowsAffected: 0 });
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
    params: unknown[] = [],
  ): Promise<Result<T[], StorageError>> {
    if (this.isClosed) {
      return ok([]);
    }

    // SELECT COUNT(*) as count FROM tableName
    const countMatch = sql.match(
      /select\s+count\(\*\)\s+(?:as\s+count\s+)?from\s+([a-zA-Z0-9_]+)/i,
    );
    if (countMatch) {
      const tableName = countMatch[1];
      const table = this.tables.get(tableName) ?? [];
      return ok([{ count: table.length }] as unknown as T[]);
    }

    // SELECT ... FROM tableName WHERE col = ?
    const selectWhereMatch = sql.match(
      /select\s+.*?\s+from\s+([a-zA-Z0-9_]+)\s+where\s+([a-zA-Z0-9_]+)\s*=\s*\?/i,
    );
    if (selectWhereMatch) {
      const tableName = selectWhereMatch[1];
      const colName = selectWhereMatch[2];
      const table = this.tables.get(tableName) ?? [];
      const matching = table.filter((r) => r[colName] === params[0]);
      return ok([...matching] as unknown as T[]);
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
