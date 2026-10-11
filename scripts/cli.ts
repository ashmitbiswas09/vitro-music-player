/**
 * Node CLI for terminal testing and exploration of the backend without an emulator.
 * Run with tsx: npm run cli -- <command> [args]
 */

import fs from 'node:fs';
import path from 'node:path';
import { FetchHttpClient, MemoryKeyValueStore } from '@/backend/platform';
import { InnertubeClient, VisitorDataManager, type SearchFilter } from '@/backend/innertube';
import { DEFAULT_INNERTUBE_CONFIG, redactValue, redactString } from '@/backend/core';
import {
  DefaultStreamResolver,
  VisionOsStreamStrategy,
  AndroidVrStreamStrategy,
  type StreamVerificationResult,
  type FullVerificationResult,
  type ResolvedStream,
} from '@/backend/streaming';

const coldStartBegin = performance.now();

function formatNumber(num: number): string {
  return num.toLocaleString('en-US');
}

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
  resolve <videoId> [--verify] [--verify-full] [--record]
                      Resolve best audio stream URL and format (highest bitrate Opus/AAC).
                      Pass --verify to make a small ranged request (bytes 0-1023) to verify playability.
                      Pass --verify-full to stream the first 30 seconds of audio in sequential ranged requests at normal pace, reporting total bytes, throughput, and 403/throttling.
                      Pass --record to save real response fixture to fixtures/recorded and fixtures/sanitized.
  health              Run health check on ~20 diverse videos across strategies and print success table.
  home                Fetch personalized or browse home feed (connected in Phase 2 browse)
  help, --help, -h    Show this help menu

Examples:
  npm run cli -- search "Radiohead Creep"
  npm run cli -- search "Radiohead" --filter songs --record
  npm run cli -- resolve "dQw4w9WgXcQ" --verify
  npm run cli -- resolve "9RfVp-GhKfs" --verify-full
  npm run cli -- resolve "9RfVp-GhKfs" --verify --record
  npm run cli -- health
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

interface HealthTarget {
  id: string;
  category: string;
  title: string;
}

const HEALTH_TARGETS: HealthTarget[] = [
  // Music (Classic / Modern / Diverse genres)
  { id: 'dQw4w9WgXcQ', category: 'Music (Classic Pop)', title: 'Never Gonna Give You Up' },
  { id: '9RfVp-GhKfs', category: 'Music (Alt Rock)', title: 'Radiohead - Creep' },
  { id: 'fJ9rUzIMcZQ', category: 'Music (Rock Anthem)', title: 'Bohemian Rhapsody' },
  { id: 'k4V3Mo61fJM', category: 'Music (80s Pop)', title: 'Billie Jean' },
  { id: 'JGwWNGJdvx8', category: 'Music (Modern Pop)', title: 'Shape of You' },
  { id: 'OPf0YbXqDm0', category: 'Music (Funk Pop)', title: 'Uptown Funk' },
  { id: 'kXYiU_JCYtU', category: 'Music (Alt Metal)', title: 'Linkin Park - Numb' },
  { id: 'YQHsXMglC9A', category: 'Music (Pop Ballad)', title: 'Adele - Hello' },

  // Non-English / Global Music
  { id: 'kJQP7kiw5Fk', category: 'Non-English (Spanish)', title: 'Luis Fonsi - Despacito' },
  { id: 'gdZLi9oWNZg', category: 'Non-English (K-Pop)', title: 'BTS - Dynamite' },
  { id: 'BddP6PYo2gs', category: 'Non-English (Hindi)', title: 'Arijit Singh - Kesariya' },
  { id: 'L3wKzyIN1yk', category: 'Non-English (French)', title: 'Indila - Derniere Danse' },
  { id: 'RgKAFK5djSk', category: 'Non-English (Afrobeats)', title: 'Wizkid - Essence' },
  { id: '7Ma_mXp21pA', category: 'Non-English (Japanese)', title: 'YOASOBI - Idol' },

  // Long-Form Audio
  { id: 'DWcJFNfaw9c', category: 'Long Form (1 Hour)', title: '1h Relaxing Piano' },
  { id: 'M5QY2_8704o', category: 'Long Form (10 Hours)', title: '10h Rain Sounds' },

  // Age-Restricted
  { id: '07FY850lwxA', category: 'Age-Restricted (18+)', title: 'This Is America' },

  // Live Stream
  { id: '5qap5aO4i9A', category: 'Live Stream (24/7)', title: 'Lofi Girl - Radio' },

  // Region-Restricted / Geo UK
  { id: 'p7bfOZek9t4', category: 'Region-Restricted', title: 'BBC UK Broadcast' },

  // Recent / High-Traffic Music Video
  { id: 'CevxZvSJLk8', category: 'Recent / High-Traffic', title: 'Katy Perry - Roar' },
];

