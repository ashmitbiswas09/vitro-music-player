/**
 * Platform port interfaces.
 * Domain modules interact solely through these abstractions.
 */

import type { Result, NetworkError, StorageError, AppError } from '@/backend/core';

export type AudioEngineState =
  | 'IDLE'
  | 'LOADING'
  | 'BUFFERING'
  | 'PLAYING'
  | 'PAUSED'
  | 'ENDED'
  | 'ERROR';

export interface AudioTrackMetadata {
  id: string;
  title: string;
  artist: string;
  album?: string;
  durationSeconds?: number;
  artworkUrl?: string;
}

export interface AudioEngineError {
  message: string;
  statusCode?: number;
  code?: string;
  isNetworkOrAuthError?: boolean;
}

export interface AudioEngine {
  load(url: string, headers: Record<string, string>, metadata: AudioTrackMetadata): Promise<Result<void, AppError>>;
  play(): Promise<Result<void, AppError>>;
  pause(): Promise<Result<void, AppError>>;
  seekTo(positionMs: number): Promise<Result<void, AppError>>;
  setVolume(volume: number): Promise<Result<void, AppError>>;
  stop(): Promise<Result<void, AppError>>;

  getPosition(): Promise<number>;
  getDuration(): Promise<number>;
  getState(): AudioEngineState;

  // Subscriptions
  onStateChange(cb: (state: AudioEngineState) => void): () => void;
  onPositionChange(cb: (positionMs: number) => void): () => void;
  onTrackEnded(cb: () => void): () => void;
  onError(cb: (error: AudioEngineError) => void): () => void;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD';

export interface HttpRequestOptions {
  method?: HttpMethod;
  headers?: Record<string, string>;
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface HttpResponse<T = unknown> {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: T;
  durationMs: number;
}

export interface HttpClient {
  request<T = unknown>(
    url: string,
    options?: HttpRequestOptions,
  ): Promise<Result<HttpResponse<T>, NetworkError>>;
  get<T = unknown>(
    url: string,
    options?: Omit<HttpRequestOptions, 'method'>,
  ): Promise<Result<HttpResponse<T>, NetworkError>>;
  post<T = unknown>(
    url: string,
    body?: unknown,
    options?: Omit<HttpRequestOptions, 'method' | 'body'>,
  ): Promise<Result<HttpResponse<T>, NetworkError>>;
}

export interface SecureStore {
  get(key: string): Promise<Result<string | null, StorageError>>;
  set(key: string, value: string): Promise<Result<void, StorageError>>;
  delete(key: string): Promise<Result<void, StorageError>>;
}

export interface KeyValueStore {
  get<T = string>(key: string): Promise<Result<T | null, StorageError>>;
  set<T = string>(key: string, value: T): Promise<Result<void, StorageError>>;
  delete(key: string): Promise<Result<void, StorageError>>;
  clear(): Promise<Result<void, StorageError>>;
  getAllKeys(): Promise<Result<string[], StorageError>>;
}

export interface SqlQueryResult<T = unknown> {
  rows: T[];
  rowsAffected: number;
  insertId?: number;
}

export interface SqlDatabase {
  execute(sql: string, params?: unknown[]): Promise<Result<SqlQueryResult, StorageError>>;
  query<T = unknown>(sql: string, params?: unknown[]): Promise<Result<T[], StorageError>>;
  transaction<T>(fn: (tx: SqlDatabase) => Promise<T>): Promise<Result<T, StorageError>>;
  close(): Promise<Result<void, StorageError>>;
}

export interface FileMetadata {
  sizeBytes: number;
  modifiedAt: number;
  uri: string;
}

export interface DownloadFileResult {
  sizeBytes: number;
  uri: string;
}

export interface FileStore {
  read(path: string): Promise<Result<Uint8Array, StorageError>>;
  readText(path: string): Promise<Result<string, StorageError>>;
  write(path: string, data: Uint8Array | string): Promise<Result<void, StorageError>>;
  delete(path: string): Promise<Result<void, StorageError>>;
  exists(path: string): Promise<Result<boolean, StorageError>>;
  makeDir(path: string): Promise<Result<void, StorageError>>;
  getMetadata(path: string): Promise<Result<FileMetadata, StorageError>>;
  downloadFile(
    url: string,
    destPath: string,
    headers?: Record<string, string>,
  ): Promise<Result<DownloadFileResult, StorageError>>;
}

export interface Sha1Port {
  /** Computes the hex-encoded SHA-1 digest of the given input string */
  digestHex(data: string): Promise<string>;
}
