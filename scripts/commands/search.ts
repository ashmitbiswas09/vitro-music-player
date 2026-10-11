/**
 * CLI Search command handler.
 */

import { performance } from 'node:perf_hooks';
import { FetchHttpClient } from '@/backend/platform';
import { InnertubeClient, type SearchFilter } from '@/backend/innertube';
import type { CliTiming } from './types';
import { recordFixture } from './helpers';

export async function handleSearch(
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
    recordFixture('search', cleanQuery, rawRes.value);
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
