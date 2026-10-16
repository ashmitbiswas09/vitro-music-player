/**
 * DownloadManager orchestrating binary file downloads, SQLite persistence,
 * storage accounting, lyrics pre-caching, and offline file deletion.
 */

import {
  ok,
  err,
  type Result,
  type AppError,
  StorageError,
  createLogger,
  type Logger,
  type Track,
} from '@/backend/core';
import type { FileStore, SqlDatabase } from '@/backend/platform';
import type { StreamResolver } from '@/backend/streaming';
import type {
  DownloadedTrack,
  DownloadEvent,
  DownloadManagerOptions,
  LyricsPreCacher,
} from './types';

interface DownloadRow {
  video_id: string;
  track_json: string;
  file_path: string;
  size_bytes: number;
  mime_type: string;
  codec: string;
  bitrate: number;
  downloaded_at: number;
  status: string;
  error: string | null;
}

export class DownloadManager {
  private readonly fileStore: FileStore;
  private readonly db: SqlDatabase;
  private readonly streamResolver: StreamResolver;
  private readonly lyricsService?: LyricsPreCacher;
  private readonly logger: Logger;
  private readonly downloadsDir: string;
  private readonly listeners = new Set<(event: DownloadEvent) => void>();
  private isInitialized = false;

  constructor(options: DownloadManagerOptions) {
    this.fileStore = options.fileStore;
    this.db = options.sqlDatabase;
    this.streamResolver = options.streamResolver;
    this.lyricsService = options.lyricsService;
    this.logger = options.logger ?? createLogger({ prefix: 'DownloadManager' });
    this.downloadsDir = options.downloadsDir ?? 'downloads';
  }

  async init(): Promise<Result<void, StorageError>> {
    if (this.isInitialized) return ok(undefined);

    const res = await this.db.execute(`
      CREATE TABLE IF NOT EXISTS downloads (
        video_id TEXT PRIMARY KEY,
        track_json TEXT NOT NULL,
        file_path TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        mime_type TEXT NOT NULL,
        codec TEXT NOT NULL,
        bitrate INTEGER NOT NULL,
        downloaded_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        error TEXT
      );
    `);
    if (!res.ok) return res;

    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);
    `);

    // Ensure physical base directory exists
    try {
      await this.fileStore.makeDir(this.downloadsDir);
    } catch {
      // Ignored if directory creation is managed automatically by FileStore
    }

    // Reconcile interrupted downloads from a previous session
    const staleRes = await this.db.query<DownloadRow>(
      `SELECT * FROM downloads WHERE status = 'QUEUED' OR status = 'DOWNLOADING'`,
    );
    if (staleRes.ok && staleRes.value.length > 0) {
      this.logger.warn(
        `Found ${staleRes.value.length} interrupted download(s) from previous session. Reconciling to FAILED...`,
      );
      for (const row of staleRes.value) {
        if (row.file_path) {
          try {
            await this.fileStore.delete(row.file_path);
          } catch {
            // Ignore if file doesn't exist
          }
        }
      }
      await this.db.execute(
        `UPDATE downloads SET status = 'FAILED', error = 'Interrupted by app restart' WHERE status = 'QUEUED' OR status = 'DOWNLOADING'`,
      );
    }

    this.isInitialized = true;
    return ok(undefined);
  }

  /**
   * Enqueues and downloads a track to local binary storage.
   */
  async enqueueDownload(track: Track): Promise<Result<DownloadedTrack, AppError>> {
    await this.init();

    // Check if already completed and file still exists
    const existing = await this.getDownloadedTrack(track.id);
    if (existing) {
      const existsRes = await this.fileStore.exists(existing.filePath);
      if (existsRes.ok && existsRes.value) {
        this.logger.debug(`Track [${track.id}] is already downloaded`);
        return ok(existing);
      }
    }

    const now = Date.now();

    // 1. Mark as QUEUED
    await this.db.execute(
      `INSERT OR REPLACE INTO downloads (video_id, track_json, file_path, size_bytes, mime_type, codec, bitrate, downloaded_at, status, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [track.id, JSON.stringify(track), '', 0, '', '', 0, now, 'QUEUED', null],
    );
    this.emitEvent({ type: 'enqueued', videoId: track.id, track });

