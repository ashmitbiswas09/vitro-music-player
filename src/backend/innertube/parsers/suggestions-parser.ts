/**
 * Defensive parser for YouTube Music search suggestions.
 */

import { z } from 'zod';
import { ok, type Result, type AppError, perf } from '@/backend/core';
import type { SearchSuggestionsResponse } from '../types';
import { runsToText } from './parser-utils';

const SuggestionItemSchema = z.object({
  searchSuggestionRenderer: z
    .object({
      suggestion: z
        .object({
          runs: z.array(z.object({ text: z.string() })).optional(),
        })
        .optional(),
    })
    .optional(),
});

const SuggestionsSectionSchema = z.object({
  searchSuggestionsSectionRenderer: z
    .object({
      contents: z.array(SuggestionItemSchema).optional(),
    })
    .optional(),
});

const SuggestionsResponseSchema = z.object({
  contents: z.array(SuggestionsSectionSchema).optional(),
});

export function parseSuggestionsResponse(
  rawBody: unknown,
  query: string,
): Result<SearchSuggestionsResponse, AppError> {
  const { result: suggestions, durationMs } = perf.measureSync('ParseSuggestions', () => {
    const parsed = SuggestionsResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.contents) {
      return [];
    }

    const result: string[] = [];
    for (const section of parsed.data.contents) {
      const items = section.searchSuggestionsSectionRenderer?.contents;
      if (Array.isArray(items)) {
        for (const item of items) {
          const text = runsToText(item.searchSuggestionRenderer?.suggestion?.runs);
          if (text.trim().length > 0) {
            result.push(text.trim());
          }
        }
      }
    }
    return result;
  });

  const responseSizeBytes = JSON.stringify(rawBody).length;

  return ok({
    query,
    suggestions,
    parseDurationMs: durationMs,
    responseSizeBytes,
  });
}