async function handleHealth(): Promise<CliTiming> {
  const healthStart = performance.now();
  console.log('[CLI] Running stream health check on 20 diverse videos across strategies...\n');

  const httpClient = new FetchHttpClient();
  const visitorDataManager = new VisitorDataManager({
    httpClient,
    config: DEFAULT_INNERTUBE_CONFIG,
    keyValueStore: new MemoryKeyValueStore(),
  });
  const visitorData = await visitorDataManager.getVisitorData();
  const resolver = new DefaultStreamResolver({ httpClient, visitorDataManager });
  const visionOsStrategy = new VisionOsStreamStrategy(httpClient);
  const androidVrStrategy = new AndroidVrStreamStrategy(httpClient);

  interface StrategyResult {
    success: boolean;
    statusText: string;
    details?: string;
    latencyMs: number;
  }

  interface RowResult {
    target: HealthTarget;
    visionos: StrategyResult;
    androidVr: StrategyResult;
    fallbackPlayable: boolean;
  }

  const results: RowResult[] = [];
  const delayMs = 350; // Respect minimum delay between requests

  async function testStrategy(
    strategy: VisionOsStreamStrategy | AndroidVrStreamStrategy,
    videoId: string,
  ): Promise<StrategyResult> {
    const t0 = performance.now();
    try {
      const res = await strategy.resolve(videoId, { visitorData });
      if (!res.ok) {
        return {
          success: false,
          statusText: `FAIL (${res.error.code})`,
          details: res.error.message,
          latencyMs: performance.now() - t0,
        };
      }
      const verification = await resolver.verify(res.value.stream.url, {
        headers: res.value.requestHeaders,
      });
      const t1 = performance.now();
      if (!verification.isPlayable) {
        return {
          success: false,
          statusText: `FAIL (HTTP ${verification.statusCode})`,
          details: verification.error ?? `HTTP ${verification.statusCode}`,
          latencyMs: t1 - t0,
        };
      }
      return {
        success: true,
        statusText: `PASS (${res.value.stream.codec.toUpperCase()} ${(res.value.stream.bitrate / 1000).toFixed(0)}k, ${verification.statusCode})`,
        latencyMs: t1 - t0,
      };
    } catch (err: unknown) {
      return {
        success: false,
        statusText: 'FAIL (Error)',
        details: err instanceof Error ? err.message : String(err),
        latencyMs: performance.now() - t0,
      };
    }
  }

  for (let i = 0; i < HEALTH_TARGETS.length; i++) {
    const target = HEALTH_TARGETS[i];
    process.stdout.write(
      `[${String(i + 1).padStart(2, ' ')}/${HEALTH_TARGETS.length}] Checking "${target.title.slice(0, 25)}" (${target.id})...\r`,
    );

    const vRes = await testStrategy(visionOsStrategy, target.id);
    await new Promise((r) => setTimeout(r, delayMs));

    const aRes = await testStrategy(androidVrStrategy, target.id);
    await new Promise((r) => setTimeout(r, delayMs));

    const fallbackPlayable = vRes.success || aRes.success;

    results.push({
      target,
      visionos: vRes,
      androidVr: aRes,
      fallbackPlayable,
    });
  }

  // Clear progress line
  process.stdout.write(' '.repeat(80) + '\r');

  console.log(
    '========================================================================================================================',
  );
  console.log(
    '                                     STREAM RESOLUTION HEALTH CHECK (20 DIVERSE VIDEOS)                                 ',
  );
  console.log(
    '========================================================================================================================',
  );
  console.log(
    ` ${'#'.padEnd(3)} | ${'Category'.padEnd(23)} | ${'Title / Video ID'.padEnd(36)} | ${'VisionOS'.padEnd(25)} | ${'Android VR'.padEnd(25)}`,
  );
  console.log(
    '-----+-------------------------+--------------------------------------+---------------------------+--------------------------',
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const idxStr = String(i + 1).padStart(2, ' ');
    const catStr = r.target.category.slice(0, 23).padEnd(23, ' ');
    const titleStr = `${r.target.title.slice(0, 23)} (${r.target.id})`.padEnd(36, ' ');
    const vStr = r.visionos.statusText.slice(0, 25).padEnd(25, ' ');
    const aStr = r.androidVr.statusText.slice(0, 25).padEnd(25, ' ');

    console.log(` ${idxStr} | ${catStr} | ${titleStr} | ${vStr} | ${aStr}`);
  }
  console.log(
    '------------------------------------------------------------------------------------------------------------------------\n',
  );

  const vPassed = results.filter((r) => r.visionos.success).length;
  const aPassed = results.filter((r) => r.androidVr.success).length;
  const anyPassed = results.filter((r) => r.fallbackPlayable).length;
  const total = results.length;

  const vAvgLatency =
    results.map((r) => r.visionos.latencyMs).reduce((a, b) => a + b, 0) / (total || 1);
  const aAvgLatency =
    results.map((r) => r.androidVr.latencyMs).reduce((a, b) => a + b, 0) / (total || 1);

  console.log(
    '========================================================================================================================',
  );
  console.log('STRATEGY SUCCESS SUMMARY');
  console.log(
    '========================================================================================================================',
  );
  console.log(
    `  VisionOS:            ${vPassed}/${total} passed (${((vPassed / total) * 100).toFixed(1)}%) | Avg Latency: ${vAvgLatency.toFixed(0)} ms`,
  );
  console.log(
    `  Android VR:          ${aPassed}/${total} passed (${((aPassed / total) * 100).toFixed(1)}%) | Avg Latency: ${aAvgLatency.toFixed(0)} ms`,
  );
  console.log(
    `  Combined Fallback:   ${anyPassed}/${total} playable (${((anyPassed / total) * 100).toFixed(1)}%)`,
  );
  console.log(
    '========================================================================================================================',
  );

  // Honest breakdown of failures
  const failures = results.filter(
    (r) => !r.fallbackPlayable || !r.visionos.success || !r.androidVr.success,
  );
  if (failures.length > 0) {
    console.log('\nFailure Mode Analysis (Honest Breakdown):');
    for (const f of failures) {
      const vMsg = f.visionos.success ? 'PASS' : f.visionos.details || f.visionos.statusText;
      const aMsg = f.androidVr.success ? 'PASS' : f.androidVr.details || f.androidVr.statusText;
      console.log(`  - [${f.target.id}] ${f.target.title} (${f.target.category}):`);
      console.log(`      VisionOS:   ${vMsg}`);
      console.log(`      AndroidVR:  ${aMsg}`);
      if (f.target.category.includes('Age-Restricted')) {
        console.log(
          `      Analysis:   18+ Age restriction requires user authentication/cookie. Unauthenticated client receives LOGIN_REQUIRED.`,
        );
      } else if (f.target.category.includes('Live Stream')) {
        console.log(
          `      Analysis:   24/7 Livestream delivers continuous HLS/DASH manifest chunks instead of static progressive audio streams.`,
        );
      } else if (f.target.category.includes('Long Form')) {
        console.log(
          `      Analysis:   Long-form content duration triggers adaptive segment constraints or omitted direct streaming formats.`,
        );
      } else if (f.target.category.includes('Japanese') || f.target.category.includes('Region')) {
        console.log(
          `      Analysis:   Publisher/label licensing restrictions (e.g. Sony Music Japan) block unauthenticated mobile client contexts.`,
        );
      }
    }
    console.log();
  }

  return {
    coldStartTimeMs: 0,
    commandExecutionMs: performance.now() - healthStart,
    totalTimeMs: performance.now() - healthStart,
  };
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
      let shouldVerifyFull = false;
      let shouldRecord = false;

      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--verify-full') {
          shouldVerifyFull = true;
        } else if (args[i] === '--verify') {
          shouldVerify = true;
        } else if (args[i] === '--record') {
          shouldRecord = true;
        } else if (!args[i].startsWith('--')) {
          videoId = args[i];
        }
      }

      timingDetails = await handleResolve(
        videoId,
        shouldVerify,
        shouldVerifyFull,
        shouldRecord,
      );
      break;
    }
    case 'health': {
      timingDetails = await handleHealth();
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
      `[Perf] Response Size:         ${(timingDetails.responseSizeBytes / 1024).toFixed(2)} KB (${formatNumber(timingDetails.responseSizeBytes)} bytes)`,
    );
  }
  console.log(`[Perf] Command Total Time:    ${(cmdEnd - cmdStart).toFixed(2)} ms`);
  console.log(`[Perf] Total Process Time:    ${(cmdEnd - coldStartBegin).toFixed(2)} ms`);
}

main().catch((err: unknown) => {
  console.error('Fatal CLI Error:', err);
  process.exit(1);
});

