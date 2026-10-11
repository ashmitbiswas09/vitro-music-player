/**
 * Node CLI for terminal testing and exploration of the backend without an emulator.
 * Run with tsx: npm run cli -- <command> [args]
 */

import fs from 'node:fs';
import path from 'node:path';
import { FetchHttpClient } from '@/backend/platform';
import { InnertubeClient, type SearchFilter } from '@/backend/innertube';
import { redactValue, redactString } from '@/backend/core';
import {
  DefaultStreamResolver,
  type StreamVerificationResult,
  type ResolvedStream,
} from '@/backend/streaming';

const coldStartBegin = performance.now();

interface CliTiming {
  coldStartTimeMs: number;
  commandExecutionMs?: number;
  parseTimeMs?: number;
  responseSizeBytes?: number;
  totalTimeMs: number;
}

function printUsage(): void {
  console.log(`
Vitro Music Player - Backend CLI
=================================
Usage:
  npm run cli -- <command> [options]
  npx tsx scripts/cli.ts <command> [options]

Commands:
  search <query> [--filter <filter>] [--record]
                      Search YouTube Music. Optional filters: songs, albums, artists, playlists, videos.
                      Pass --record to save real response fixture to fixtures/recorded and fixtures/sanitized.
  resolve <videoId> [--verify] [--record]
                      Resolve best audio stream URL and format (highest bitrate Opus/AAC).
                      Pass --verify to make a small ranged request (bytes 0-1023) to verify playability.
                      Pass --record to save real response fixture to fixtures/recorded and fixtures/sanitized.
  home                Fetch personalized or browse home feed (connected in Phase 2 browse)
  help, --help, -h    Show this help menu

Examples:
  npm run cli -- search "Radiohead Creep"
  npm run cli -- search "Radiohead" --filter songs --record
  npm run cli -- resolve "dQw4w9WgXcQ" --verify
  npm run cli -- resolve "9RfVp-GhKfs" --verify --record
  npm run cli -- home
`);
}

function sanitizeFixtureData(data: unknown): unknown {
  const sanitized = redactValue(data) as Record<string, unknown>;
  if (sanitized && typeof sanitized === 'object' && sanitized.responseContext) {
    const rc = sanitized.responseContext as Record<string, unknown>;
    if (rc.visitorData) {
      rc.visitorData = '[REDACTED]';
    }
  }
  return sanitized;
}

async function handleSearch(
  query: string,
  filter: SearchFilter,
  shouldRecord: boolean,
): Promise<CliTiming> {
  const searchStart = performance.now();
  console.log(`[CLI] Searching for: "${query}" (filter: ${filter})...`);

  const httpClient = new FetchHttpClient();
  const client = new InnertubeClient({ httpClient });

  // 1. Fetch search response
  const rawRes = await client.getRawSearch(query, { filter });
  const fetchLatencyMs = performance.now() - searchStart;

  if (!rawRes.ok) {
    console.error(`[CLI Error] Search failed: ${rawRes.error.message}`);
    process.exitCode = 1;
    return {
      coldStartTimeMs: 0,
      totalTimeMs: performance.now() - searchStart,
    };
  }

  // 2. If --record requested, record and sanitize fixture
  const cleanQuery = query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .slice(0, 40);
  if (shouldRecord) {
    const fixturesDir = path.resolve(__dirname, '../fixtures');
    const recordedDir = path.join(fixturesDir, 'recorded');
    const sanitizedDir = path.join(fixturesDir, 'sanitized');

    fs.mkdirSync(recordedDir, { recursive: true });
    fs.mkdirSync(sanitizedDir, { recursive: true });

    const recordedPath = path.join(recordedDir, `search_${cleanQuery}.json`);
    const sanitizedPath = path.join(sanitizedDir, `search_${cleanQuery}.json`);

    fs.writeFileSync(recordedPath, JSON.stringify(rawRes.value, null, 2), 'utf-8');
    const sanitizedData = sanitizeFixtureData(rawRes.value);
    fs.writeFileSync(sanitizedPath, JSON.stringify(sanitizedData, null, 2), 'utf-8');

    console.log(`[Record] Raw response saved to: ${path.relative(process.cwd(), recordedPath)}`);
    console.log(
      `[Record] Sanitized fixture saved to: ${path.relative(process.cwd(), sanitizedPath)}`,
    );
  }

  // 3. Parse search items
  const parsedRes = await client.search(query, { filter });
  if (!parsedRes.ok) {
    console.error(`[CLI Error] Parser error: ${parsedRes.error.message}`);
    process.exitCode = 1;
    return {
      coldStartTimeMs: 0,
      totalTimeMs: performance.now() - searchStart,
    };
  }

  const { items, parseDurationMs, responseSizeBytes } = parsedRes.value;

  console.log(`[CLI] Found ${items.length} items:\n`);
  items.slice(0, 10).forEach((item, idx) => {
    switch (item.type) {
      case 'track': {
        const artists = item.track.artists.map((a) => a.name).join(', ') || 'Unknown Artist';
        const dur = item.track.durationSeconds
          ? ` (${Math.floor(item.track.durationSeconds / 60)}:${String(item.track.durationSeconds % 60).padStart(2, '0')})`
          : '';
        console.log(
          `  ${idx + 1}. [Track] ${item.track.title} - ${artists}${dur} [id: ${item.track.id}]`,
        );
        break;
      }
      case 'artist':
        console.log(`  ${idx + 1}. [Artist] ${item.artist.name} [id: ${item.artist.id}]`);
        break;
      case 'album': {
        const artists = item.album.artists.map((a) => a.name).join(', ') || '';
        console.log(
          `  ${idx + 1}. [Album] ${item.album.title}${artists ? ` by ${artists}` : ''} [id: ${item.album.id}]`,
        );
        break;
      }
      case 'playlist':
        console.log(`  ${idx + 1}. [Playlist] ${item.playlist.title} [id: ${item.playlist.id}]`);
        break;
    }
  });

  if (items.length > 10) {
    console.log(`  ... and ${items.length - 10} more items.`);
  }

  return {
    coldStartTimeMs: 0,
    commandExecutionMs: fetchLatencyMs,
    parseTimeMs: parseDurationMs,
    responseSizeBytes,
    totalTimeMs: performance.now() - searchStart,
  };
}

