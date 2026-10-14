/**
 * Main AuthService coordinating session lifecycle, SecureStore chunking,
 * SAPISIDHASH request header signing, session validation, and logout.
 */

import {
  type Result,
  type Clock,
  type Logger,
  SystemClock,
  createLogger,
  ok,
  err,
  isOk,
  AuthError,
} from '@/backend/core';
import type { SecureStore, HttpClient, Sha1Port } from '@/backend/platform';
import {
  type AuthSession,
  type CookieJarClearer,
  parseCookieString,
  formatCookieHeader,
} from './types';
import { SessionStore } from './session-store';
import {
  generateSapisidHash,
  deriveAccountId,
  YOUTUBE_MUSIC_ORIGIN,
} from './sapisid-hasher';

export interface AuthServiceConfig {
  secureStore: SecureStore;
  sha1: Sha1Port;
  httpClient: HttpClient;
  clock?: Clock;
  logger?: Logger;
  cookieJarClearer?: CookieJarClearer;
  onLogout?: () => Promise<void>;
}

export class AuthService {
  private readonly sessionStore: SessionStore;
  private readonly sha1: Sha1Port;
  private readonly httpClient: HttpClient;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly cookieJarClearer?: CookieJarClearer;
  private readonly onLogoutCallback?: () => Promise<void>;

  private cachedSession: AuthSession | null = null;
  private isLoaded = false;

  constructor(config: AuthServiceConfig) {
    this.sessionStore = new SessionStore(config.secureStore);
    this.sha1 = config.sha1;
    this.httpClient = config.httpClient;
    this.clock = config.clock ?? new SystemClock();
    this.logger = config.logger ?? createLogger({ prefix: 'AuthService' });
    this.cookieJarClearer = config.cookieJarClearer;
    this.onLogoutCallback = config.onLogout;
  }

  /**
   * Retrieves the current session (from in-memory cache or SecureStore).
   */
  async getSession(): Promise<Result<AuthSession | null, AuthError>> {
    if (this.isLoaded) {
      return ok(this.cachedSession);
    }

    const loadRes = await this.sessionStore.load();
    if (!loadRes.ok) {
      return loadRes;
    }

    this.cachedSession = loadRes.value;
    this.isLoaded = true;
    return ok(this.cachedSession);
  }

  /**
   * Checks whether an active session currently exists.
   */
  async isSignedIn(): Promise<boolean> {
    const res = await this.getSession();
    return isOk(res) && res.value !== null;
  }

  /**
   * Creates and persists an AuthSession from raw cookies (either key-value map or cookie string).
   * Extracts and validates SAPISID, derives account ID, and chunks into SecureStore.
   */
  async setSessionFromCookies(
    cookiesInput: Record<string, string> | string,
  ): Promise<Result<AuthSession, AuthError>> {
    try {
      const cookieMap =
        typeof cookiesInput === 'string'
          ? parseCookieString(cookiesInput)
          : { ...cookiesInput };

      // Look for SAPISID (standard or secure variants)
      const sapisid =
        cookieMap['SAPISID'] ||
        cookieMap['__Secure-3PAPISID'] ||
        cookieMap['__Secure-PAPISID'];

      if (!sapisid) {
        return err(
          new AuthError(
            'Missing required SAPISID cookie in provided cookie set',
            'INVALID_COOKIES',
          ),
        );
      }

      const accountId = await deriveAccountId(sapisid, this.sha1);
      const cookieHeader = formatCookieHeader(cookieMap);

      const session: AuthSession = {
        accountId,
        cookies: cookieMap,
        cookieHeader,
        sapisid,
        createdAt: this.clock.now(),
      };

      const saveRes = await this.sessionStore.save(session);
      if (!saveRes.ok) {
        return saveRes;
      }

      this.cachedSession = session;
      this.isLoaded = true;

      this.logger.info('Session successfully established and stored', {
        accountId,
      });

      return ok(session);
    } catch (caught) {
      return err(
        new AuthError(
          `Unexpected error setting session: ${caught instanceof Error ? caught.message : String(caught)}`,
          'STORAGE_ERROR',
          undefined,
          caught,
        ),
      );
    }
  }