    // 2. Mark as DOWNLOADING
    await this.db.execute(
      `UPDATE downloads SET status = 'DOWNLOADING' WHERE video_id = ?`,
      [track.id],
    );
    this.emitEvent({ type: 'started', videoId: track.id });

    // 3. Resolve stream
    this.logger.info(`Resolving stream for download of [${track.id}] "${track.title}"...`);
    const streamRes = await this.streamResolver.resolve(track.id);
    if (!streamRes.ok) {
      const errMsg = `Failed to resolve stream: ${streamRes.error.message}`;
      await this.markFailed(track.id, errMsg);
      return err(streamRes.error);
    }
    const resolved = streamRes.value;
    const stream = resolved.stream;

    // 4. Download binary file directly to disk
    let ext = 'webm';
    if (stream.mimeType.includes('mp4') || stream.mimeType.includes('m4a')) {
      ext = 'm4a';
    } else if (stream.mimeType.includes('webm')) {
      ext = 'webm';
    }
    const destPath = `${this.downloadsDir}/${track.id}.${ext}`;

    const downloadHeaders: Record<string, string> = {
      ...resolved.requestHeaders,
    };

    // Bypass googlevideo.com real-time pacing throttle (~32.8 KB/s) by specifying explicit Range
    if (
      stream.url.includes('googlevideo.com') &&
      typeof stream.contentLength === 'number' &&
      Number.isFinite(stream.contentLength) &&
      stream.contentLength > 0 &&
      stream.contentLength < 50_000_000
    ) {
      downloadHeaders['Range'] = `bytes=0-${stream.contentLength - 1}`;
    }

    this.logger.info(
      `Downloading binary audio for [${track.id}] via ${resolved.strategyName} (${stream.codec}, ${Math.round(stream.bitrate / 1000)}kbps) to ${destPath}...`,
    );

    const dlRes = await this.fileStore.downloadFile(
      stream.url,
      destPath,
      downloadHeaders,
    );

    if (!dlRes.ok) {
      const errMsg = `Binary file download failed: ${dlRes.error.message}`;
      await this.markFailed(track.id, errMsg, destPath);
      return err(dlRes.error);
    }

    // 5. Best-effort pre-cache lyrics for offline playback
    if (this.lyricsService) {
      try {
        await this.lyricsService.getLyrics({
          videoId: track.id,
          trackTitle: track.title,
          artistName: track.artists.map((a) => a.name).join(', '),
          albumName: track.album?.title,
          durationSeconds: track.durationSeconds,
        });
        this.logger.debug(`Pre-cached lyrics for offline track: ${track.id}`);
      } catch (lErr) {
        this.logger.warn(`Best-effort lyrics pre-cache failed for ${track.id}`, {
          error: String(lErr),
        });
      }
    }

    // 6. Finalize as COMPLETED
    const downloadedTrack: DownloadedTrack = {
      videoId: track.id,
      track,
      filePath: dlRes.value.uri || destPath,
      sizeBytes: dlRes.value.sizeBytes,
      mimeType: stream.mimeType,
      codec: stream.codec,
      bitrate: stream.bitrate,
      downloadedAt: Date.now(),
    };

    await this.db.execute(
      `UPDATE downloads SET
         file_path = ?,
         size_bytes = ?,
         mime_type = ?,
         codec = ?,
         bitrate = ?,
         downloaded_at = ?,
         status = 'COMPLETED',
         error = NULL
       WHERE video_id = ?`,
      [
        downloadedTrack.filePath,
        downloadedTrack.sizeBytes,
        downloadedTrack.mimeType,
        downloadedTrack.codec,
        downloadedTrack.bitrate,
        downloadedTrack.downloadedAt,
        track.id,
      ],
    );

    this.logger.info(
      `Successfully completed download for [${track.id}] (${(downloadedTrack.sizeBytes / 1024 / 1024).toFixed(2)} MB)`,
    );

    this.emitEvent({
      type: 'completed',
      videoId: track.id,
      track: downloadedTrack,
    });

