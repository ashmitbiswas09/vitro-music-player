/**
 * Typed domain errors for Vitro Music Player.
 * All errors extend AppError with structured error codes and optional cause/details.
 */

export type ErrorCode =
  | 'APP_ERROR'
  | 'NETWORK_ERROR'
  | 'PARSE_ERROR'
  | 'NOT_FOUND'
  | 'AUTH_ERROR'
  | 'STREAM_ERROR'
  | 'STORAGE_ERROR'
  | 'TIMEOUT_ERROR';

export interface AppErrorDetails {
  [key: string]: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: AppErrorDetails;
  readonly cause?: unknown;

  constructor(
    message: string,
    code: ErrorCode = 'APP_ERROR',
    details?: AppErrorDetails,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
    this.cause = cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NetworkError extends AppError {
  readonly statusCode?: number;
  readonly url?: string;
  readonly isOffline: boolean;

  constructor(
    message: string,
    options?: {
      statusCode?: number;
      url?: string;
      isOffline?: boolean;
      details?: AppErrorDetails;
      cause?: unknown;
    },
  ) {
    super(message, 'NETWORK_ERROR', options?.details, options?.cause);
    this.name = 'NetworkError';
    this.statusCode = options?.statusCode;
    this.url = options?.url;
    this.isOffline = options?.isOffline ?? false;
  }
}

export class ParseError extends AppError {
  readonly targetType: string;
  readonly parseDurationMs?: number;

  constructor(
    message: string,
    options: {
      targetType: string;
      parseDurationMs?: number;
      details?: AppErrorDetails;
      cause?: unknown;
    },
  ) {
    super(message, 'PARSE_ERROR', options.details, options.cause);
    this.name = 'ParseError';
    this.targetType = options.targetType;
    this.parseDurationMs = options.parseDurationMs;
  }
}

export class NotFoundError extends AppError {
  readonly resourceType: string;
  readonly resourceId?: string;

  constructor(resourceType: string, resourceId?: string, details?: AppErrorDetails) {
    super(
      `Resource ${resourceType}${resourceId ? ` with ID "${resourceId}"` : ''} not found`,
      'NOT_FOUND',
      details,
    );
    this.name = 'NotFoundError';
    this.resourceType = resourceType;
    this.resourceId = resourceId;
  }
}

export class AuthError extends AppError {
  readonly reason: 'EXPIRED' | 'UNAUTHORIZED' | 'INVALID_CREDENTIALS' | 'MISSING_SESSION';

  constructor(
    message: string,
    reason: 'EXPIRED' | 'UNAUTHORIZED' | 'INVALID_CREDENTIALS' | 'MISSING_SESSION',
    details?: AppErrorDetails,
    cause?: unknown,
  ) {
    super(message, 'AUTH_ERROR', details, cause);
    this.name = 'AuthError';
    this.reason = reason;
  }
}

export type StreamErrorReason =
  | 'UNPLAYABLE'
  | 'DECIPHER_FAILED'
  | 'EXPIRED'
  | 'NO_FORMATS'
  | 'HTTP_403'
  | 'ALL_STRATEGIES_FAILED'
  | 'LOGIN_REQUIRED'
  | 'UNAVAILABLE'
  | 'LIVE_STREAM'
  | 'PROCESSING'
  | 'NETWORK';

export class StreamError extends AppError {
  readonly videoId: string;
  readonly reason: StreamErrorReason;
  readonly recoverableWithAuth: boolean;

  constructor(
    message: string,
    videoId: string,
    reason: StreamErrorReason,
    details?: AppErrorDetails,
    cause?: unknown,
    recoverableWithAuth?: boolean,
  ) {
    super(message, 'STREAM_ERROR', details, cause);
    this.name = 'StreamError';
    this.videoId = videoId;
    this.reason = reason;
    this.recoverableWithAuth =
      recoverableWithAuth ??
      (reason === 'LOGIN_REQUIRED' ||
        details?.status === 'LOGIN_REQUIRED' ||
        Boolean(details?.reason && String(details.reason).toLowerCase().includes('sign in')) ||
        Boolean(details?.reason && String(details.reason).toLowerCase().includes('age')));
  }
}

export class StorageError extends AppError {
  readonly operation: 'READ' | 'WRITE' | 'DELETE' | 'QUERY' | 'EXECUTE' | 'TRANSACTION';
  readonly pathOrKey?: string;

  constructor(
    message: string,
    operation: 'READ' | 'WRITE' | 'DELETE' | 'QUERY' | 'EXECUTE' | 'TRANSACTION',
    pathOrKey?: string,
    details?: AppErrorDetails,
    cause?: unknown,
  ) {
    super(message, 'STORAGE_ERROR', details, cause);
    this.name = 'StorageError';
    this.operation = operation;
    this.pathOrKey = pathOrKey;
  }
}

export class TimeoutError extends AppError {
  readonly timeoutMs: number;
  readonly operation?: string;

  constructor(timeoutMs: number, operation?: string, details?: AppErrorDetails) {
    super(
      `Operation${operation ? ` "${operation}"` : ''} timed out after ${timeoutMs} ms`,
      'TIMEOUT_ERROR',
      details,
    );
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
    this.operation = operation;
  }
}
