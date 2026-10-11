/**
 * CLI Home command handler.
 */

import { performance } from 'node:perf_hooks';
import { FetchHttpClient } from '@/backend/platform';
import { InnertubeClient } from '@/backend/innertube';
import type { CliTiming } from './types';
import { recordFixture } from './helpers';

export async function handleHome(shouldRecord: boolean): Promise<CliTiming> {
  const homeStart = performance.now();
  console.log('[CLI] Fetching Home feed...');

  const httpClient = new FetchHttpClient();
  const client = new InnertubeClient({ httpClient });

  const rawRes = await client.getRawHome();
  const fetchLatencyMs = performance.now() - homeStart;

  if (!rawRes.ok) {
    console.error(`[CLI Error] Fetching Home feed failed: ${rawRes.error.message}`);
    process.exitCode = 1;
    return {
      coldStartTimeMs: 0,
      totalTimeMs: performance.now() - homeStart,
    };
  }

  if (shouldRecord) {
    recordFixture('home', 'feed', rawRes.value);
  }

  const parsedRes = await client.getHome();
  if (!parsedRes.ok) {
    console.error(`[CLI Error] Parser error: ${parsedRes.error.message}`);
    process.exitCode = 1;
    return {
      coldStartTimeMs: 0,
      totalTimeMs: performance.now() - homeStart,
    };
  }

  const { sections, continuationToken, parseDurationMs, responseSizeBytes } = parsedRes.value;

  console.log(`\n========================================`);
  console.log(`Home Feed (${sections.length} sections / shelves):`);
  console.log(`========================================`);
  sections.forEach((section, idx) => {
    console.log(`\n  ${idx + 1}. [Shelf] "${section.title}" (${section.items.length} items)`);
    section.items.slice(0, 3).forEach((item) => {
      switch (item.type) {
        case 'track': {
          const artists = item.track.artists.map((a) => a.name).join(', ') || 'Unknown Artist';
          console.log(`      - [Track] ${item.track.title} - ${artists} [id: ${item.track.id}]`);
          break;
        }
        case 'album': {
          const artists = item.album.artists.map((a) => a.name).join(', ') || '';
          console.log(
            `      - [Album] ${item.album.title}${artists ? ` by ${artists}` : ''} [id: ${item.album.id}]`,
          );
          break;
        }
        case 'artist':
          console.log(`      - [Artist] ${item.artist.name} [id: ${item.artist.id}]`);
          break;
        case 'playlist':
          console.log(`      - [Playlist] ${item.playlist.title} [id: ${item.playlist.id}]`);
          break;
      }
    });
    if (section.items.length > 3) {
      console.log(`      ... and ${section.items.length - 3} more items`);
    }
  });

  if (continuationToken) {
    console.log(`\n  Continuation Token: ${continuationToken.slice(0, 32)}...`);
  }

  return {
    coldStartTimeMs: 0,
    commandExecutionMs: fetchLatencyMs,
    parseTimeMs: parseDurationMs,
    responseSizeBytes,
    totalTimeMs: performance.now() - homeStart,
  };
}
