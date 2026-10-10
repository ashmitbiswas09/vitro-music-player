/**
 * In-memory SecureStore adapter for tests and local CLI environments.
 */

import { ok, type Result, StorageError } from '@/backend/core';
import type { SecureStore } from '../types';

export class MemorySecureStore implements SecureStore {
  private readonly storage = new Map<string, string>();

  async get(key: string): Promise<Result<string | null, StorageError>> {
    const value = this.storage.get(key) ?? null;
    return ok(value);
  }

  async set(key: string, value: string): Promise<Result<void, StorageError>> {
    this.storage.set(key, value);
    return ok(undefined);
  }

  async delete(key: string): Promise<Result<void, StorageError>> {
    this.storage.delete(key);
    return ok(undefined);
  }

  clear(): void {
    this.storage.clear();
  }

  size(): number {
    return this.storage.size;
  }
}
