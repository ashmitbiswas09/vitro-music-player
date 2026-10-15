/**
 * Node.js filesystem adapter for CLI and desktop execution.
 * Backed by native disk operations and streaming binary downloads.
 * Uses dynamic require to maintain React Native Metro bundler compatibility.
 */

import { ok, err, StorageError, type Result } from '@/backend/core';
import type { FileStore, FileMetadata, DownloadFileResult } from '../types';

interface NodeFs {
  readFileSync(path: string): Buffer;
  readFileSync(path: string, encoding: string): string;
  writeFileSync(path: string, data: Uint8Array | string): void;
  unlinkSync(path: string): void;
  existsSync(path: string): boolean;
  mkdirSync(path: string, options?: { recursive?: boolean }): void;
  statSync(path: string): { size: number; mtimeMs: number };
}

interface NodePath {
  resolve(...paths: string[]): string;
  dirname(path: string): string;
}

function getNodeFs(): NodeFs | null {
  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      const proc = process as unknown as { getBuiltinModule?: (m: string) => NodeFs };
      if (typeof proc.getBuiltinModule === 'function') {
        return proc.getBuiltinModule('node:fs');
      }
      return Function('try { return require("node:fs"); } catch { return null; }')() as NodeFs;
    } catch {
      return null;
    }
  }
  return null;
}

function getNodePath(): NodePath | null {
  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      const proc = process as unknown as { getBuiltinModule?: (m: string) => NodePath };
      if (typeof proc.getBuiltinModule === 'function') {
        return proc.getBuiltinModule('node:path');
      }
      return Function('try { return require("node:path"); } catch { return null; }')() as NodePath;
    } catch {
      return null;
    }
  }
  return null;
}

export class NodeFileStore implements FileStore {
  private readonly baseDir: string;
  private readonly fs: NodeFs;
  private readonly pathHelper: NodePath;

  constructor(baseDir?: string) {
    const fsInstance = getNodeFs();
    const pathInstance = getNodePath();
    if (!fsInstance || !pathInstance) {
      throw new Error('NodeFileStore is only supported in Node.js environments');
    }
    this.fs = fsInstance;
    this.pathHelper = pathInstance;
    this.baseDir = baseDir
      ? this.pathHelper.resolve(baseDir)
      : this.pathHelper.resolve(process.cwd(), '.vitro-data');

    if (!this.fs.existsSync(this.baseDir)) {
      this.fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private resolvePath(relOrAbs: string): string {
    if (relOrAbs.startsWith('file://')) {
      return relOrAbs.replace(/^file:\/\//, '');
    }
    const clean = relOrAbs.replace(/\\/g, '/').replace(/^\/+/, '');
    return this.pathHelper.resolve(this.baseDir, clean);
  }

  async read(path: string): Promise<Result<Uint8Array, StorageError>> {
    try {
      const full = this.resolvePath(path);
      if (!this.fs.existsSync(full)) {
        return err(new StorageError(`File not found: ${path}`, 'READ', path));
      }
      const buf = this.fs.readFileSync(full);
      return ok(new Uint8Array(buf));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      return err(new StorageError(`Failed to read file: ${message}`, 'READ', path));
    }
  }

  async readText(path: string): Promise<Result<string, StorageError>> {
    try {
      const full = this.resolvePath(path);
      if (!this.fs.existsSync(full)) {
        return err(new StorageError(`File not found: ${path}`, 'READ', path));
      }
      const text = this.fs.readFileSync(full, 'utf8');
      return ok(text);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      return err(new StorageError(`Failed to read text file: ${message}`, 'READ', path));
    }
  }

  async write(path: string, data: Uint8Array | string): Promise<Result<void, StorageError>> {
    try {
      const full = this.resolvePath(path);
      const parent = this.pathHelper.dirname(full);
      if (!this.fs.existsSync(parent)) {
        this.fs.mkdirSync(parent, { recursive: true });
      }
      this.fs.writeFileSync(full, data);
      return ok(undefined);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      return err(new StorageError(`Failed to write file: ${message}`, 'WRITE', path));
    }
  }

  async delete(path: string): Promise<Result<void, StorageError>> {
    try {
      const full = this.resolvePath(path);
      if (this.fs.existsSync(full)) {
        this.fs.unlinkSync(full);
      }
      return ok(undefined);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      return err(new StorageError(`Failed to delete file: ${message}`, 'DELETE', path));
    }
  }

  async exists(path: string): Promise<Result<boolean, StorageError>> {
    try {
      const full = this.resolvePath(path);
      return ok(this.fs.existsSync(full));
    } catch {
      return ok(false);
    }
  }

  async makeDir(path: string): Promise<Result<void, StorageError>> {
    try {
      const full = this.resolvePath(path);
      if (!this.fs.existsSync(full)) {
        this.fs.mkdirSync(full, { recursive: true });
      }
      return ok(undefined);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      return err(new StorageError(`Failed to make directory: ${message}`, 'WRITE', path));
    }
  }

  async getMetadata(path: string): Promise<Result<FileMetadata, StorageError>> {
    try {
      const full = this.resolvePath(path);
      if (!this.fs.existsSync(full)) {
        return err(new StorageError(`File not found: ${path}`, 'READ', path));
      }
      const stat = this.fs.statSync(full);
      return ok({
        sizeBytes: stat.size,
        modifiedAt: Math.round(stat.mtimeMs),
        uri: `file://${full}`,
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      return err(new StorageError(`Failed to get metadata: ${message}`, 'READ', path));
    }
  }

  async downloadFile(
    url: string,
    destPath: string,
    headers?: Record<string, string>,
  ): Promise<Result<DownloadFileResult, StorageError>> {
    try {
      const full = this.resolvePath(destPath);
      const parent = this.pathHelper.dirname(full);
      if (!this.fs.existsSync(parent)) {
        this.fs.mkdirSync(parent, { recursive: true });
      }

      const res = await fetch(url, { headers });
      if (!res.ok) {
        return err(
          new StorageError(
            `Download failed with HTTP ${res.status} ${res.statusText}`,
            'WRITE',
            destPath,
          ),
        );
      }

      const arrayBuffer = await res.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      this.fs.writeFileSync(full, uint8);

      return ok({
        sizeBytes: uint8.byteLength,
        uri: `file://${full}`,
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      return err(new StorageError(`Download failed: ${message}`, 'WRITE', destPath));
    }
  }
}
