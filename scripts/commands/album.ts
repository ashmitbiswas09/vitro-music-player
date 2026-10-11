/**
 * CLI Album command handler.
 */

import { performance } from 'node:perf_hooks';
import { FetchHttpClient } from '@/backend/platform';
import { InnertubeClient } from '@/backend/innertube';
import type { CliTiming } from './types';
import { recordFixture } from './helpers';

export async function handleAlbum(
  browseId: string | undefined,
  shouldRecord: boolean,
): Promise<CliTiming> {
  if (!browseId) {
    console.error('Error: browseId is required. Usage: npm run cli -- album <browseId> [--record]');
    process.exitCode = 1;
    return {
      coldStartTimeMs: 0,
      totalTimeMs: 0,
    };
  }

  const albumStart = performance.now();
  console.log(`[CLI] Fetching Album: "${browseId}"...`);

  const httpClient = new FetchHttpClient();
  const client = new InnertubeClient({ httpClient });

  const rawRes = await client.getRawAlbum(browseId);
  const fetchLatencyMs = performance.now() - albumStart;

  if (!rawRes.ok) {
    console.error(`[CLI Error] Album fetch failed: ${rawRes.error.message}`);
    process.exitCode = 1;
    return {
      coldStartTimeMs: 0,
      totalTimeMs: performance.now() - albumStart,
    };
  }

  if (shouldRecord) {
    recordFixture('album', browseId, rawRes.value);
  }

  const parsedRes = await client.getAlbum(browseId);
  if (!parsedRes.ok) {
    console.error(`[CLI Error] Parser error: ${parsedRes.error.message}`);
    process.exitCode = 1;
    return {
      coldStartTimeMs: 0,
      totalTimeMs: performance.now() - albumStart,
    };
  }

  const { album, parseDurationMs, responseSizeBytes } = parsedRes.value;
  const artists = album.artists.map((a) => a.name).join(', ') || 'Unknown Artist';
  const tracks = album.tracks || [];

  console.log(`\n========================================`);
  console.log(`Album: ${album.title}`);
  console.log(`========================================`);
  console.log(`  Artist:         ${artists}`);
  if (album.year) {
    console.log(`  Release Year:   ${album.year}`);
  }
  console.log(`  Track Count:    ${album.trackCount ?? tracks.length}`);
  if (album.durationSeconds) {
    console.log(
      `  Duration:       ${Math.floor(album.durationSeconds / 60)}m ${album.durationSeconds % 60}s`,
    );
  }
  console.log(`\nTracklist (${tracks.length} tracks):`);
  tracks.slice(0, 15).forEach((track, idx) => {
    const dur = track.durationSeconds
      ? ` (${Math.floor(track.durationSeconds / 60)}:${String(track.durationSeconds % 60).padStart(2, '0')})`
      : '';
    console.log(`  ${String(idx + 1).padStart(2, ' ')}. ${track.title}${dur} [id: ${track.id}]`);
  });
  if (tracks.length > 15) {
    console.log(`  ... and ${tracks.length - 15} more tracks`);
  }

  return {
    coldStartTimeMs: 0,
    commandExecutionMs: fetchLatencyMs,
    parseTimeMs: parseDurationMs,
    responseSizeBytes,
    totalTimeMs: performance.now() - albumStart,
  };
}