async function handleResolve(
  videoId: string | undefined,
  shouldVerify: boolean,
  shouldRecord: boolean,
): Promise<CliTiming> {
  if (!videoId) {
    console.error(
      'Error: videoId is required. Usage: npm run cli -- resolve <videoId> [--verify] [--record]',
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
  let executionLatencyMs = 0;

  if (shouldVerify) {
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
    `  Bitrate:          ${(stream.bitrate / 1000).toFixed(1)} kbps (${stream.bitrate} bps)`,
  );
  if (stream.sampleRate) {
    console.log(`  Sample Rate:      ${stream.sampleRate.toLocaleString()} Hz`);
  }
  if (stream.contentLength) {
    console.log(
      `  Content Length:   ${(stream.contentLength / (1024 * 1024)).toFixed(2)} MB (${stream.contentLength.toLocaleString()} bytes)`,
    );
  }
  console.log(
    `  Expires At:       ${new Date(stream.expiresAt).toISOString()} (in ~${ttlHours}h ${ttlMins}m)`,
  );
  if (stream.loudnessDb !== undefined) {
    console.log(`  Loudness:         ${stream.loudnessDb > 0 ? '+' : ''}${stream.loudnessDb} dB`);
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
    console.log(`  Bytes Received:   ${verification.bytesReceived} bytes`);
    console.log(`  TTFB Latency:     ${verification.timeToFirstByteMs.toFixed(2)} ms`);
    if (verification.error) {
      console.log(`  Error:            ${verification.error}`);
    }
  }

  // Handle --record
  if (shouldRecord && resolved.rawFormat) {
    const fixturesDir = path.resolve(__dirname, '../fixtures');
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

async function handleHome(): Promise<void> {
  const homeStart = performance.now();
  console.log('[CLI] Fetching Home feed...');
  console.log('[CLI] Status: NOT IMPLEMENTED YET (scheduled for Phase 2 - Innertube Browse).');
  console.log('[CLI] Result: No fake data returned.');
  const homeLatencyMs = performance.now() - homeStart;

  console.log(`[Perf] Home Feed Latency: ${homeLatencyMs.toFixed(2)} ms`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  const coldStartTimeMs = performance.now() - coldStartBegin;

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printUsage();
    console.log(`[Perf] Cold Start: ${coldStartTimeMs.toFixed(2)} ms\n`);
    return;
  }

  const cmdStart = performance.now();
  let timingDetails: Partial<CliTiming> = {};

  switch (command.toLowerCase()) {
    case 'search': {
      let query = '';
      let filter: SearchFilter = 'all';
      let shouldRecord = false;

      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--record') {
          shouldRecord = true;
        } else if (args[i] === '--filter' && i + 1 < args.length) {
          filter = args[i + 1] as SearchFilter;
          i++;
        } else if (!args[i].startsWith('--')) {
          query += (query ? ' ' : '') + args[i];
        }
      }

      if (!query.trim()) {
        console.error(
          'Error: Search query is required. Usage: npm run cli -- search <query> [--filter <filter>] [--record]',
        );
        process.exitCode = 1;
        return;
      }

      timingDetails = await handleSearch(query.trim(), filter, shouldRecord);
      break;
    }
    case 'resolve': {
      let videoId = '';
      let shouldVerify = false;
      let shouldRecord = false;

      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--verify') {
          shouldVerify = true;
        } else if (args[i] === '--record') {
          shouldRecord = true;
        } else if (!args[i].startsWith('--')) {
          videoId = args[i];
        }
      }

      timingDetails = await handleResolve(videoId, shouldVerify, shouldRecord);
      break;
    }
    case 'home':
      await handleHome();
      break;
    default:
      console.error(`Unknown command: "${command}"`);
      printUsage();
      process.exitCode = 1;
      return;
  }

  const cmdEnd = performance.now();

  console.log('\n---------------------------------');
  console.log(`[Perf] Cold Start Time:       ${coldStartTimeMs.toFixed(2)} ms`);
  if (timingDetails.commandExecutionMs !== undefined) {
    console.log(`[Perf] Network Latency:       ${timingDetails.commandExecutionMs.toFixed(2)} ms`);
  }
  if (timingDetails.parseTimeMs !== undefined) {
    console.log(`[Perf] Parse Time:            ${timingDetails.parseTimeMs.toFixed(2)} ms`);
  }
  if (timingDetails.responseSizeBytes !== undefined) {
    console.log(
      `[Perf] Response Size:         ${(timingDetails.responseSizeBytes / 1024).toFixed(2)} KB (${timingDetails.responseSizeBytes} bytes)`,
    );
  }
  console.log(`[Perf] Command Total Time:    ${(cmdEnd - cmdStart).toFixed(2)} ms`);
  console.log(`[Perf] Total Process Time:    ${(cmdEnd - coldStartBegin).toFixed(2)} ms`);
}

main().catch((err: unknown) => {
  console.error('Fatal CLI Error:', err);
  process.exit(1);
});
