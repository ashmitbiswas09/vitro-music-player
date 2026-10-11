/**
 * React Native SecureStore adapter using expo-secure-store.
 * Provides encrypted hardware-backed keychain/keystore persistence.
 */

import * as SecureStore from 'expo-secure-store';
import { ok, err, StorageError, type Result } from '@/backend/core';
import type { SecureStore as SecureStorePort } from '../types';

export class RnSecureStore implements SecureStorePort {
  async get(key: string): Promise<Result<string | null, StorageError>> {
    try {
      const value = await SecureStore.getItemAsync(key);
      return ok(value);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      return err(new StorageError(`SecureStore read failed: ${message}`, 'READ', key));
    }
  }

  async set(key: string, value: string): Promise<Result<void, StorageError>> {
    try {
      await SecureStore.setItemAsync(key, value);
      return ok(undefined);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      return err(new StorageError(`SecureStore write failed: ${message}`, 'WRITE', key));
    }
  }

  async delete(key: string): Promise<Result<void, StorageError>> {
    try {
      await SecureStore.deleteItemAsync(key);
      return ok(undefined);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      return err(new StorageError(`SecureStore delete failed: ${message}`, 'DELETE', key));
    }
  }
}