    return ok(downloadedTrack);
  }

  /**
   * Retrieves single completed downloaded track metadata, or null if not downloaded.
   */
  async getDownloadedTrack(videoId: string): Promise<DownloadedTrack | null> {
    await this.init();
    const rowsRes = await this.db.query<DownloadRow>(
      `SELECT * FROM downloads WHERE video_id = ? AND status = 'COMPLETED'`,
      [videoId],
    );
    if (!rowsRes.ok || rowsRes.value.length === 0) {
      return null;
    }
    return this.mapRow(rowsRes.value[0]);
  }

  /**
   * Lists all completed downloaded tracks ordered chronologically by download time.
   */
  async listDownloads(): Promise<DownloadedTrack[]> {
    await this.init();
    const rowsRes = await this.db.query<DownloadRow>(
      `SELECT * FROM downloads WHERE status = 'COMPLETED' ORDER BY downloaded_at DESC`,
    );
    if (!rowsRes.ok) return [];
    return rowsRes.value.map((r) => this.mapRow(r));
  }

  /**
   * Deletes physical binary file and removes record from SQLite.
   */
  async removeDownload(videoId: string): Promise<Result<void, AppError>> {
    await this.init();
    const existing = await this.getDownloadedTrack(videoId);
    if (existing) {
      try {
        await this.fileStore.delete(existing.filePath);
      } catch (caught) {
        this.logger.warn(`Failed to delete physical file: ${existing.filePath}`, {
          error: String(caught),
        });
      }
    }

    const delRes = await this.db.execute(`DELETE FROM downloads WHERE video_id = ?`, [videoId]);
    if (!delRes.ok) return delRes;

    this.emitEvent({ type: 'removed', videoId });
    this.logger.info(`Removed downloaded track [${videoId}]`);
    return ok(undefined);
  }

  /**
   * Clears all downloads, deleting all binary files and wiping the downloads table.
   */
  async clearAllDownloads(): Promise<Result<void, AppError>> {
    await this.init();
    const all = await this.listDownloads();
    for (const t of all) {
      try {
        await this.fileStore.delete(t.filePath);
      } catch (caught) {
        this.logger.warn(`Failed to delete file: ${t.filePath}`, { error: String(caught) });
      }
      this.emitEvent({ type: 'removed', videoId: t.videoId });
    }

    const res = await this.db.execute(`DELETE FROM downloads`);
    if (!res.ok) return res;

    this.logger.info(`Cleared all downloaded tracks`);
    return ok(undefined);
  }

  /**
   * Calculates total storage footprint consumed by completed downloads.
   */
  async getStorageUsageBytes(): Promise<number> {
    await this.init();
    const rowsRes = await this.db.query<{ total: number | null }>(
      `SELECT SUM(size_bytes) as total FROM downloads WHERE status = 'COMPLETED'`,
    );
    if (!rowsRes.ok || rowsRes.value.length === 0 || rowsRes.value[0].total == null) {
      return 0;
    }
    return Number(rowsRes.value[0].total);
  }

  /**
   * Subscribes to download lifecycle events.
   */
  onDownloadEvent(listener: (event: DownloadEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async markFailed(
    videoId: string,
    errorMsg: string,
    partialPath?: string,
  ): Promise<void> {
    this.logger.error(`Download failed for [${videoId}]: ${errorMsg}`);
    if (partialPath) {
      try {
        await this.fileStore.delete(partialPath);
      } catch {
        // Ignored
      }
    }

    await this.db.execute(
      `UPDATE downloads SET status = 'FAILED', error = ? WHERE video_id = ?`,
      [errorMsg, videoId],
    );

    this.emitEvent({ type: 'failed', videoId, error: errorMsg });
  }

  private emitEvent(event: DownloadEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (caught) {
        this.logger.error(`DownloadEvent listener threw error`, { error: String(caught) });
      }
    }
  }

  private mapRow(row: DownloadRow): DownloadedTrack {
    let track: Track;
    try {
      track = JSON.parse(row.track_json) as Track;
    } catch {
      track = {
        id: row.video_id,
        title: 'Unknown Track',
        artists: [],
        thumbnails: [],
      };
    }

    if (track.thumbnails.length === 0 && track.id) {
      track = {
        ...track,
        thumbnails: [{ url: `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg` }],
      };
    }

    return {
      videoId: row.video_id,
      track,
      filePath: row.file_path,
      sizeBytes: Number(row.size_bytes),
      mimeType: row.mime_type,
      codec: row.codec,
      bitrate: Number(row.bitrate),
      downloadedAt: Number(row.downloaded_at),
    };
  }
}
