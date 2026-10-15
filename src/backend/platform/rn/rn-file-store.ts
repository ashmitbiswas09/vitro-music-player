/**
 * React Native FileStore adapter using expo-file-system.
 * Provides sandboxed filesystem operations for cached tracks and offline storage.
 */

import { File, Directory, Paths } from 'expo-file-system';
import { ok, err, StorageError, type Result } from '@/backend/core';
import type { FileStore, FileMetadata, DownloadFileResult } from '../types';

export class RnFileStore implements FileStore {
  private resolveFile(path: string): File {
    if (path.startsWith('file://')) {
      return new File(path);
    }
    const clean = path.replace(/\\/g, '/').replace(/^\/+/, '');
    const segments = clean.split('/').filter(Boolean);
    return new File(Paths.document, ...segments);
  }

  private resolveDirectory(path: string): Directory {
    if (path.startsWith('file://')) {
      return new Directory(path);
    }
    const clean = path.replace(/\\/g, '/').replace(/^\/+/, '');
    const segments = clean.split('/').filter(Boolean);
    return new Directory(Paths.document, ...segments);
  }

  async read(path: string): Promise<Result<Uint8Array, StorageError>> {
    try {
      const file = this.resolveFile(path);
      if (!file.exists) {
        return err(new StorageError(`File not found: ${path}`, 'READ', path));
      }
      const bytes = await file.bytes();
      return ok(bytes);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      return err(new StorageError(`File read failed: ${message}`, 'READ', path));
    }
  }

  async readText(path: string): Promise<Result<string, StorageError>> {
    try {
      const file = this.resolveFile(path);
      if (!file.exists) {
        return err(new StorageError(`File not found: ${path}`, 'READ', path));
      }
      const text = await file.text();
      return ok(text);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      return err(new StorageError(`File readText failed: ${message}`, 'READ', path));
    }
  }

  async write(path: string, data: Uint8Array | string): Promise<Result<void, StorageError>> {
    try {
      const file = this.resolveFile(path);
      if (!file.exists) {
        file.create({ intermediates: true, overwrite: true });
      }
      file.write(data);
      return ok(undefined);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      return err(new StorageError(`File write failed: ${message}`, 'WRITE', path));
    }
  }

  async delete(path: string): Promise<Result<void, StorageError>> {
    try {
      const file = this.resolveFile(path);
      if (file.exists) {
        file.delete();
      }
      return ok(undefined);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      return err(new StorageError(`File delete failed: ${message}`, 'DELETE', path));
    }
  }

  async exists(path: string): Promise<Result<boolean, StorageError>> {
    try {
      const file = this.resolveFile(path);
      if (file.exists) {
        return ok(true);
      }
      const dir = this.resolveDirectory(path);
      return ok(dir.exists);
    } catch {
      return ok(false);
    }
  }

  async makeDir(path: string): Promise<Result<void, StorageError>> {
    try {
      const dir = this.resolveDirectory(path);
      dir.create({ idempotent: true });
      return ok(undefined);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      return err(new StorageError(`Directory creation failed: ${message}`, 'WRITE', path));
    }
  }

  async getMetadata(path: string): Promise<Result<FileMetadata, StorageError>> {
    try {
      const file = this.resolveFile(path);
      if (!file.exists) {
        return err(new StorageError(`File not found: ${path}`, 'READ', path));
      }
      const info = file.info();
      return ok({
        sizeBytes: info.size ?? 0,
        modifiedAt: info.modificationTime
          ? Math.round(info.modificationTime * 1000)
          : Date.now(),
        uri: file.uri,
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      return err(new StorageError(`File metadata lookup failed: ${message}`, 'READ', path));
    }
  }

  async downloadFile(
    url: string,
    destPath: string,
    headers?: Record<string, string>,
  ): Promise<Result<DownloadFileResult, StorageError>> {
    try {
      const file = this.resolveFile(destPath);
      const parent = file.parentDirectory;
      if (parent && !parent.exists) {
        parent.create({ idempotent: true });
      }

      const downloaded = await File.downloadFileAsync(url, file, {
        headers,
        idempotent: true,
      });

      const info = downloaded.info();
      return ok({
        sizeBytes: info.size ?? 0,
        uri: downloaded.uri,
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      return err(new StorageError(`File download failed: ${message}`, 'WRITE', destPath));
    }
  }
}
