/**
 * Streaming module types and interfaces.
 * StreamResolver port, pluggable strategies, and verification contracts.
 */

import type { AudioCodec, AudioStream, Clock, Logger, Result, StreamError } from '@/backend/core';
import type { HttpClient } from '@/backend/platform';
import type { VisitorDataManager } from '@/backend/innertube';
import type { AuthService } from '@/backend/auth';

export interface ResolveOptions {
  signal?: AbortSignal;
  visitorData?: string;
  forceFresh?: boolean;
}

export interface StreamVerificationOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  userAgent?: string;
  headers?: Record<string, string>;
}

export interface StreamVerificationResult {
  isPlayable: boolean;
  statusCode: number;
  contentType: string | null;
  contentRange: string | null;
  bytesReceived: number;
  timeToFirstByteMs: number;
  error?: string;
}

export interface FullVerificationOptions {
  signal?: AbortSignal;
  durationSeconds?: number;
  chunkSizeBytes?: number;
  paceDelayMs?: number;
  timeoutMs?: number;
}

export interface FullVerificationResult {
  isPlayable: boolean;
  totalBytesReceived: number;
  expectedBytes: number;
  durationSeconds: number;
  chunksCount: number;
  averageThroughputBytesPerSec: number;
  throughputKbps: number;
  throughputMbps: number;
  totalDurationMs: number;
  throttledOr403: boolean;
  statusCode?: number;
  error?: string;
  chunkDetails?: {
    chunkIndex: number;
    range: string;
    bytes: number;
    statusCode: number;
    latencyMs: number;
  }[];
}

export interface ResolvedStream {
  stream: AudioStream;
  strategyName: string;
  videoDetails?: {
    videoId?: string;
    title?: string;
    author?: string;
    lengthSeconds?: number;
  };
  rawFormat?: unknown;
  requestHeaders: Record<string, string>;
}

export interface StreamStrategy {
  readonly name: string;
  resolve(videoId: string, options?: ResolveOptions): Promise<Result<ResolvedStream, StreamError>>;
}

export interface StreamResolverOptions {
  httpClient: HttpClient;
  clock?: Clock;
  logger?: Logger;
  strategies?: StreamStrategy[];
  preferredCodecs?: AudioCodec[];
  minRequestDelayMs?: number;
  visitorDataManager?: VisitorDataManager;
  authService?: AuthService;
  /**
   * Whether to automatically fall back to AuthenticatedStreamStrategy when guest strategies fail.
   * Defaults to false because empirical emulator tests proved authenticated-visionos returns HTTP 400
   * (native context rejects web cookies) and authenticated-webremix is UNPLAYABLE without cipher/PoToken.
   */
  enableAuthFallback?: boolean;
}

export interface StreamResolver {
  resolve(videoId: string, options?: ResolveOptions): Promise<Result<ResolvedStream, StreamError>>;
  verify(streamUrl: string, options?: StreamVerificationOptions): Promise<StreamVerificationResult>;
  verifyFull(
    resolved: ResolvedStream,
    options?: FullVerificationOptions,
  ): Promise<FullVerificationResult>;
  resolveAndVerify(
    videoId: string,
    options?: ResolveOptions & { verifyFull?: boolean },
  ): Promise<
    Result<
      {
        resolved: ResolvedStream;
        verification: StreamVerificationResult;
        fullVerification?: FullVerificationResult;
      },
      StreamError
    >
  >;
  invalidateStream?(videoId: string): void;
}
