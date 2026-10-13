/**
 * Auth module types, contracts, and error definitions.
 * Strict TypeScript with zero secrets logged or printed.
 */

import { z } from 'zod';
import type { AuthErrorReason } from '@/backend/core';

export type AuthErrorCode = AuthErrorReason;

export const AuthSessionSchema = z.object({
  accountId: z.string().min(1),
  cookies: z.record(z.string(), z.string()),
  cookieHeader: z.string().min(1),
  sapisid: z.string().min(1),
  createdAt: z.number(),
  expiresAt: z.number().optional(),
});

export type AuthSession = z.infer<typeof AuthSessionSchema>;

export type CookieJarClearer = () => Promise<void>;

export interface AuthServiceOptions {
  onLogout?: () => Promise<void>;
  cookieJarClearer?: CookieJarClearer;
}

/**
 * Parses a cookie string (e.g. `foo=bar; baz=qux`) into a key-value record.
 */
export function parseCookieString(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!raw || typeof raw !== 'string') return result;

  const parts = raw.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const equalIdx = trimmed.indexOf('=');
    if (equalIdx > 0) {
      const name = trimmed.slice(0, equalIdx).trim();
      const value = trimmed.slice(equalIdx + 1).trim();
      if (name && value) {
        result[name] = value;
      }
    }
  }
  return result;
}

/**
 * Formats a key-value record of cookies into a standard HTTP Cookie header string.
 */
export function formatCookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .filter(([k, v]) => Boolean(k) && Boolean(v))
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}
