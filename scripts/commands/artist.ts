/**
 * CLI Artist command handler.
 */

import { performance } from 'node:perf_hooks';
import { FetchHttpClient } from '@/backend/platform';
import { InnertubeClient } from '@/backend/innertube';
import type { CliTiming } from './types';
import { recordFixture } from './helpers';

export async function handleArtist(
  browseId: string | undefined,
  shouldRecord: boolean,
): Promise<CliTiming> {
  if (!browseId) {
    console.error('Error: browseId is required. Usage: npm run cli -- artist <browseId> [--record]');
    process.exitCode = 1;
    return {
      coldStartTimeMs: 0,
      totalTimeMs: 0,
    };
  }

  const artistStart = performance.now();
  console.log(`[CLI] Fetching Artist: "${browseId}"...`);

  const httpClient = new FetchHttpClient();
  const client = new InnertubeClient({ httpClient });

  const rawRes = await client.getRawArtist(browseId);
  const fetchLatencyMs = performance.now() - artistStart;

  if (!rawRes.ok) {
    console.error(`[CLI Error] Artist fetch failed: ${rawRes.error.message}`);
    process.exitCode = 1;
    return {
      coldStartTimeMs: 0,
      totalTimeMs: performance.now() - artistStart,
    };
  }

  if (shouldRecord) {
    recordFixture('artist', browseId, rawRes.value);
  }

  const parsedRes = await client.getArtist(browseId);
  if (!parsedRes.ok) {
    console.error(`[CLI Error] Parser error: ${parsedRes.error.message}`);
    process.exitCode = 1;
    return {
      coldStartTimeMs: 0,
      totalTimeMs: performance.now() - artistStart,
    };
  }

  const { artist, albums, singles, parseDurationMs, responseSizeBytes } = parsedRes.value;

  console.log(`\n========================================`);
  console.log(`Artist: ${artist.name}`);
  console.log(`========================================`);
  if (artist.description) {
    console.log(`  Bio: ${artist.description.slice(0, 180)}...`);
  }
  const topTracks = artist.topTracks || [];
  if (topTracks.length > 0) {
    console.log(`\nTop Songs (${topTracks.length}):`);
    topTracks.slice(0, 5).forEach((t, idx) => {
      console.log(`  ${idx + 1}. ${t.title} [id: ${t.id}]`);
    });
  }
  if (albums.length > 0) {
    console.log(`\nAlbums (${albums.length}):`);
    albums.slice(0, 5).forEach((alb, idx) => {
      console.log(`  ${idx + 1}. ${alb.title}${alb.year ? ` (${alb.year})` : ''} [id: ${alb.id}]`);
    });
  }
  if (singles.length > 0) {
    console.log(`\nSingles & EPs (${singles.length}):`);
    singles.slice(0, 5).forEach((s, idx) => {
      console.log(`  ${idx + 1}. ${s.title}${s.year ? ` (${s.year})` : ''} [id: ${s.id}]`);
    });
  }

  return {
    coldStartTimeMs: 0,
    commandExecutionMs: fetchLatencyMs,
    parseTimeMs: parseDurationMs,
    responseSizeBytes,
    totalTimeMs: performance.now() - artistStart,
  };
}
