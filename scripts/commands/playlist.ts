/**
 * CLI Playlist command handler.
 */

import { performance } from 'node:perf_hooks';
import { FetchHttpClient } from '@/backend/platform';
import { InnertubeClient } from '@/backend/innertube';
import type { CliTiming } from './types';
import { recordFixture } from './helpers';

export async function handlePlaylist(
  playlistId: string | undefined,
  shouldRecord: boolean,
): Promise<CliTiming> {
  if (!playlistId) {
    console.error(
      'Error: playlistId is required. Usage: npm run cli -- playlist <playlistId> [--record]',
    );
    process.exitCode = 1;
    return {
      coldStartTimeMs: 0,
      totalTimeMs: 0,
    };
  }

  const playlistStart = performance.now();
  console.log(`[CLI] Fetching Playlist: "${playlistId}"...`);

  const httpClient = new FetchHttpClient();
  const client = new InnertubeClient({ httpClient });

  const rawRes = await client.getRawPlaylist(playlistId);
  const fetchLatencyMs = performance.now() - playlistStart;

  if (!rawRes.ok) {
    console.error(`[CLI Error] Playlist fetch failed: ${rawRes.error.message}`);
    process.exitCode = 1;
    return {
      coldStartTimeMs: 0,
      totalTimeMs: performance.now() - playlistStart,
    };
  }

  if (shouldRecord) {
    recordFixture('playlist', playlistId, rawRes.value);
  }

  const parsedRes = await client.getPlaylist(playlistId);
  if (!parsedRes.ok) {
    console.error(`[CLI Error] Parser error: ${parsedRes.error.message}`);
    process.exitCode = 1;
    return {
      coldStartTimeMs: 0,
      totalTimeMs: performance.now() - playlistStart,
    };
  }

  const { playlist, parseDurationMs, responseSizeBytes } = parsedRes.value;
  const tracks = playlist.tracks || [];

  console.log(`\n========================================`);
  console.log(`Playlist: ${playlist.title}`);
  console.log(`========================================`);
  if (playlist.author) {
    console.log(`  Author:       ${playlist.author}`);
  }
  console.log(`  Tracks:       ${playlist.trackCount ?? tracks.length}`);
  if (playlist.continuationToken) {
    console.log(`  Has More:     Yes (continuation token present)`);
  }
  console.log(`\nTracklist:`);
  tracks.slice(0, 15).forEach((t, idx) => {
    const artists = t.artists.map((a) => a.name).join(', ') || 'Unknown Artist';
    const dur = t.durationSeconds
      ? ` (${Math.floor(t.durationSeconds / 60)}:${String(t.durationSeconds % 60).padStart(2, '0')})`
      : '';
    console.log(`  ${String(idx + 1).padStart(2, ' ')}. ${t.title} - ${artists}${dur} [id: ${t.id}]`);
  });
  if (tracks.length > 15) {
    console.log(`  ... and ${tracks.length - 15} more tracks`);
  }

  return {
    coldStartTimeMs: 0,
    commandExecutionMs: fetchLatencyMs,
    parseTimeMs: parseDurationMs,
    responseSizeBytes,
    totalTimeMs: performance.now() - playlistStart,
  };
}
