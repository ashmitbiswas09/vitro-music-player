/**
 * CLI Next command handler.
 */

import { performance } from 'node:perf_hooks';
import { FetchHttpClient } from '@/backend/platform';
import { InnertubeClient } from '@/backend/innertube';
import type { CliTiming } from './types';
import { recordFixture } from './helpers';

export async function handleNext(
  videoId: string | undefined,
  playlistId: string | undefined,
  shouldRecord: boolean,
): Promise<CliTiming> {
  if (!videoId) {
    console.error(
      'Error: videoId is required. Usage: npm run cli -- next <videoId> [--playlist <playlistId>] [--record]',
    );
    process.exitCode = 1;
    return {
      coldStartTimeMs: 0,
      totalTimeMs: 0,
    };
  }

  const nextStart = performance.now();
  console.log(
    `[CLI] Fetching Next queue / radio for videoId: "${videoId}"${playlistId ? ` (playlist: ${playlistId})` : ''}...`,
  );

  const httpClient = new FetchHttpClient();
  const client = new InnertubeClient({ httpClient });

  const rawRes = await client.getRawNext(videoId, { playlistId });
  const fetchLatencyMs = performance.now() - nextStart;

  if (!rawRes.ok) {
    console.error(`[CLI Error] Next fetch failed: ${rawRes.error.message}`);
    process.exitCode = 1;
    return {
      coldStartTimeMs: 0,
      totalTimeMs: performance.now() - nextStart,
    };
  }

  if (shouldRecord) {
    recordFixture('next', videoId, rawRes.value);
  }

  const parsedRes = await client.getNext(videoId, { playlistId });
  if (!parsedRes.ok) {
    console.error(`[CLI Error] Parser error: ${parsedRes.error.message}`);
    process.exitCode = 1;
    return {
      coldStartTimeMs: 0,
      totalTimeMs: performance.now() - nextStart,
    };
  }

  const { currentTrack, queue, parseDurationMs, responseSizeBytes, continuationToken } =
    parsedRes.value;

  console.log(`\n========================================`);
  console.log(`Up Next / Radio Queue:`);
  console.log(`========================================`);
  if (currentTrack) {
    const curArtists = currentTrack.artists.map((a) => a.name).join(', ') || 'Unknown Artist';
    console.log(`  Now Playing:  ${currentTrack.title} - ${curArtists} [id: ${currentTrack.id}]`);
  }
  console.log(`  Queue Tracks: ${queue.length}`);
  if (continuationToken) {
    console.log(`  Has More:     Yes (continuation token available)`);
  }
  console.log(`\nUpcoming Queue:`);
  queue.slice(0, 15).forEach((t, idx) => {
    const artists = t.artists.map((a) => a.name).join(', ') || 'Unknown Artist';
    const dur = t.durationSeconds
      ? ` (${Math.floor(t.durationSeconds / 60)}:${String(t.durationSeconds % 60).padStart(2, '0')})`
      : '';
    console.log(`  ${String(idx + 1).padStart(2, ' ')}. ${t.title} - ${artists}${dur} [id: ${t.id}]`);
  });
  if (queue.length > 15) {
    console.log(`  ... and ${queue.length - 15} more tracks`);
  }

  return {
    coldStartTimeMs: 0,
    commandExecutionMs: fetchLatencyMs,
    parseTimeMs: parseDurationMs,
    responseSizeBytes,
    totalTimeMs: performance.now() - nextStart,
  };
}
