/**
 * SAPISIDHASH signature generator for YouTube authenticated endpoints.
 * Formula: sha1(`${timestampInSeconds} ${sapisid} ${origin}`)
 */

import type { Sha1Port } from '@/backend/platform';

export const YOUTUBE_MUSIC_ORIGIN = 'https://music.youtube.com';

/**
 * Generates the `Authorization: SAPISIDHASH <timestamp>_<digest>` header value.
 */
export async function generateSapisidHash(
  sapisid: string,
  sha1: Sha1Port,
  options?: {
    origin?: string;
    timestampSeconds?: number;
  },
): Promise<string> {
  const origin = options?.origin ?? YOUTUBE_MUSIC_ORIGIN;
  const timestamp = options?.timestampSeconds ?? Math.floor(Date.now() / 1000);
  const message = `${timestamp} ${sapisid} ${origin}`;
  const digest = await sha1.digestHex(message);
  return `SAPISIDHASH ${timestamp}_${digest}`;
}

/**
 * Derives a deterministic, privacy-preserving account ID from session cookies.
 * Does NOT contain or expose any raw tokens or personal data.
 */
export async function deriveAccountId(
  sapisid: string,
  sha1: Sha1Port,
): Promise<string> {
  const hash = await sha1.digestHex(`account_id_${sapisid}`);
  return `account_${hash.slice(0, 16)}`;
}
