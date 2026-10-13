/**
 * Shared CLI helpers: number formatting, usage text, fixture recording and sanitization.
 */

import fs from 'node:fs';
import path from 'node:path';
import { redactValue } from '@/backend/core';

export function formatNumber(num: number): string {
  return num.toLocaleString('en-US');
}

export function printUsage(): void {
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
                      Pass --verify-full to stream the first 30 seconds of audio in sequential ranged requests at normal pace.
                      Pass --record to save real response fixture to fixtures/recorded and fixtures/sanitized.
  home [--record]     Fetch personalized or guest browse home feed with shelves.
  album <id> [--record]
                      Fetch album tracklist and metadata by browseId (e.g. MPREb_...).
  artist <id> [--record]
                      Fetch artist profile, top songs, albums, and bio by browseId (e.g. UCr_...).
  playlist <id> [--record]
                      Fetch playlist metadata and tracklist by playlistId (e.g. VLPL... or PL...).
  next <videoId> [--playlist <playlistId>] [--record]
                      Fetch Up Next queue / radio tracks for a video.
  suggest <text> [--record]
                      Fetch search suggestions for query prefix.
  health [--mode search|fixed] [--fixed]
                      Run stream resolution health check. Default runs ~15 diverse search queries,
                      resolves top track of each, and reports success. Pass --fixed for the 20-video list.
  cache [stats|clear|clear-user|inspect <key>|invalidate <videoId>|test <query>]
                      Inspect cache hits, misses, timings, clear multi-tier or user-scoped cache, or run cold vs warm benchmark.
  whoami              Report current authentication status (never prints cookies or email).
  help, --help, -h    Show this help menu

Examples:
  npm run cli -- search "Radiohead Creep"
  npm run cli -- resolve "9RfVp-GhKfs" --verify-full
  npm run cli -- home
  npm run cli -- album "MPREb_yXhSI4FCUo6"
  npm run cli -- artist "UCr_iyUANcn9OX_yy9piYoLw"
  npm run cli -- playlist "PL4fGSI1pDJn6O1LS0XSdF3RyO0Rq_LDeI"
  npm run cli -- next "9RfVp-GhKfs"
  npm run cli -- suggest "radiohead"
  npm run cli -- health
  npm run cli -- health --fixed
`);
}

export function sanitizeFixtureData(data: unknown): unknown {
  const sanitized = redactValue(data) as Record<string, unknown>;
  if (sanitized && typeof sanitized === 'object' && sanitized.responseContext) {
    const rc = sanitized.responseContext as Record<string, unknown>;
    if (rc.visitorData) {
      rc.visitorData = '[REDACTED]';
    }
  }
  return sanitized;
}

export function recordFixture(prefix: string, idOrName: string, data: unknown): void {
  const fixturesDir = path.resolve(__dirname, '../../fixtures');
  const recordedDir = path.join(fixturesDir, 'recorded');
  const sanitizedDir = path.join(fixturesDir, 'sanitized');

  fs.mkdirSync(recordedDir, { recursive: true });
  fs.mkdirSync(sanitizedDir, { recursive: true });

  const cleanName = idOrName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
  const recordedPath = path.join(recordedDir, `${prefix}_${cleanName}.json`);
  const sanitizedPath = path.join(sanitizedDir, `${prefix}_${cleanName}.json`);

  fs.writeFileSync(recordedPath, JSON.stringify(data, null, 2), 'utf-8');
  const sanitizedData = sanitizeFixtureData(data);
  fs.writeFileSync(sanitizedPath, JSON.stringify(sanitizedData, null, 2), 'utf-8');

  console.log(`\n[Record] Raw response saved to: ${path.relative(process.cwd(), recordedPath)}`);
  console.log(`[Record] Sanitized fixture saved to: ${path.relative(process.cwd(), sanitizedPath)}`);
}
