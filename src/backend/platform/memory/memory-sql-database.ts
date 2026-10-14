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

    // CREATE INDEX IF NOT EXISTS ...
    const indexMatch = sql.match(/create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?/i);
    if (indexMatch) {
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

    // DELETE simulation: DELETE FROM tableName [WHERE ...]
    const deleteMatch = sql.match(/delete\s+from\s+([a-zA-Z0-9_]+)(?:\s+where\s+(.+))?/i);
    if (deleteMatch) {
      const tableName = deleteMatch[1];
      const whereClause = deleteMatch[2];
      const table = this.tables.get(tableName);
      if (!table) {
        return ok({ rows: [], rowsAffected: 0 });
      }

      if (!whereClause) {
        const count = table.length;
        table.length = 0;
        return ok({ rows: [], rowsAffected: count });
      }

      const initialLen = table.length;
      const remaining = table.filter((row) => !this.evaluateWhere(row, whereClause, params));
      this.tables.set(tableName, remaining);
      return ok({ rows: [], rowsAffected: initialLen - remaining.length });
    }

    // UPDATE simulation: UPDATE tableName SET col1 = ?, col2 = ? [WHERE ...]
    const updateMatch = sql.match(/update\s+([a-zA-Z0-9_]+)\s+set\s+(.+?)(?:\s+where\s+(.+))?$/i);
    if (updateMatch) {
      const tableName = updateMatch[1];
      const setClause = updateMatch[2];
      const whereClause = updateMatch[3];
      const table = this.tables.get(tableName);
      if (!table) {
        return ok({ rows: [], rowsAffected: 0 });
      }

      // Parse assignments e.g. "status = ?, retry_count = ?"
      const assignments = setClause.split(',').map((a) => a.trim());
      let paramIndex = 0;
      const updates: { col: string; val: unknown }[] = [];
      for (const assignment of assignments) {
        const parts = assignment.split('=').map((p) => p.trim());
        if (parts.length === 2) {
          const col = parts[0];
          const valExpr = parts[1];
          if (valExpr === '?') {
            updates.push({ col, val: params[paramIndex++] });
          } else {
            updates.push({ col, val: valExpr.replace(/^['"]|['"]$/g, '') });
          }
        }
      }

      const whereParams = params.slice(paramIndex);
      let updatedCount = 0;
      for (const row of table) {
        if (!whereClause || this.evaluateWhere(row, whereClause, whereParams)) {
          for (const { col, val } of updates) {
            row[col] = val;
          }
          updatedCount++;
        }
      }

      return ok({ rows: [], rowsAffected: updatedCount });
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

    // SELECT COUNT(*) as count FROM tableName [WHERE ...] [ORDER BY ...]
    const countMatch = sql.match(
      /select\s+count\(\*\)\s+(?:as\s+count\s+)?from\s+([a-zA-Z0-9_]+)(?:\s+where\s+(.+?))?(?:\s+order\s+by\s+.+)?$/i,
    );
    if (countMatch) {
      const tableName = countMatch[1];
      const whereClause = countMatch[2];
      const table = this.tables.get(tableName) ?? [];
      const matching = whereClause
        ? table.filter((row) => this.evaluateWhere(row, whereClause, params))
        : table;
      return ok([{ count: matching.length }] as unknown as T[]);
    }

    // SELECT ... FROM tableName [WHERE ...] [ORDER BY ...]
    const selectMatch = sql.match(
      /select\s+.*?\s+from\s+([a-zA-Z0-9_]+)(?:\s+where\s+(.+?))?(?:\s+order\s+by\s+(.+))?$/i,
    );
    if (selectMatch) {
      const tableName = selectMatch[1];
      const whereClause = selectMatch[2];
      const orderClause = selectMatch[3];
      const table = this.tables.get(tableName) ?? [];
      let matching = whereClause
        ? table.filter((row) => this.evaluateWhere(row, whereClause, params))
        : [...table];

      if (orderClause) {
        const orderParts = orderClause.trim().split(/\s+/);
        const col = orderParts[0];
        const isDesc = orderParts[1]?.toLowerCase() === 'desc';
        matching.sort((a, b) => {
          const aVal = a[col] as number | string;
          const bVal = b[col] as number | string;
          if (aVal === bVal) return 0;
          if (aVal > bVal) return isDesc ? -1 : 1;
          return isDesc ? 1 : -1;
        });
      }

      return ok([...matching] as unknown as T[]);
    }

    return ok([]);
  }

  private evaluateWhere(
    row: Record<string, unknown>,
    whereClause: string,
    params: unknown[],
  ): boolean {
    let paramIdx = 0;
    const replaced = whereClause.replace(/\?/g, () => `__PARAM_${paramIdx++}__`);

    const orBranches = replaced.split(/\s+OR\s+/i);
    return orBranches.some((branch) => {
      const andConditions = branch.split(/\s+AND\s+/i);
      return andConditions.every((cond) => {
        const trimmed = cond.trim().replace(/^\(|\)$/g, '').trim();

        // col != val or col <> val
        const neMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s*(!=|<>)\s*(.+)$/i);
        if (neMatch) {
          const col = neMatch[1];
          const valToken = neMatch[3].trim();
          const targetVal = this.resolveValue(valToken, params);
          return row[col] !== targetVal;
        }

        // col <= val
        const lteMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s*<=\s*(.+)$/i);
        if (lteMatch) {
          const col = lteMatch[1];
          const valToken = lteMatch[2].trim();
          const targetVal = Number(this.resolveValue(valToken, params));
          return Number(row[col]) <= targetVal;
        }

        // col >= val
        const gteMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s*>=\s*(.+)$/i);
        if (gteMatch) {
          const col = gteMatch[1];
          const valToken = gteMatch[2].trim();
          const targetVal = Number(this.resolveValue(valToken, params));
          return Number(row[col]) >= targetVal;
        }

        // col < val
        const ltMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s*<\s*(.+)$/i);
        if (ltMatch) {
          const col = ltMatch[1];
          const valToken = ltMatch[2].trim();
          const targetVal = Number(this.resolveValue(valToken, params));
          return Number(row[col]) < targetVal;
        }

        // col > val
        const gtMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s*>\s*(.+)$/i);
        if (gtMatch) {
          const col = gtMatch[1];
          const valToken = gtMatch[2].trim();
          const targetVal = Number(this.resolveValue(valToken, params));
          return Number(row[col]) > targetVal;
        }

        // col LIKE val
        const likeMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s+LIKE\s+(.+)$/i);
        if (likeMatch) {
          const col = likeMatch[1];
          const valToken = likeMatch[2].trim();
          const pattern = String(this.resolveValue(valToken, params));
          const regexStr =
            '^' +
            pattern
              .replace(/[.+^${}()|[\]\\]/g, '\\$&')
              .replace(/%/g, '.*')
              .replace(/_/g, '.') +
            '$';
          const regex = new RegExp(regexStr, 'i');
          return regex.test(String(row[col] ?? ''));
        }

        // col = val
        const eqMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s*=\s*(.+)$/i);
        if (eqMatch) {
          const col = eqMatch[1];
          const valToken = eqMatch[2].trim();
          const targetVal = this.resolveValue(valToken, params);
          return row[col] === targetVal;
        }

        return true;
      });
    });
  }

  private resolveValue(token: string, params: unknown[]): unknown {
    const paramMatch = token.match(/^__PARAM_(\d+)__$/);
    if (paramMatch) {
      const idx = Number(paramMatch[1]);
      return params[idx];
    }
    if (
      (token.startsWith("'") && token.endsWith("'")) ||
      (token.startsWith('"') && token.endsWith('"'))
    ) {
      return token.slice(1, -1);
    }
    if (!isNaN(Number(token))) {
      return Number(token);
    }
    return token;
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
