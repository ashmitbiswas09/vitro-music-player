/**
 * Utility to strip noisy suffixes and visual tags from YouTube track titles
 * before querying external lyric databases (e.g. LRCLIB).
 */

const REMOVE_PARENTHESES_BRACKETS_REGEX =
  /[([][\s]*(?:official\s+)?(?:music\s+)?(?:video|audio|visualizer|lyric\s+video|lyrics|hd|4k|remastered(?:\s+\d{4})?|live(?:\s+at[^)\]]*)?)[\s]*[)\]]/gi;

const FEATURING_REGEX = /[([][\s]*(?:feat|ft)\.?\s+[^)\]]+[)\]]|\b(?:feat|ft)\.?\s+.*$/gi;

export function cleanTrackTitle(title: string): string {
  if (!title || typeof title !== 'string') return '';

  let cleaned = title;

  // 1. Remove bracketed / parenthesized video & audio annotations
  cleaned = cleaned.replace(REMOVE_PARENTHESES_BRACKETS_REGEX, ' ');

  // 2. Remove "feat." / "ft." artists from title
  cleaned = cleaned.replace(FEATURING_REGEX, ' ');

  // 3. Remove trailing dashes, pipes, or punctuation leftover
  cleaned = cleaned.replace(/[-|/:]\s*$/, ' ');

  // 4. Collapse multiple spaces and trim
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // If cleaning stripped everything, fall back to the original title
  return cleaned.length > 0 ? cleaned : title.trim();
}
