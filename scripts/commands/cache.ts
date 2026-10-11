/**
 * CLI Cache command handler.
 * Inspect cache statistics, inspect individual cache keys, clear cache,
 * or run a cold vs warm benchmark to verify sub-100ms response times.
 */

import { performance } from 'node:perf_hooks';
import { createBackend } from '@/backend/services';
import { CacheKeyBuilder } from '@/backend/cache';
import type { CliTiming } from './types';
import { formatNumber } from './helpers';

export async function handleCache(
  subcommand = 'stats',
  targetArg?: string,
): Promise<CliTiming> {
  const startTime = performance.now();
  const backend = createBackend();

  console.log(`\n========================================`);
  console.log(`Vitro Cache Manager (SWR / Multi-Tier)`);
  console.log(`========================================`);

  switch (subcommand.toLowerCase()) {
    case 'stats': {
      const stats = await backend.getCacheStats();
      console.log(`Cache Statistics:`);
      console.log(`  - Hits:              ${formatNumber(stats.hits)}`);
      console.log(`  - Misses:            ${formatNumber(stats.misses)}`);
      console.log(`  - Stale Hits:        ${formatNumber(stats.staleHits)}`);
      console.log(`  - Revalidations:     ${formatNumber(stats.revalidations)}`);
      console.log(`  - Evictions:         ${formatNumber(stats.evictions)}`);
      console.log(`  - Memory Entries:    ${formatNumber(stats.inMemoryCount)}`);
      console.log(`  - Memory Size:       ${formatNumber(stats.inMemorySizeBytes)} bytes`);
      console.log(`  - SQLite Entries:    ${formatNumber(stats.sqlCount)}`);
      break;
    }

    case 'clear': {
      console.log(`Clearing all cache tiers (L1 Memory LRU + L2 SQLite)...`);
      await backend.clearCache();
      const stats = await backend.getCacheStats();
      console.log(`Cache cleared successfully.`);
      console.log(`  - In-memory entries: ${stats.inMemoryCount}`);
      console.log(`  - SQLite entries:    ${stats.sqlCount}`);
      break;
    }

    case 'inspect': {
      if (!targetArg) {
        console.error('Error: Please provide a cache key to inspect.');
        console.log('Usage: npm run cli -- cache inspect <key>');
        process.exitCode = 1;
        break;
      }
      console.log(`Inspecting cache key: "${targetArg}"...`);
      const res = await backend.cache.get(targetArg);
      console.log(`  - Status:     ${res.status.toUpperCase()}`);
      console.log(`  - Is Hit:     ${res.isHit ? 'YES' : 'NO'}`);
      console.log(`  - Is Stale:   ${res.isStale ? 'YES' : 'NO'}`);
      if (res.ageMs !== undefined) {
        console.log(`  - Age:        ${res.ageMs} ms`);
      }
      if (res.freshUntil !== undefined) {
        console.log(`  - Fresh Until:${new Date(res.freshUntil).toISOString()}`);
      }
      if (res.staleUntil !== undefined) {
        console.log(`  - Stale Until:${new Date(res.staleUntil).toISOString()}`);
      }
      if (res.data) {
        const preview = JSON.stringify(res.data).slice(0, 150);
        console.log(`  - Payload:    ${preview}...`);
      }
      break;
    }

    case 'test':
    case 'benchmark': {
      const query = targetArg || 'Radiohead';
      console.log(`Running Cold vs Warm Cache Benchmark with query: "${query}"...\n`);

      // 1. Cold Call
      console.log(`[1/2] Cold Call (fetching from InnerTube via repository)...`);
      const coldStart = performance.now();
      const coldRes = await backend.search(query);
      const coldDurationMs = performance.now() - coldStart;

      if (!coldRes.ok) {
        console.error(`Cold search failed: ${coldRes.error.message}`);
        process.exitCode = 1;
        break;
      }
      const coldItemCount = coldRes.value.items.length;
      console.log(`      ✓ Cold Duration: ${coldDurationMs.toFixed(2)} ms (${coldItemCount} items returned)`);

      // 2. Warm Call
      console.log(`\n[2/2] Warm Call (fetching from Cache via repository)...`);
      const warmStart = performance.now();
      const warmRes = await backend.search(query);
      const warmDurationMs = performance.now() - warmStart;

      if (!warmRes.ok) {
        console.error(`Warm search failed: ${warmRes.error.message}`);
        process.exitCode = 1;
        break;
      }
      const warmItemCount = warmRes.value.items.length;
      console.log(`      ✓ Warm Duration: ${warmDurationMs.toFixed(2)} ms (${warmItemCount} items returned)`);

      // 3. Verification & Comparison
      const speedup = coldDurationMs / Math.max(warmDurationMs, 0.01);
      const key = CacheKeyBuilder.search(query);
      const inspectRes = await backend.cache.get(key);
      const stats = await backend.getCacheStats();

      console.log(`\n----------------------------------------`);
      console.log(`Benchmark Results:`);
      console.log(`----------------------------------------`);
      console.log(`  • Cold Call Time:       ${coldDurationMs.toFixed(2)} ms (Network + Parse)`);
      console.log(`  • Warm Call Time:       ${warmDurationMs.toFixed(2)} ms (Cache Hit)`);
      console.log(`  • Target Sub-100ms Met: ${warmDurationMs < 100 ? 'PASS (Under 100 ms)' : 'FAIL'}`);
      console.log(`  • Speedup Factor:       ${speedup.toFixed(1)}x faster`);
      console.log(`  • Key Inspected:        ${key}`);
      console.log(`  • Key Status:           ${inspectRes.status}`);
      console.log(`  • Total Cache Hits:     ${stats.hits}`);
      console.log(`  • Total Cache Misses:   ${stats.misses}`);
      console.log(`----------------------------------------\n`);
      break;
    }

    case 'invalidate': {
      if (!targetArg) {
        console.error('Error: Please provide videoId to invalidate. Usage: npm run cli -- cache invalidate <videoId>');
        process.exitCode = 1;
        break;
      }
      console.log(`Invalidating stream cache for videoId: "${targetArg}"...`);
      await backend.invalidateStream(targetArg);
      console.log(`Stream URL cache invalidated successfully.`);
      break;
    }

    case 'clear-user': {
      console.log(`Clearing user-scoped cache entries (auth:user:*)...`);
      await backend.clearUserScopedData();
      console.log(`User-scoped cache cleared successfully.`);
      break;
    }

    default:
      console.log(`Unknown cache subcommand: "${subcommand}".`);
      console.log(`Available commands:`);
      console.log(`  npm run cli -- cache stats`);
      console.log(`  npm run cli -- cache clear`);
      console.log(`  npm run cli -- cache clear-user`);
      console.log(`  npm run cli -- cache inspect <key>`);
      console.log(`  npm run cli -- cache invalidate <videoId>`);
      console.log(`  npm run cli -- cache test [query]`);
  }

  const totalTimeMs = performance.now() - startTime;
  return {
    coldStartTimeMs: 0,
    totalTimeMs,
  };
}
