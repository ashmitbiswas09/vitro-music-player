/**
 * Streaming module types and interfaces.
 * StreamResolver port, pluggable strategies, and verification contracts.
 */

import type { AudioCodec, AudioStream, Clock, Logger, Result, StreamError } from '@/backend/core';
import type { HttpClient } from '@/backend/platform';
import type { VisitorDataManager } from '@/backend/innertube';

export interface ResolveOptions {
  signal?: AbortSignal;
  visitorData?: string;
  forceFresh?: boolean;
}

export interface StreamVerificationOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  userAgent?: string;
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
}

export interface StreamResolver {
  resolve(videoId: string, options?: ResolveOptions): Promise<Result<ResolvedStream, StreamError>>;
  verify(streamUrl: string, options?: StreamVerificationOptions): Promise<StreamVerificationResult>;
  resolveAndVerify(
    videoId: string,
    options?: ResolveOptions,
  ): Promise<
    Result<{ resolved: ResolvedStream; verification: StreamVerificationResult }, StreamError>
  >;
}
