/**
 * LRC (Lyrics) format parser.
 * Supports standard [mm:ss.xx] and extended [mm:ss.xxx] timestamps,
 * multi-timestamp lines, metadata tag parsing, [offset:+/-ms], and chronological sorting.
 */

import type { LyricLine } from './types';

const TIMESTAMP_REGEX = /\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g;
const OFFSET_REGEX = /^\[offset:\s*([+-]?\d+)\s*\]/i;
const METADATA_TAG_REGEX = /^\[[a-zA-Z]{2,10}:.*\]$/;

export interface ParsedLrc {
  lines: LyricLine[];
  offsetMs: number;
  metadata: Record<string, string>;
}

export function parseLrc(rawLrc: string): ParsedLrc {
  if (!rawLrc || typeof rawLrc !== 'string') {
    return { lines: [], offsetMs: 0, metadata: {} };
  }

  const rawLines = rawLrc.split(/\r?\n/);
  const metadata: Record<string, string> = {};
  let offsetMs = 0;

  // First pass: extract offset and metadata tags
  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const offsetMatch = trimmed.match(OFFSET_REGEX);
    if (offsetMatch) {
      const parsedOffset = parseInt(offsetMatch[1], 10);
      if (!Number.isNaN(parsedOffset)) {
        offsetMs = parsedOffset;
      }
      continue;
    }

    if (METADATA_TAG_REGEX.test(trimmed)) {
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 1) {
        const key = trimmed.slice(1, colonIdx).trim().toLowerCase();
        const value = trimmed.slice(colonIdx + 1, -1).trim();
        metadata[key] = value;
      }
    }
  }

  // Second pass: extract timestamped lyric lines
  const lines: LyricLine[] = [];

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Skip metadata tag-only lines
    if (OFFSET_REGEX.test(trimmed) || METADATA_TAG_REGEX.test(trimmed)) {
      continue;
    }

    // Match all timestamps on the line
    const matches = Array.from(trimmed.matchAll(TIMESTAMP_REGEX));
    if (matches.length === 0) {
      continue;
    }

    // The lyric text is the remaining line without any timestamp tags
    const text = trimmed.replace(TIMESTAMP_REGEX, '').trim();

    for (const match of matches) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      let millis = 0;

      if (match[3]) {
        const fracStr = match[3];
        if (fracStr.length === 1) {
          millis = parseInt(fracStr, 10) * 100;
        } else if (fracStr.length === 2) {
          millis = parseInt(fracStr, 10) * 10;
        } else {
          millis = parseInt(fracStr.slice(0, 3), 10);
        }
      }

      const rawTimestamp = minutes * 60 * 1000 + seconds * 1000 + millis;
      const adjustedTimestamp = Math.max(0, rawTimestamp + offsetMs);

      lines.push({
        startTimeMs: adjustedTimestamp,
        text,
      });
    }
  }

  // Sort lines chronologically
  lines.sort((a, b) => a.startTimeMs - b.startTimeMs);

  return {
    lines,
    offsetMs,
    metadata,
  };
}
