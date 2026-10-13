/**
 * Chunked session storage for SecureStore.
 * SecureStore enforces a ~2048-byte limit per value on Android (SharedPreferences).
 * This store chunks serialized session payloads into <= 1500 byte slices across multiple keys.
 */

import { type Result, ok, err, AuthError } from '@/backend/core';
import type { SecureStore } from '@/backend/platform';
import { type AuthSession, AuthSessionSchema } from './types';

export const SESSION_CHUNK_SIZE = 1500;
export const KEY_CHUNK_COUNT = 'auth_session_chunk_count';
export const KEY_CHUNK_PREFIX = 'auth_session_chunk_';
export const KEY_LEGACY = 'auth_session';

export class SessionStore {
  private readonly secureStore: SecureStore;

  constructor(secureStore: SecureStore) {
    this.secureStore = secureStore;
  }

  /**
   * Saves an AuthSession by splitting the JSON string into chunks <= 1500 bytes.
   */
  async save(session: AuthSession): Promise<Result<void, AuthError>> {
    try {
      const json = JSON.stringify(session);
      const chunkCount = Math.ceil(json.length / SESSION_CHUNK_SIZE);

      // 1. Read existing chunk count to clean up any surplus chunks from a previously larger session
      const prevCountRes = await this.secureStore.get(KEY_CHUNK_COUNT);
      const prevCount = prevCountRes.ok && prevCountRes.value ? parseInt(prevCountRes.value, 10) : 0;

      // 2. Write each chunk
      for (let i = 0; i < chunkCount; i++) {
        const chunk = json.slice(i * SESSION_CHUNK_SIZE, (i + 1) * SESSION_CHUNK_SIZE);
        const setRes = await this.secureStore.set(`${KEY_CHUNK_PREFIX}${i}`, chunk);
        if (!setRes.ok) {
          return err(
            new AuthError(
              `Failed to write session chunk ${i} to SecureStore: ${setRes.error.message}`,
              'STORAGE_ERROR',
              undefined,
              setRes.error,
            ),
          );
        }
      }

      // 3. Write total chunk count
      const countRes = await this.secureStore.set(KEY_CHUNK_COUNT, String(chunkCount));
      if (!countRes.ok) {
        return err(
          new AuthError(
            `Failed to write session chunk count to SecureStore: ${countRes.error.message}`,
            'STORAGE_ERROR',
            undefined,
            countRes.error,
          ),
        );
      }

      // 4. Clean up any excess chunks from previous session
      if (prevCount > chunkCount) {
        for (let i = chunkCount; i < prevCount; i++) {
          await this.secureStore.delete(`${KEY_CHUNK_PREFIX}${i}`);
        }
      }

      // Clean up legacy key if it existed
      await this.secureStore.delete(KEY_LEGACY);

      return ok(undefined);
    } catch (caught) {
      return err(
        new AuthError(
          `Unexpected error saving session: ${caught instanceof Error ? caught.message : String(caught)}`,
          'STORAGE_ERROR',
          undefined,
          caught,
        ),
      );
    }
  }

  /**
   * Loads and reassembles the chunked AuthSession from SecureStore.
   */
  async load(): Promise<Result<AuthSession | null, AuthError>> {
    try {
      const countRes = await this.secureStore.get(KEY_CHUNK_COUNT);
      if (!countRes.ok) {
        return err(
          new AuthError(
            `Failed to read chunk count from SecureStore: ${countRes.error.message}`,
            'STORAGE_ERROR',
            undefined,
            countRes.error,
          ),
        );
      }

      // If chunk count key is missing, check for legacy unchunked key
      if (!countRes.value) {
        const legacyRes = await this.secureStore.get(KEY_LEGACY);
        if (!legacyRes.ok || !legacyRes.value) {
          return ok(null);
        }
        return this.parseAndValidate(legacyRes.value);
      }

      const chunkCount = parseInt(countRes.value, 10);
      if (Number.isNaN(chunkCount) || chunkCount <= 0) {
        return ok(null);
      }

      let combined = '';
      for (let i = 0; i < chunkCount; i++) {
        const chunkRes = await this.secureStore.get(`${KEY_CHUNK_PREFIX}${i}`);
        if (!chunkRes.ok || chunkRes.value === null) {
          return err(
            new AuthError(
              `Session chunk ${i} is missing or corrupt in SecureStore`,
              'STORAGE_ERROR',
            ),
          );
        }
        combined += chunkRes.value;
      }

      return this.parseAndValidate(combined);
    } catch (caught) {
      return err(
        new AuthError(
          `Unexpected error loading session: ${caught instanceof Error ? caught.message : String(caught)}`,
          'STORAGE_ERROR',
          undefined,
          caught,
        ),
      );
    }
  }

  /**
   * Deletes all session chunks and the chunk count key from SecureStore.
   */
  async clear(): Promise<Result<void, AuthError>> {
    try {
      const countRes = await this.secureStore.get(KEY_CHUNK_COUNT);
      const count = countRes.ok && countRes.value ? parseInt(countRes.value, 10) : 10;
      const chunksToDelete = Math.max(count || 10, 10);

      for (let i = 0; i < chunksToDelete; i++) {
        await this.secureStore.delete(`${KEY_CHUNK_PREFIX}${i}`);
      }

      await this.secureStore.delete(KEY_CHUNK_COUNT);
      await this.secureStore.delete(KEY_LEGACY);

      return ok(undefined);
    } catch (caught) {
      return err(
        new AuthError(
          `Unexpected error clearing session: ${caught instanceof Error ? caught.message : String(caught)}`,
          'STORAGE_ERROR',
          undefined,
          caught,
        ),
      );
    }
  }

  private parseAndValidate(jsonStr: string): Result<AuthSession, AuthError> {
    try {
      const parsed = JSON.parse(jsonStr);
      const validated = AuthSessionSchema.safeParse(parsed);
      if (!validated.success) {
        return err(
          new AuthError(
            `Stored session validation failed: ${validated.error.message}`,
            'STORAGE_ERROR',
            { issues: validated.error.issues },
          ),
        );
      }
      return ok(validated.data);
    } catch (caught) {
      return err(
        new AuthError(
          `Failed to parse stored session JSON: ${caught instanceof Error ? caught.message : String(caught)}`,
          'STORAGE_ERROR',
          undefined,
          caught,
        ),
      );
    }
  }
}
