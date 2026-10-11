/**
 * CLI Health command handler (search-based dynamic top tracks & fixed list).
 */

import { performance } from 'node:perf_hooks';
import { FetchHttpClient, MemoryKeyValueStore } from '@/backend/platform';
import { DEFAULT_INNERTUBE_CONFIG } from '@/backend/core';
import { InnertubeClient, VisitorDataManager } from '@/backend/innertube';
import {
  DefaultStreamResolver,
  VisionOsStreamStrategy,
  AndroidVrStreamStrategy,
} from '@/backend/streaming';
import type { CliTiming } from './types';

export interface HealthTarget {
  id: string;
  category: string;
  title: string;
}

export const HEALTH_TARGETS: HealthTarget[] = [
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

export interface HealthSearchQuery {
  genre: string;
  query: string;
}

export const HEALTH_SEARCH_QUERIES: HealthSearchQuery[] = [
  { genre: 'Alt Rock', query: 'Radiohead Creep' },
  { genre: 'Modern Pop', query: 'Taylor Swift Anti-Hero' },
  { genre: 'Classic Rock', query: 'Queen Bohemian Rhapsody' },
  { genre: '80s Pop', query: 'Michael Jackson Billie Jean' },
  { genre: 'Jazz', query: 'Miles Davis So What' },
  { genre: 'Classical', query: 'Beethoven Moonlight Sonata' },
  { genre: 'Hip-Hop', query: 'Kendrick Lamar HUMBLE' },
  { genre: 'Electronic', query: 'Daft Punk Get Lucky' },
  { genre: 'Reggae', query: 'Bob Marley Three Little Birds' },
  { genre: 'Latin Pop', query: 'Luis Fonsi Despacito' },
  { genre: 'K-Pop', query: 'BTS Dynamite' },
  { genre: 'Bollywood', query: 'Arijit Singh Kesariya' },
  { genre: 'French Pop', query: 'Indila Derniere Danse' },
  { genre: 'Afrobeats', query: 'Wizkid Essence' },
  { genre: 'J-Pop', query: 'YOASOBI Idol' },
];

export async function handleHealth(mode: 'search' | 'fixed'): Promise<CliTiming> {
  const healthStart = performance.now();

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

  if (mode === 'search') {
    console.log(
      `[CLI] Running stream health check on ~15 diverse search queries (mode: search)...\n`,
    );

    const client = new InnertubeClient({ httpClient, visitorDataOverride: visitorData });

    interface SearchRowResult {
      genre: string;
      query: string;
      topSongTitle: string;
      videoId: string;
      visionos: StrategyResult;
      androidVr: StrategyResult;
      fallbackPlayable: boolean;
    }

    const searchResults: SearchRowResult[] = [];

    for (let i = 0; i < HEALTH_SEARCH_QUERIES.length; i++) {
      const item = HEALTH_SEARCH_QUERIES[i];
      process.stdout.write(
        `[${String(i + 1).padStart(2, ' ')}/${HEALTH_SEARCH_QUERIES.length}] Searching "${item.query}"...\r`,
      );

      const searchRes = await client.search(item.query, { filter: 'songs' });
      await new Promise((r) => setTimeout(r, delayMs));

      let topTrack: { id: string; title: string } | undefined;
      if (searchRes.ok) {
        const trackItem = searchRes.value.items.find((it) => it.type === 'track');
        if (trackItem && trackItem.type === 'track') {
          topTrack = { id: trackItem.track.id, title: trackItem.track.title };
        }
      }

      if (!topTrack) {
        searchResults.push({
          genre: item.genre,
          query: item.query,
          topSongTitle: 'Not Found',
          videoId: 'N/A',
          visionos: { success: false, statusText: 'FAIL (No Track)', latencyMs: 0 },
          androidVr: { success: false, statusText: 'FAIL (No Track)', latencyMs: 0 },
          fallbackPlayable: false,
        });
        continue;
      }

      process.stdout.write(
        `[${String(i + 1).padStart(2, ' ')}/${HEALTH_SEARCH_QUERIES.length}] Resolving "${topTrack.title.slice(0, 25)}" (${topTrack.id})...\r`,
      );

      const vRes = await testStrategy(visionOsStrategy, topTrack.id);
      await new Promise((r) => setTimeout(r, delayMs));

      const aRes = await testStrategy(androidVrStrategy, topTrack.id);
      await new Promise((r) => setTimeout(r, delayMs));

      const fallbackPlayable = vRes.success || aRes.success;

      searchResults.push({
        genre: item.genre,
        query: item.query,
        topSongTitle: topTrack.title,
        videoId: topTrack.id,
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
      '                           STREAM RESOLUTION HEALTH CHECK (~15 DIVERSE SEARCH QUERIES)                                  ',
    );
    console.log(
      '========================================================================================================================',
    );
    console.log(
      ` ${'#'.padEnd(3)} | ${'Genre'.padEnd(14)} | ${'Search Query'.padEnd(28)} | ${'Top Song (Video ID)'.padEnd(32)} | ${'VisionOS'.padEnd(22)} | ${'Android VR'.padEnd(22)}`,
    );
    console.log(
      '-----+----------------+------------------------------+----------------------------------+------------------------+-----------------------',
    );

    for (let i = 0; i < searchResults.length; i++) {
      const r = searchResults[i];
      const idxStr = String(i + 1).padStart(2, ' ');
      const genreStr = r.genre.slice(0, 14).padEnd(14, ' ');
      const queryStr = r.query.slice(0, 28).padEnd(28, ' ');
      const songStr = `${r.topSongTitle.slice(0, 18)} (${r.videoId})`.padEnd(32, ' ');
      const vStr = r.visionos.statusText.slice(0, 22).padEnd(22, ' ');
      const aStr = r.androidVr.statusText.slice(0, 22).padEnd(22, ' ');

      console.log(` ${idxStr} | ${genreStr} | ${queryStr} | ${songStr} | ${vStr} | ${aStr}`);
    }
    console.log(
      '------------------------------------------------------------------------------------------------------------------------\n',
    );

    const vPassed = searchResults.filter((r) => r.visionos.success).length;
    const aPassed = searchResults.filter((r) => r.androidVr.success).length;
    const anyPassed = searchResults.filter((r) => r.fallbackPlayable).length;
    const total = searchResults.length;

    const vAvgLatency =
      searchResults.map((r) => r.visionos.latencyMs).reduce((a, b) => a + b, 0) / (total || 1);
    const aAvgLatency =
      searchResults.map((r) => r.androidVr.latencyMs).reduce((a, b) => a + b, 0) / (total || 1);

    console.log(
      '========================================================================================================================',
    );
    console.log('STRATEGY SUCCESS SUMMARY (SEARCH-DRIVEN TOP TRACKS)');
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

    return {
      coldStartTimeMs: 0,
      commandExecutionMs: performance.now() - healthStart,
      totalTimeMs: performance.now() - healthStart,
    };
  }

  // mode === 'fixed'
  console.log('[CLI] Running stream health check on 20 fixed diverse videos across strategies...\n');

  interface RowResult {
    target: HealthTarget;
    visionos: StrategyResult;
    androidVr: StrategyResult;
    fallbackPlayable: boolean;
  }

  const results: RowResult[] = [];

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
