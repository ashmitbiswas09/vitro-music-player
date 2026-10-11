/**
 * CLI Suggest command handler.
 */

import { performance } from 'node:perf_hooks';
import { FetchHttpClient } from '@/backend/platform';
import { InnertubeClient } from '@/backend/innertube';
import type { CliTiming } from './types';
import { recordFixture } from './helpers';

export async function handleSuggest(
  text: string | undefined,
  shouldRecord: boolean,
): Promise<CliTiming> {
  if (!text || !text.trim()) {
    console.error('Error: query text is required. Usage: npm run cli -- suggest <text> [--record]');
    process.exitCode = 1;
    return {
      coldStartTimeMs: 0,
      totalTimeMs: 0,
    };
  }

  const suggestStart = performance.now();
  console.log(`[CLI] Fetching search suggestions for: "${text}"...`);

  const httpClient = new FetchHttpClient();
  const client = new InnertubeClient({ httpClient });

  const rawRes = await client.getRawSearchSuggestions(text);
  const fetchLatencyMs = performance.now() - suggestStart;

  if (!rawRes.ok) {
    console.error(`[CLI Error] Search suggestions fetch failed: ${rawRes.error.message}`);
    process.exitCode = 1;
    return {
      coldStartTimeMs: 0,
      totalTimeMs: performance.now() - suggestStart,
    };
  }

  if (shouldRecord) {
    recordFixture('suggest', text, rawRes.value);
  }

  const parsedRes = await client.getSearchSuggestions(text);
  if (!parsedRes.ok) {
    console.error(`[CLI Error] Parser error: ${parsedRes.error.message}`);
    process.exitCode = 1;
    return {
      coldStartTimeMs: 0,
      totalTimeMs: performance.now() - suggestStart,
    };
  }

  const { suggestions, parseDurationMs, responseSizeBytes } = parsedRes.value;

  console.log(`\nSuggestions for "${text}" (${suggestions.length} items):`);
  suggestions.forEach((s, idx) => {
    console.log(`  ${idx + 1}. ${s}`);
  });

  return {
    coldStartTimeMs: 0,
    commandExecutionMs: fetchLatencyMs,
    parseTimeMs: parseDurationMs,
    responseSizeBytes,
    totalTimeMs: performance.now() - suggestStart,
  };
}
