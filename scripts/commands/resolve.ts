/**
 * CLI Resolve command handler.
 */

import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { FetchHttpClient } from '@/backend/platform';
import { redactString } from '@/backend/core';
import {
  DefaultStreamResolver,
  type StreamVerificationResult,
  type FullVerificationResult,
  type ResolvedStream,
} from '@/backend/streaming';
import type { CliTiming } from './types';
import { formatNumber, sanitizeFixtureData } from './helpers';

export async function handleResolve(
  videoId: string | undefined,
  shouldVerify: boolean,
  shouldVerifyFull: boolean,
  shouldRecord: boolean,
): Promise<CliTiming> {
  if (!videoId) {
    console.error(
      'Error: videoId is required. Usage: npm run cli -- resolve <videoId> [--verify] [--verify-full] [--record]',
    );
    process.exitCode = 1;
    return {
      coldStartTimeMs: 0,
      totalTimeMs: 0,
    };
  }

  const resolveStart = performance.now();
  console.log(`[CLI] Resolving audio stream for videoId: "${videoId}"...`);

  const httpClient = new FetchHttpClient();
  const resolver = new DefaultStreamResolver({ httpClient });

  let resolved: ResolvedStream;
  let verification: StreamVerificationResult | undefined;
  let fullVerification: FullVerificationResult | undefined;
  let executionLatencyMs = 0;

  if (shouldVerifyFull) {
    console.log(
      '[CLI] Mode: Resolve with Full 30s Sequential Playback Verification (--verify-full)',
    );
    const res = await resolver.resolveAndVerify(videoId, { verifyFull: true });
    executionLatencyMs = performance.now() - resolveStart;

    if (!res.ok) {
      console.error(
        `[CLI Error] Stream resolution/full verification failed: ${res.error.message}`,
      );
      if (res.error.details) {
        console.error('[CLI Error Details]:', JSON.stringify(res.error.details, null, 2));
      }
      process.exitCode = 1;
      return {
        coldStartTimeMs: 0,
        commandExecutionMs: executionLatencyMs,
        totalTimeMs: performance.now() - resolveStart,
      };
    }
    resolved = res.value.resolved;
    verification = res.value.verification;
    fullVerification = res.value.fullVerification;
  } else if (shouldVerify) {
    console.log('[CLI] Mode: Resolve with Range Verification (--verify)');
    const res = await resolver.resolveAndVerify(videoId);
    executionLatencyMs = performance.now() - resolveStart;

    if (!res.ok) {
      console.error(`[CLI Error] Stream resolution/verification failed: ${res.error.message}`);
      if (res.error.details) {
        console.error('[CLI Error Details]:', JSON.stringify(res.error.details, null, 2));
      }
      process.exitCode = 1;
      return {
        coldStartTimeMs: 0,
        commandExecutionMs: executionLatencyMs,
        totalTimeMs: performance.now() - resolveStart,
      };
    }
    resolved = res.value.resolved;
    verification = res.value.verification;
  } else {
    const res = await resolver.resolve(videoId);
    executionLatencyMs = performance.now() - resolveStart;

    if (!res.ok) {
      console.error(`[CLI Error] Stream resolution failed: ${res.error.message}`);
      if (res.error.details) {
        console.error('[CLI Error Details]:', JSON.stringify(res.error.details, null, 2));
      }
      process.exitCode = 1;
      return {
        coldStartTimeMs: 0,
        commandExecutionMs: executionLatencyMs,
        totalTimeMs: performance.now() - resolveStart,
      };
    }
    resolved = res.value;
  }

  const { stream, strategyName, videoDetails } = resolved;
  const nowMs = Date.now();
  const ttlMs = stream.expiresAt - nowMs;
  const ttlHours = Math.max(0, Math.floor(ttlMs / (1000 * 60 * 60)));
  const ttlMins = Math.max(0, Math.floor((ttlMs % (1000 * 60 * 60)) / (1000 * 60)));

  console.log(`\n========================================`);
  console.log(`Resolved Audio Stream:`);
  console.log(`========================================`);
  if (videoDetails?.title) {
    console.log(
      `  Title:            ${videoDetails.title}${videoDetails.author ? ` by ${videoDetails.author}` : ''}`,
    );
  }
  console.log(`  Strategy:         ${strategyName}`);
  console.log(`  Codec:            ${stream.codec.toUpperCase()} (${stream.mimeType})`);
  console.log(
    `  Bitrate:          ${(stream.bitrate / 1000).toFixed(1)} kbps (${formatNumber(stream.bitrate)} bps)`,
  );
  if (stream.sampleRate) {
    console.log(`  Sample Rate:      ${formatNumber(stream.sampleRate)} Hz`);
  }
  if (stream.contentLength) {
    console.log(
      `  Content Length:   ${(stream.contentLength / (1024 * 1024)).toFixed(2)} MB (${formatNumber(stream.contentLength)} bytes)`,
    );
  }
  console.log(
    `  Expires At:       ${new Date(stream.expiresAt).toISOString()} (in ~${ttlHours}h ${ttlMins}m)`,
  );
  if (stream.loudnessDb !== undefined) {
    console.log(`  Loudness:         ${stream.loudnessDb > 0 ? '+' : ''}${stream.loudnessDb} dB`);
  }
  if (resolved.requestHeaders) {
    console.log(`  Request Headers:  ${JSON.stringify(resolved.requestHeaders)}`);
  }
  console.log(`  Stream URL:       ${redactString(stream.url)}`);

  if (verification) {
    console.log(`\n========================================`);
    console.log(`Range Verification Check (bytes 0-1023):`);
    console.log(`========================================`);
    console.log(
      `  Playable:         ${verification.isPlayable ? 'YES (Verified Working)' : 'NO (Failed)'}`,
    );
    console.log(`  HTTP Status:      ${verification.statusCode}`);
    console.log(`  Content-Type:     ${verification.contentType ?? 'none'}`);
    console.log(`  Content-Range:    ${verification.contentRange ?? 'none'}`);
    console.log(`  Bytes Received:   ${formatNumber(verification.bytesReceived)} bytes`);
    console.log(`  TTFB Latency:     ${verification.timeToFirstByteMs.toFixed(2)} ms`);
    if (verification.error) {
      console.log(`  Error:            ${verification.error}`);
    }
  }

  if (fullVerification) {
    console.log(`\n========================================`);
    console.log(`Full Audio Stream Verification (30s):`);
    console.log(`========================================`);
    console.log(
      `  Playable:         ${fullVerification.isPlayable ? 'YES (Verified 30s Sequential Playback)' : 'NO (Failed)'}`,
    );
    console.log(
      `  Total Bytes:      ${formatNumber(fullVerification.totalBytesReceived)} bytes (${(fullVerification.totalBytesReceived / 1024).toFixed(2)} KB)`,
    );
    console.log(
      `  Expected Target:  ${formatNumber(fullVerification.expectedBytes)} bytes (~${fullVerification.durationSeconds}s audio)`,
    );
    console.log(
      `  Sequential Chunks:${fullVerification.chunksCount} chunks (chunk size: 64 KB, pace: 50 ms)`,
    );
    console.log(
      `  Avg Throughput:   ${formatNumber(Math.round(fullVerification.throughputKbps))} KB/s (${fullVerification.throughputMbps.toFixed(2)} Mbps)`,
    );
    console.log(
      `  Throttling / 403: ${fullVerification.throttledOr403 ? 'DETECTED: ' + fullVerification.error : 'None (Clean throughput)'}`,
    );
    console.log(`  Session Latency:  ${fullVerification.totalDurationMs.toFixed(2)} ms`);
    if (fullVerification.error) {
      console.log(`  Error Details:    ${fullVerification.error}`);
    }

    if (!fullVerification.isPlayable) {
      console.error(`\n[CLI Error] Stream failed full playback verification.`);
      process.exitCode = 1;
    }
  }

  // Handle --record
  if (shouldRecord && resolved.rawFormat) {
    const fixturesDir = path.resolve(__dirname, '../../fixtures');
    const recordedDir = path.join(fixturesDir, 'recorded');
    const sanitizedDir = path.join(fixturesDir, 'sanitized');

    fs.mkdirSync(recordedDir, { recursive: true });
    fs.mkdirSync(sanitizedDir, { recursive: true });

    const cleanId = videoId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const recordedPath = path.join(recordedDir, `resolve_${cleanId}.json`);
    const sanitizedPath = path.join(sanitizedDir, `resolve_${cleanId}.json`);

    const recordPayload = {
      videoId,
      strategy: strategyName,
      resolvedStream: stream,
      videoDetails,
      rawFormat: resolved.rawFormat,
    };

    fs.writeFileSync(recordedPath, JSON.stringify(recordPayload, null, 2), 'utf-8');

    const sanitizedPayload = sanitizeFixtureData(recordPayload);
    fs.writeFileSync(sanitizedPath, JSON.stringify(sanitizedPayload, null, 2), 'utf-8');

    console.log(
      `\n[Record] Raw resolved stream saved to: ${path.relative(process.cwd(), recordedPath)}`,
    );
    console.log(
      `[Record] Sanitized fixture saved to:    ${path.relative(process.cwd(), sanitizedPath)}`,
    );
  }

  return {
    coldStartTimeMs: 0,
    commandExecutionMs: executionLatencyMs,
    totalTimeMs: performance.now() - resolveStart,
  };
}
