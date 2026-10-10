/**
 * In-memory KeyValueStore adapter.
 */

import { ok, type Result, StorageError } from '@/backend/core';
import type { KeyValueStore } from '../types';

export class MemoryKeyValueStore implements KeyValueStore {
  private readonly storage = new Map<string, unknown>();

  async get<T = string>(key: string): Promise<Result<T | null, StorageError>> {
    if (!this.storage.has(key)) {
      return ok(null);
    }
    return ok(this.storage.get(key) as T);
  }

  async set<T = string>(key: string, value: T): Promise<Result<void, StorageError>> {
    this.storage.set(key, value);
    return ok(undefined);
  }

  async delete(key: string): Promise<Result<void, StorageError>> {
    this.storage.delete(key);
    return ok(undefined);
  }

  async clear(): Promise<Result<void, StorageError>> {
    this.storage.clear();
    return ok(undefined);
  }

  async getAllKeys(): Promise<Result<string[], StorageError>> {
    return ok(Array.from(this.storage.keys()));
  }

  size(): number {
    return this.storage.size;
  }
}
