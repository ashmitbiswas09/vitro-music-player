/**
 * In-memory FileStore adapter for unit testing and local development.
 */

import { ok, err, StorageError, type Result } from '@/backend/core';
import type { FileStore, FileMetadata, DownloadFileResult } from '../types';

interface StoredFile {
  data: Uint8Array;
  modifiedAt: number;
}

export class MemoryFileStore implements FileStore {
  private readonly files = new Map<string, StoredFile>();
  private readonly directories = new Set<string>();

  private normalize(path: string): string {
    return path.replace(/^memory:\/\//, '').replace(/\\/g, '/').replace(/^\/+/, '');
  }

  async read(path: string): Promise<Result<Uint8Array, StorageError>> {
    const key = this.normalize(path);
    const file = this.files.get(key);
    if (!file) {
      return err(new StorageError(`File not found: ${path}`, 'READ', path));
    }
    return ok(new Uint8Array(file.data));
  }

  async readText(path: string): Promise<Result<string, StorageError>> {
    const readRes = await this.read(path);
    if (!readRes.ok) {
      return readRes;
    }
    const text = new TextDecoder().decode(readRes.value);
    return ok(text);
  }

  async write(path: string, data: Uint8Array | string): Promise<Result<void, StorageError>> {
    const key = this.normalize(path);
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    this.files.set(key, {
      data: bytes,
      modifiedAt: Date.now(),
    });
    return ok(undefined);
  }

  async delete(path: string): Promise<Result<void, StorageError>> {
    const key = this.normalize(path);
    this.files.delete(key);
    return ok(undefined);
  }

  async exists(path: string): Promise<Result<boolean, StorageError>> {
    const key = this.normalize(path);
    const exists = this.files.has(key) || this.directories.has(key);
    return ok(exists);
  }

  async makeDir(path: string): Promise<Result<void, StorageError>> {
    const key = this.normalize(path);
    this.directories.add(key);
    return ok(undefined);
  }

  private readonly simulatedSizes = new Map<string, number>();
  private mockDownloadSize?: number;

  setMockDownloadSize(sizeBytes?: number): void {
    this.mockDownloadSize = sizeBytes;
  }

  async downloadFile(
    url: string,
    destPath: string,
    _headers?: Record<string, string>,
  ): Promise<Result<DownloadFileResult, StorageError>> {
    const key = this.normalize(destPath);
    const sizeBytes = this.mockDownloadSize ?? 3_670_016; // default ~3.5MB realistic audio stream
    const buffer = new Uint8Array(256);
    this.files.set(key, {
      data: buffer,
      modifiedAt: Date.now(),
    });
    this.simulatedSizes.set(key, sizeBytes);

    return ok({
      sizeBytes,
      uri: `memory://${key}`,
    });
  }

  async getMetadata(path: string): Promise<Result<FileMetadata, StorageError>> {
    const key = this.normalize(path);
    const file = this.files.get(key);
    if (!file) {
      return err(new StorageError(`File not found: ${path}`, 'READ', path));
    }
    const sizeBytes = this.simulatedSizes.get(key) ?? file.data.byteLength;
    return ok({
      sizeBytes,
      modifiedAt: file.modifiedAt,
      uri: `memory://${key}`,
    });
  }

  clear(): void {
    this.files.clear();
    this.directories.clear();
    this.simulatedSizes.clear();
  }

  fileCount(): number {
    return this.files.size;
  }
}
