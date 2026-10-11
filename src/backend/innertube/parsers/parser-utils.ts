/**
 * Shared defensive parsing utilities for InnerTube responses.
 */

import { z } from 'zod';
import type { Thumbnail } from '@/backend/core';

export const ThumbnailItemSchema = z.object({
  url: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
});

export function runsToText(runs?: unknown): string {
  if (!Array.isArray(runs)) return '';
  return runs
    .map((r) =>
      r && typeof r === 'object' && typeof (r as { text?: unknown }).text === 'string'
        ? (r as { text: string }).text
        : '',
    )
    .join('');
}

export function parseDuration(text?: string): number | undefined {
  if (!text) return undefined;
  const parts = text
    .trim()
    .split(':')
    .map((p) => Number.parseInt(p, 10));
  if (parts.some((p) => Number.isNaN(p))) return undefined;
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return undefined;
}

export function extractThumbnails(rawObj: unknown): Thumbnail[] {
  if (!rawObj || typeof rawObj !== 'object') return [];
  const obj = rawObj as Record<string, unknown>;
  const list = Array.isArray(obj.thumbnails)
    ? obj.thumbnails
    : Array.isArray((obj.thumbnail as Record<string, unknown> | undefined)?.thumbnails)
      ? (obj.thumbnail as Record<string, unknown>).thumbnails
      : Array.isArray(
            (
              (obj.musicThumbnailRenderer as Record<string, unknown> | undefined)
                ?.thumbnail as Record<string, unknown> | undefined
            )?.thumbnails,
          )
        ? (
            (obj.musicThumbnailRenderer as Record<string, unknown>).thumbnail as Record<
              string,
              unknown
            >
          ).thumbnails
        : [];

  const parsed: Thumbnail[] = [];
  if (Array.isArray(list)) {
    for (const item of list) {
      const res = ThumbnailItemSchema.safeParse(item);
      if (res.success && res.data.url) {
        parsed.push({
          url: res.data.url,
          width: res.data.width,
          height: res.data.height,
        });
      }
    }
  }
  return parsed;
}

export function extractVideoId(obj: unknown): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const record = obj as Record<string, unknown>;

  if (record.watchEndpoint && typeof record.watchEndpoint === 'object') {
    const we = record.watchEndpoint as { videoId?: unknown };
    if (typeof we.videoId === 'string' && we.videoId.length > 0) {
      return we.videoId;
    }
  }

  // Fast path for common wrappers
  if (record.musicPlayButtonRenderer) {
    const v = extractVideoId(record.musicPlayButtonRenderer);
    if (v) return v;
  }
  if (record.playNavigationEndpoint) {
    const v = extractVideoId(record.playNavigationEndpoint);
    if (v) return v;
  }
  if (record.navigationEndpoint) {
    const v = extractVideoId(record.navigationEndpoint);
    if (v) return v;
  }
  if (record.onTap) {
    const v = extractVideoId(record.onTap);
    if (v) return v;
  }

  // Recursive search
  for (const key of Object.keys(record)) {
    const val = record[key];
    if (val && typeof val === 'object') {
      const found = extractVideoId(val);
      if (found) return found;
    }
  }

  return undefined;
}

export function extractBrowseId(obj: unknown): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const record = obj as Record<string, unknown>;

  if (record.browseEndpoint && typeof record.browseEndpoint === 'object') {
    const be = record.browseEndpoint as { browseId?: unknown };
    if (typeof be.browseId === 'string' && be.browseId.length > 0) {
      return be.browseId;
    }
  }

  // Fast path for common wrappers
  if (record.navigationEndpoint) {
    const b = extractBrowseId(record.navigationEndpoint);
    if (b) return b;
  }

  // Recursive search
  for (const key of Object.keys(record)) {
    const val = record[key];
    if (val && typeof val === 'object') {
      const found = extractBrowseId(val);
      if (found) return found;
    }
  }

  return undefined;
}
