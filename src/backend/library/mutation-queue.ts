/**
 * Persistent offline mutation queue backed by the SqlDatabase port.
 * Safely persists mutations across app restarts and network disruptions.
 */

import { ok, type Result, StorageError, createLogger, type Logger } from '@/backend/core';
import type { SqlDatabase } from '@/backend/platform';
import type {
  PendingMutation,
  MutationType,
  MutationStatus,
  LikeStatus,
} from './types';

export class MutationQueue {
  private isInitialized = false;
  private readonly logger: Logger;

  constructor(
    private readonly db: SqlDatabase,
    logger?: Logger,
  ) {
    this.logger = logger ?? createLogger({ prefix: 'MutationQueue' });
  }

  async init(): Promise<Result<void, StorageError>> {
    if (this.isInitialized) return ok(undefined);

    const resMutations = await this.db.execute(`
      CREATE TABLE IF NOT EXISTS pending_mutations (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        retry_count INTEGER NOT NULL,
        last_attempt_at INTEGER,
        status TEXT NOT NULL,
        error TEXT
      );
    `);
    if (!resMutations.ok) return resMutations;

    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS idx_pending_mutations_acc ON pending_mutations(account_id, status);
    `);

    const resLikes = await this.db.execute(`
      CREATE TABLE IF NOT EXISTS user_likes (
        account_id TEXT NOT NULL,
        video_id TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (account_id, video_id)
      );
    `);
    if (!resLikes.ok) return resLikes;

    this.isInitialized = true;
    return ok(undefined);
  }

  async enqueue(
    accountId: string,
    type: MutationType,
    payloadObj: Record<string, unknown>,
  ): Promise<Result<PendingMutation, StorageError>> {
    await this.init();

    const id = `mut_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const payload = JSON.stringify(payloadObj);
    const createdAt = Date.now();
    const retryCount = 0;
    const status: MutationStatus = 'PENDING';

    const res = await this.db.execute(
      `INSERT INTO pending_mutations (id, account_id, type, payload, created_at, retry_count, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, accountId, type, payload, createdAt, retryCount, status],
    );

    if (!res.ok) {
      return res;
    }

    const mutation: PendingMutation = {
      id,
      accountId,
      type,
      payload,
      createdAt,
      retryCount,
      status,
    };

    this.logger.debug(`Enqueued mutation: ${type} [${id}] for account ${accountId}`);
    return ok(mutation);
  }

  async getPending(accountId: string): Promise<Result<PendingMutation[], StorageError>> {
    await this.init();

    const res = await this.db.query<{
      id: string;
      account_id: string;
      type: string;
      payload: string;
      created_at: number;
      retry_count: number;
      last_attempt_at: number | null;
      status: string;
      error: string | null;
    }>(
      `SELECT * FROM pending_mutations WHERE account_id = ? AND status = ? ORDER BY created_at ASC`,
      [accountId, 'PENDING'],
    );

    if (!res.ok) {
      return res;
    }

    const mutations: PendingMutation[] = res.value.map((r) => ({
      id: r.id,
      accountId: r.account_id,
      type: r.type as MutationType,
      payload: r.payload,
      createdAt: r.created_at,
      retryCount: r.retry_count,
      lastAttemptAt: r.last_attempt_at ?? undefined,
      status: r.status as MutationStatus,
      error: r.error ?? undefined,
    }));

    return ok(mutations);
  }

  async markInFlight(id: string): Promise<void> {
    await this.init();
    await this.db.execute(
      `UPDATE pending_mutations SET status = ?, last_attempt_at = ? WHERE id = ?`,
      ['IN_FLIGHT', Date.now(), id],
    );
  }

  async revertToPending(id: string, currentRetryCount: number): Promise<void> {
    await this.init();
    await this.db.execute(
      `UPDATE pending_mutations SET status = ?, retry_count = ?, last_attempt_at = ? WHERE id = ?`,
      ['PENDING', currentRetryCount + 1, Date.now(), id],
    );
  }

  async markFailed(id: string, error: string, currentRetryCount: number): Promise<void> {
    await this.init();
    await this.db.execute(
      `UPDATE pending_mutations SET status = ?, error = ?, retry_count = ?, last_attempt_at = ? WHERE id = ?`,
      ['FAILED', error, currentRetryCount + 1, Date.now(), id],
    );
    this.logger.warn(`Mutation marked failed: [${id}] - ${error}`);
  }

  async remove(id: string): Promise<Result<void, StorageError>> {
    await this.init();
    const res = await this.db.execute(`DELETE FROM pending_mutations WHERE id = ?`, [id]);
    if (!res.ok) return res;
    return ok(undefined);
  }

  // --- Optimistic Likes Table Management ---

  async setOptimisticLike(
    accountId: string,
    videoId: string,
    status: LikeStatus,
  ): Promise<Result<void, StorageError>> {
    await this.init();

    // Use INSERT OR REPLACE simulation
    const res = await this.db.execute(
      `INSERT OR REPLACE INTO user_likes (account_id, video_id, status, updated_at) VALUES (?, ?, ?, ?)`,
      [accountId, videoId, status, Date.now()],
    );

    if (!res.ok) return res;
    return ok(undefined);
  }

  async getOptimisticLike(
    accountId: string,
    videoId: string,
  ): Promise<Result<LikeStatus | null, StorageError>> {
    await this.init();

    const res = await this.db.query<{ status: string }>(
      `SELECT status FROM user_likes WHERE account_id = ? AND video_id = ?`,
      [accountId, videoId],
    );

    if (!res.ok) return res;
    if (res.value.length === 0) return ok(null);
    return ok(res.value[0].status as LikeStatus);
  }

  async getAllOptimisticLikes(
    accountId: string,
  ): Promise<Result<Map<string, LikeStatus>, StorageError>> {
    await this.init();

    const res = await this.db.query<{ video_id: string; status: string }>(
      `SELECT video_id, status FROM user_likes WHERE account_id = ?`,
      [accountId],
    );

    if (!res.ok) return res;
    const map = new Map<string, LikeStatus>();
    for (const row of res.value) {
      map.set(row.video_id, row.status as LikeStatus);
    }
    return ok(map);
  }

  async removeOptimisticLike(
    accountId: string,
    videoId: string,
  ): Promise<Result<void, StorageError>> {
    await this.init();
    const res = await this.db.execute(
      `DELETE FROM user_likes WHERE account_id = ? AND video_id = ?`,
      [accountId, videoId],
    );
    if (!res.ok) return res;
    return ok(undefined);
  }

  async clearForAccount(accountId: string): Promise<Result<void, StorageError>> {
    await this.init();
    await this.db.execute(`DELETE FROM pending_mutations WHERE account_id = ?`, [accountId]);
    await this.db.execute(`DELETE FROM user_likes WHERE account_id = ?`, [accountId]);
    return ok(undefined);
  }
}