  /**
   * Generates signed request headers for authenticated InnerTube API calls.
   */
  async getAuthHeaders(origin = YOUTUBE_MUSIC_ORIGIN): Promise<Result<Record<string, string>, AuthError>> {
    const sessionRes = await this.getSession();
    if (!sessionRes.ok) {
      return sessionRes;
    }

    const session = sessionRes.value;
    if (!session) {
      return err(new AuthError('No active authentication session', 'MISSING_SESSION'));
    }

    try {
      const authHeader = await generateSapisidHash(session.sapisid, this.sha1, {
        origin,
        timestampSeconds: Math.floor(this.clock.now() / 1000),
      });

      return ok({
        Authorization: authHeader,
        Cookie: session.cookieHeader,
        'X-Origin': origin,
        'X-Goog-AuthUser': '0',
      });
    } catch (caught) {
      return err(
        new AuthError(
          `Failed to generate SAPISIDHASH auth headers: ${caught instanceof Error ? caught.message : String(caught)}`,
          'NETWORK_ERROR',
          undefined,
          caught,
        ),
      );
    }
  }

  /**
   * Validates the active session against YouTube Music using a real authenticated request.
   * Returns ok(true) if valid, or err(AuthError) with code SESSION_EXPIRED if invalid/expired.
   */
  async validateSession(): Promise<Result<boolean, AuthError>> {
    const headersRes = await this.getAuthHeaders();
    if (!headersRes.ok) {
      return headersRes;
    }

    try {
      const url = `${YOUTUBE_MUSIC_ORIGIN}/youtubei/v1/browse`;
      const body = {
        context: {
          client: {
            clientName: 'WEB_REMIX',
            clientVersion: '1.20240101.01.00',
            hl: 'en',
            gl: 'US',
          },
        },
        browseId: 'FEmusic_home',
      };

      const res = await this.httpClient.post<Record<string, unknown>>(url, body, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
          ...headersRes.value,
        },
        timeoutMs: 10000,
      });

      if (!res.ok) {
        if (res.error.statusCode === 401 || res.error.statusCode === 403) {
          this.logger.warn('Session validation failed with HTTP 401/403: session expired');
          return err(
            new AuthError(
              `Session expired: server responded with HTTP ${res.error.statusCode}`,
              'EXPIRED',
              undefined,
              res.error,
            ),
          );
        }
        return err(
          new AuthError(
            `Session validation network error: ${res.error.message}`,
            'VALIDATION_FAILED',
            undefined,
            res.error,
          ),
        );
      }

      // Check if response contains an error or login prompt payload
      const data = res.value.data;
      if (data && typeof data === 'object' && 'error' in data) {
        return err(
          new AuthError('Session rejected by server payload', 'EXPIRED', {
            errorPayload: data.error,
          }),
        );
      }

      this.logger.info('Session validated successfully');
      return ok(true);
    } catch (caught) {
      return err(
        new AuthError(
          `Unexpected error validating session: ${caught instanceof Error ? caught.message : String(caught)}`,
          'VALIDATION_FAILED',
          undefined,
          caught,
        ),
      );
    }
  }

  /**
   * Logs out:
   * 1. Clears chunked stored cookies from SecureStore
   * 2. Clears in-memory session
   * 3. Clears the WebView cookie jar if clearer provided
   * 4. Calls onLogout callback (clearing user-scoped cache and resetting visitorData)
   */
  async logout(): Promise<Result<void, AuthError>> {
    try {
      this.logger.info('Performing logout...');

      // 1. Clear stored cookies
      const clearRes = await this.sessionStore.clear();
      if (!clearRes.ok) {
        this.logger.warn('Failed to completely clear SecureStore during logout', {
          error: clearRes.error.message,
        });
      }

      // 2. Clear in-memory state
      this.cachedSession = null;
      this.isLoaded = true;

      // 3. Clear native WebView cookie jar
      if (this.cookieJarClearer) {
        try {
          await this.cookieJarClearer();
          this.logger.info('Native cookie jar cleared');
        } catch (cookieErr) {
          this.logger.warn('Failed to clear native cookie jar', {
            error: String(cookieErr),
          });
        }
      }

      // 4. Trigger onLogout callback (cache.clearUserScopedData + reset visitorData)
      if (this.onLogoutCallback) {
        try {
          await this.onLogoutCallback();
          this.logger.info('onLogout callback completed (cache and visitorData reset)');
        } catch (cbErr) {
          this.logger.warn('Error in onLogout callback', {
            error: String(cbErr),
          });
        }
      }

      this.logger.info('Logout completed successfully');
      return ok(undefined);
    } catch (caught) {
      return err(
        new AuthError(
          `Unexpected error during logout: ${caught instanceof Error ? caught.message : String(caught)}`,
          'STORAGE_ERROR',
          undefined,
          caught,
        ),
      );
    }
  }
}
