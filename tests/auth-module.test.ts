/**
 * Phase 5 Auth Module Unit Tests
 * Uses pure in-memory and fake platform adapters.
 * Verifies chunking, SAPISID hashing, session validation, logout, and auth cache scoping.
 */

import { describe, it, expect } from 'vitest';
import { err, TestClock, StreamError, unwrap } from '@/backend/core';
import {
  MemorySecureStore,
  MemoryHttpClient,
  MemoryKeyValueStore,
  MemorySqlDatabase,
  NodeSha1,
} from '@/backend/platform';
import {
  AuthService,
  SessionStore,
  generateSapisidHash,
  deriveAccountId,
  parseCookieString,
  formatCookieHeader,
  SESSION_CHUNK_SIZE,
  KEY_CHUNK_COUNT,
  KEY_CHUNK_PREFIX,
  type AuthSession,
} from '@/backend/auth';
import { InnertubeClient } from '@/backend/innertube';
import { CacheManager, CacheKeyBuilder } from '@/backend/cache';
import { DefaultStreamResolver, type StreamStrategy } from '@/backend/streaming';
import { MusicRepository } from '@/backend/services/music-repository';

describe('Phase 5: Auth Module', () => {
  const sha1 = new NodeSha1();

  describe('Sha1Port (NodeSha1)', () => {
    it('computes correct hex-encoded SHA-1 digest', async () => {
      // Known SHA-1 of "hello world" is 2aae6c35c94fcfb415dbe95f408b9ce91ee846ed
      const digest = await sha1.digestHex('hello world');
      expect(digest).toBe('2aae6c35c94fcfb415dbe95f408b9ce91ee846ed');
    });
  });

  describe('SAPISID Hashing & Cookie Utilities', () => {
    it('generates standard SAPISIDHASH header with timestamp and SHA-1', async () => {
      const sapisid = 'test_sapisid_token_123';
      const origin = 'https://music.youtube.com';
      const timestamp = 1700000000;

      const expectedDigest = await sha1.digestHex(`${timestamp} ${sapisid} ${origin}`);
      const header = await generateSapisidHash(sapisid, sha1, {
        origin,
        timestampSeconds: timestamp,
      });

      expect(header).toBe(`SAPISIDHASH ${timestamp}_${expectedDigest}`);
    });

    it('derives a privacy-preserving account ID without leaking raw cookie data', async () => {
      const accountId1 = await deriveAccountId('token_alice', sha1);
      const accountId2 = await deriveAccountId('token_bob', sha1);

      expect(accountId1).toMatch(/^account_[0-9a-f]{16}$/);
      expect(accountId2).toMatch(/^account_[0-9a-f]{16}$/);
      expect(accountId1).not.toBe(accountId2);
      expect(accountId1).not.toContain('alice');
    });

    it('parses raw cookie string and formats back into Cookie header', () => {
      const raw = 'SID=abc123xyz; HSID=def456; SAPISID=sec789; __Secure-3PSID=ghi000';
      const parsed = parseCookieString(raw);

      expect(parsed).toEqual({
        SID: 'abc123xyz',
        HSID: 'def456',
        SAPISID: 'sec789',
        '__Secure-3PSID': 'ghi000',
      });

      const formatted = formatCookieHeader(parsed);
      expect(formatted).toContain('SID=abc123xyz');
      expect(formatted).toContain('SAPISID=sec789');
    });
  });

  describe('SessionStore (SecureStore Chunking)', () => {
    it('chunks large sessions (> 2048 bytes) into slices <= 1500 chars to avoid Android limit', async () => {
      const secureStore = new MemorySecureStore();
      const store = new SessionStore(secureStore);

      // Create a large session payload (~3500 bytes of cookies)
      const largeCookies: Record<string, string> = {
        SAPISID: 'valid_sapisid_token',
        LONG_COOKIE_1: 'A'.repeat(1200),
        LONG_COOKIE_2: 'B'.repeat(1200),
        LONG_COOKIE_3: 'C'.repeat(800),
      };

      const largeSession: AuthSession = {
        accountId: 'account_large_test',
        cookies: largeCookies,
        cookieHeader: formatCookieHeader(largeCookies),
        sapisid: 'valid_sapisid_token',
        createdAt: 1700000000000,
      };

      const saveRes = await store.save(largeSession);
      expect(saveRes.ok).toBe(true);

      // Verify chunk count was written
      const countRes = await secureStore.get(KEY_CHUNK_COUNT);
      expect(countRes.ok).toBe(true);
      const count = parseInt(unwrap(countRes)!, 10);
      expect(count).toBeGreaterThan(1);

      // Verify each chunk is strictly within the SESSION_CHUNK_SIZE limit
      for (let i = 0; i < count; i++) {
        const chunkRes = await secureStore.get(`${KEY_CHUNK_PREFIX}${i}`);
        expect(chunkRes.ok).toBe(true);
        expect(unwrap(chunkRes)!.length).toBeLessThanOrEqual(SESSION_CHUNK_SIZE);
      }

      // Verify load reassembles the full session perfectly
      const loadRes = await store.load();
      expect(loadRes.ok).toBe(true);
      expect(unwrap(loadRes)).toEqual(largeSession);
    });

    it('cleans up surplus chunks when overwriting with a smaller session', async () => {
      const secureStore = new MemorySecureStore();
      const store = new SessionStore(secureStore);

      // 1. Write large session (3 chunks)
      const largeSession: AuthSession = {
        accountId: 'account_1',
        cookies: { SAPISID: 'token', BIG: 'X'.repeat(3200) },
        cookieHeader: 'SAPISID=token',
        sapisid: 'token',
        createdAt: 100,
      };
      await store.save(largeSession);

      const count1 = parseInt(unwrap(await secureStore.get(KEY_CHUNK_COUNT))!, 10);
      expect(count1).toBeGreaterThanOrEqual(3);

      // 2. Overwrite with small session (1 chunk)
      const smallSession: AuthSession = {
        accountId: 'account_1',
        cookies: { SAPISID: 'token' },
        cookieHeader: 'SAPISID=token',
        sapisid: 'token',
        createdAt: 200,
      };
      await store.save(smallSession);

      const count2 = parseInt(unwrap(await secureStore.get(KEY_CHUNK_COUNT))!, 10);
      expect(count2).toBe(1);

      // Extra chunks from previous session must be deleted
      const oldChunk2 = await secureStore.get(`${KEY_CHUNK_PREFIX}2`);
      expect(unwrap(oldChunk2)).toBeNull();

      const loaded = await store.load();
      expect(loaded.ok).toBe(true);
      expect(unwrap(loaded)).toEqual(smallSession);
    });

    it('clear() deletes all stored session chunks and metadata', async () => {
      const secureStore = new MemorySecureStore();
      const store = new SessionStore(secureStore);

      const session: AuthSession = {
        accountId: 'account_del',
        cookies: { SAPISID: 'token' },
        cookieHeader: 'SAPISID=token',
        sapisid: 'token',
        createdAt: 100,
      };
      await store.save(session);
      expect(unwrap(await store.load())).not.toBeNull();

      const clearRes = await store.clear();
      expect(clearRes.ok).toBe(true);

      const afterClear = await store.load();
      expect(afterClear.ok).toBe(true);
      expect(unwrap(afterClear)).toBeNull();
    });
  });

  describe('AuthService Lifecycle', () => {
    it('rejects cookies missing SAPISID with typed INVALID_COOKIES error', async () => {
      const secureStore = new MemorySecureStore();
      const httpClient = new MemoryHttpClient();
      const auth = new AuthService({ secureStore, sha1, httpClient });

      const res = await auth.setSessionFromCookies({ SID: '123', HSID: '456' });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.reason).toBe('INVALID_COOKIES');
      }
    });

    it('establishes session and generates signed SAPISIDHASH request headers', async () => {
      const secureStore = new MemorySecureStore();
      const httpClient = new MemoryHttpClient();
      const clock = new TestClock(1700000000000);
      const auth = new AuthService({ secureStore, sha1, httpClient, clock });

      const setRes = await auth.setSessionFromCookies({
        SAPISID: 'my_sapisid_secret',
        SID: 'sid_val',
      });
      expect(setRes.ok).toBe(true);
      expect(await auth.isSignedIn()).toBe(true);

      const headersRes = await auth.getAuthHeaders();
      expect(headersRes.ok).toBe(true);
      if (headersRes.ok) {
        const headers = headersRes.value;
        expect(headers.Authorization).toMatch(/^SAPISIDHASH 1700000000_[0-9a-f]{40}$/);
        expect(headers.Cookie).toContain('SAPISID=my_sapisid_secret');
        expect(headers['X-Origin']).toBe('https://music.youtube.com');
      }
    });

    it('returns MISSING_SESSION error when getAuthHeaders is called while signed out', async () => {
      const secureStore = new MemorySecureStore();
      const httpClient = new MemoryHttpClient();
      const auth = new AuthService({ secureStore, sha1, httpClient });

      const res = await auth.getAuthHeaders();
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.reason).toBe('MISSING_SESSION');
      }
    });

    it('validateSession returns ok(true) when server responds with 200', async () => {
      const secureStore = new MemorySecureStore();
      const httpClient = new MemoryHttpClient();
      httpClient.whenPost('https://music.youtube.com/youtubei/v1/browse', {
        responseContext: {},
      });

      const auth = new AuthService({ secureStore, sha1, httpClient });
      await auth.setSessionFromCookies({ SAPISID: 'my_sapisid' });

      const validRes = await auth.validateSession();
      expect(validRes.ok).toBe(true);
      expect(unwrap(validRes)).toBe(true);
    });

    it('validateSession returns typed EXPIRED error when server responds with HTTP 401', async () => {
      const secureStore = new MemorySecureStore();
      const httpClient = new MemoryHttpClient();
      httpClient.whenPost(
        'https://music.youtube.com/youtubei/v1/browse',
        { error: { message: 'Unauthorized' } },
        401,
      );

      const auth = new AuthService({ secureStore, sha1, httpClient });
      await auth.setSessionFromCookies({ SAPISID: 'expired_token' });

      const validRes = await auth.validateSession();
      expect(validRes.ok).toBe(false);
      if (!validRes.ok) {
        expect(validRes.error.reason).toBe('EXPIRED');
      }
    });

    it('logout clears SecureStore, resets memory session, calls cookieJarClearer and onLogout', async () => {
      const secureStore = new MemorySecureStore();
      const httpClient = new MemoryHttpClient();
      let cookieJarCleared = false;
      let onLogoutCalled = false;

      const auth = new AuthService({
        secureStore,
        sha1,
        httpClient,
        cookieJarClearer: async () => {
          cookieJarCleared = true;
        },
        onLogout: async () => {
          onLogoutCalled = true;
        },
      });

      await auth.setSessionFromCookies({ SAPISID: 'token' });
      expect(await auth.isSignedIn()).toBe(true);

      const logoutRes = await auth.logout();
      expect(logoutRes.ok).toBe(true);

      expect(await auth.isSignedIn()).toBe(false);
      expect(unwrap(await secureStore.get(KEY_CHUNK_COUNT))).toBeNull();
      expect(cookieJarCleared).toBe(true);
      expect(onLogoutCalled).toBe(true);
    });
  });

  describe('InnertubeClient Auth Integration', () => {
    it('attaches auth headers and cookies when authService is active', async () => {
      const httpClient = new MemoryHttpClient();
      const secureStore = new MemorySecureStore();
      const auth = new AuthService({ secureStore, sha1, httpClient });
      await auth.setSessionFromCookies({ SAPISID: 'innertube_sapisid', SID: 'sid_123' });

      let capturedHeaders: Record<string, string> = {};
      httpClient.addHandler('POST:https://music.youtube.com/youtubei/v1/search', (_url, options) => {
        capturedHeaders = (options.headers as Record<string, string>) || {};
        return {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          data: { contents: {} },
          durationMs: 1,
        };
      });

      const client = new InnertubeClient({
        httpClient,
        authService: auth,
      });

      await client.getRawSearch('Radiohead');
      expect(capturedHeaders.Authorization).toMatch(/^SAPISIDHASH/);
      expect(capturedHeaders.Cookie).toContain('SAPISID=innertube_sapisid');
      expect(capturedHeaders['X-Origin']).toBe('https://music.youtube.com');
      expect(capturedHeaders['X-Goog-AuthUser']).toBe('0');
    });

    it('resetVisitorData clears in-memory and persistent visitorData', async () => {
      const httpClient = new MemoryHttpClient();
      const keyValueStore = new MemoryKeyValueStore();
      const client = new InnertubeClient({ httpClient, keyValueStore });

      await client.setVisitorData('visitor_token_123');
      expect(await client.getVisitorData()).toBe('visitor_token_123');

      await client.resetVisitorData();
      // Should now be undefined in memory and store
      const storeVal = await keyValueStore.get('ytm_visitor_data');
      expect(unwrap(storeVal)).toBeNull();
    });
  });

  describe('MusicRepository Cache Scoping Isolation', () => {
    it('isolates guest and signed-in responses with distinct cache keys', async () => {
      const httpClient = new MemoryHttpClient();
      const secureStore = new MemorySecureStore();
      const sqlDatabase = new MemorySqlDatabase();
      const clock = new TestClock(1000);

      const cache = new CacheManager({ sqlDatabase, clock });
      const auth = new AuthService({ secureStore, sha1, httpClient });

      let fetchCount = 0;
      httpClient.addHandler('POST:https://music.youtube.com/youtubei/v1/search', () => {
        fetchCount++;
        return {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          data: {
            contents: {
              tabbedSearchResultsRenderer: {
                tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [] } } } }],
              },
            },
          },
          durationMs: 1,
        };
      });

      const innertube = new InnertubeClient({ httpClient, authService: auth });
      const streamResolver = new DefaultStreamResolver({ httpClient, authService: auth });

      const repo = new MusicRepository({
        innertube,
        streamResolver,
        cache,
        authService: auth,
      });

      // 1. Guest search -> uses scope "guest"
      const resGuest1 = await repo.search('Radiohead');
      expect(resGuest1.ok).toBe(true);
      expect(fetchCount).toBe(1);

      // Second guest search hits cache
      const resGuest2 = await repo.search('Radiohead');
      expect(resGuest2.ok).toBe(true);
      expect(fetchCount).toBe(1);

      // 2. Sign in as user
      await auth.setSessionFromCookies({ SAPISID: 'user_cookie_abc' });
      const session = unwrap(await auth.getSession())!;
      expect(session.accountId).toMatch(/^account_/);

      // Authenticated search MUST NOT share the guest cache entry!
      const resUser1 = await repo.search('Radiohead');
      expect(resUser1.ok).toBe(true);
      expect(fetchCount).toBe(2); // Network fetch because scope is user:<id>, not guest!

      // Second user search hits user-scoped cache
      const resUser2 = await repo.search('Radiohead');
      expect(resUser2.ok).toBe(true);
      expect(fetchCount).toBe(2);

      // Verify keys in cache
      const guestKey = CacheKeyBuilder.search('Radiohead', 'all', 'guest');
      const userKey = CacheKeyBuilder.search('Radiohead', 'all', `user:${session.accountId}`);

      expect((await cache.get(guestKey)).isHit).toBe(true);
      expect((await cache.get(userKey)).isHit).toBe(true);
    });
  });

  describe('Authenticated Stream Strategy Fallback', () => {
    it('falls back to AuthenticatedStreamStrategy when guest strategy fails with recoverableWithAuth', async () => {
      const httpClient = new MemoryHttpClient();
      const secureStore = new MemorySecureStore();
      const auth = new AuthService({ secureStore, sha1, httpClient });

      // Sign in user
      await auth.setSessionFromCookies({ SAPISID: 'valid_sapisid' });

      // Mock fake guest strategy that fails with recoverableWithAuth = true (e.g. age-restricted)
      const fakeGuestStrategy: StreamStrategy = {
        name: 'guest-mock',
        resolve: async (videoId: string) =>
          err(
            new StreamError(
              'Sign in to confirm age',
              videoId,
              'LOGIN_REQUIRED',
              undefined,
              undefined,
              true, // recoverableWithAuth
            ),
          ),
      };

      // Mock player response for AuthenticatedStreamStrategy
      httpClient.whenPost('https://music.youtube.com/youtubei/v1/player', {
        playabilityStatus: { status: 'OK' },
        streamingData: {
          adaptiveFormats: [
            {
              itag: 251,
              mimeType: 'audio/webm; codecs="opus"',
              bitrate: 160000,
              url: 'https://example.com/audio.opus',
            },
          ],
        },
      });

      const resolver = new DefaultStreamResolver({
        httpClient,
        authService: auth,
        strategies: [fakeGuestStrategy],
      });

      const res = await resolver.resolve('age_restricted_18');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.strategyName).toBe('authenticated-visionos');
        expect(res.value.stream.codec).toBe('opus');
        expect(res.value.stream.bitrate).toBe(160000);
      }
    });

    it('returns recoverableWithAuth error if user is NOT signed in', async () => {
      const httpClient = new MemoryHttpClient();
      const secureStore = new MemorySecureStore();
      const auth = new AuthService({ secureStore, sha1, httpClient }); // Not signed in

      const fakeGuestStrategy: StreamStrategy = {
        name: 'guest-mock',
        resolve: async (videoId: string) =>
          err(
            new StreamError(
              'Sign in to confirm age',
              videoId,
              'LOGIN_REQUIRED',
              undefined,
              undefined,
              true, // recoverableWithAuth
            ),
          ),
      };

      const resolver = new DefaultStreamResolver({
        httpClient,
        authService: auth,
        strategies: [fakeGuestStrategy],
      });

      const res = await resolver.resolve('age_restricted_18');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.recoverableWithAuth).toBe(true);
      }
    });
  });
});
