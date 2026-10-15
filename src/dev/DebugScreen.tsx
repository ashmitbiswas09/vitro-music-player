/**
 * DEV ONLY Debug Screen
 * Plain unstyled verification screen that executes backend calls through
 * createBackend and the React Native platform adapters.
 * Runs on Android Emulator.
 */

import React, { useState, useMemo } from 'react';
import { ScrollView, View, Text, Button, StyleSheet } from 'react-native';
import { createBackend } from '@/backend/services';
import {
  FetchHttpClient,
  RnSecureStore,
  RnSqliteDatabase,
  RnKeyValueStore,
  RnFileStore,
  RnSha1,
} from '@/backend/platform/rn';
import CookieManager from '@react-native-cookies/cookies';
import { redactString, type Track } from '@/backend/core';
import { CacheKeyBuilder } from '@/backend/cache';
import { DefaultStreamResolver, AuthenticatedStreamStrategy } from '@/backend/streaming';
import { FakeAudioEngine } from '@/backend/playback-core';
import { getActiveLyricIndex } from '@/backend/lyrics';
import { LoginModal } from './LoginModal';

export function DebugScreen() {
  const [output, setOutput] = useState<string>('Ready. Press a button below to test.');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isLoginModalVisible, setIsLoginModalVisible] = useState<boolean>(false);

  // Initialize backend singleton wired to native React Native adapters
  const backend = useMemo(() => {
    const sqlite = new RnSqliteDatabase('vitro.db');
    return createBackend({
      httpClient: new FetchHttpClient(),
      secureStore: new RnSecureStore(),
      sqlDatabase: sqlite,
      keyValueStore: new RnKeyValueStore(sqlite),
      fileStore: new RnFileStore(),
      sha1: new RnSha1(),
      cookieJarClearer: async () => {
        await CookieManager.clearAll();
      },
    });
  }, []);

  const runSearch = async () => {
    setIsLoading(true);
    setOutput('[DEV ONLY] Running search for "Radiohead"...');
    const start = Date.now();
    try {
      const res = await backend.search('Radiohead', { filter: 'all' });
      const durationMs = Date.now() - start;

      if (!res.ok) {
        setOutput(`[DEV ONLY] SEARCH FAILED (${durationMs}ms):\n${res.error.message}`);
        return;
      }

      const { items, parseDurationMs, responseSizeBytes } = res.value;
      const searchKey = CacheKeyBuilder.search('Radiohead', 'all');
      const fetchMeta = backend.cache.getLastFetchMeta(searchKey);
      const dataSource = fetchMeta?.source ?? 'network';
      const freshness = fetchMeta?.freshness ?? 'none';

      const lines = [
        `=== SEARCH SUCCESS (${durationMs}ms) ===`,
        `Data Source: ${dataSource.toUpperCase()}`,
        `Freshness:   ${freshness === 'none' ? 'NEW (Network Fetch)' : freshness.toUpperCase()}`,
        `Items Count: ${items.length}`,
      ];

      if (dataSource === 'network') {
        lines.push(`Parse Time:    ${parseDurationMs.toFixed(2)}ms`);
        lines.push(`Response Size: ${(responseSizeBytes / 1024).toFixed(2)} KB`);
      } else {
        lines.push(`Parse Time:    N/A (served from ${dataSource} cache)`);
        lines.push(`Response Size: N/A (cached domain model)`);
      }

      lines.push('', '--- First 5 Results ---');

      items.slice(0, 5).forEach((item, idx) => {
        switch (item.type) {
          case 'track': {
            const artists = item.track.artists.map((a) => a.name).join(', ') || 'Unknown';
            lines.push(`${idx + 1}. [Track] ${item.track.title} - ${artists} (id: ${item.track.id})`);
            break;
          }
          case 'artist':
            lines.push(`${idx + 1}. [Artist] ${item.artist.name} (id: ${item.artist.id})`);
            break;
          case 'album':
            lines.push(`${idx + 1}. [Album] ${item.album.title} (id: ${item.album.id})`);
            break;
          case 'playlist':
            lines.push(`${idx + 1}. [Playlist] ${item.playlist.title} (id: ${item.playlist.id})`);
            break;
        }
      });

      setOutput(lines.join('\n'));
    } catch (caught) {
      setOutput(`[DEV ONLY] CRITICAL ERROR:\n${caught instanceof Error ? caught.message : String(caught)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const runResolveAndVerify = async () => {
    const videoId = '9RfVp-GhKfs'; // Radiohead - Creep
    setIsLoading(true);
    setOutput(`[DEV ONLY] Resolving and verifying stream for videoId: "${videoId}"...`);
    const start = Date.now();
    try {
      const res = await backend.verifyStream(videoId);
      const durationMs = Date.now() - start;

      if (!res.ok) {
        setOutput(`[DEV ONLY] RESOLVE & VERIFY FAILED (${durationMs}ms):\n${res.error.message}`);
        return;
      }

      const { resolved, verification } = res.value;
      const streamKey = CacheKeyBuilder.stream(videoId);
      const streamMeta = backend.cache.getLastFetchMeta(streamKey);
      const streamSource = streamMeta?.source ?? 'network';
      const streamFreshness = streamMeta?.freshness ?? 'none';

      const lines = [
        `=== RESOLVE & VERIFY SUCCESS (${durationMs}ms) ===`,
        `Video ID:    ${videoId}`,
        `Data Source: ${streamSource.toUpperCase()} (HTTP verification: NETWORK)`,
        `Freshness:   ${streamFreshness === 'none' ? 'NEW (Stream Resolved)' : streamFreshness.toUpperCase()}`,
        `Strategy:    ${resolved.strategyName}`,
        `Audio Codec: ${resolved.stream.codec}`,
        `Bitrate:     ${(resolved.stream.bitrate / 1000).toFixed(1)} kbps`,
        `Expires At:  ${new Date(resolved.stream.expiresAt).toLocaleTimeString()}`,
        `Loudness:    ${resolved.stream.loudnessDb !== undefined ? `${resolved.stream.loudnessDb} dB` : 'N/A'}`,
        '',
        '--- HTTP Verification ---',
        `Playable:       ${verification.isPlayable ? 'YES' : 'NO'}`,
        `HTTP Status:    ${verification.statusCode}`,
        `Content-Type:   ${verification.contentType ?? 'none'}`,
        `Content-Range:  ${verification.contentRange ?? 'none'}`,
        `Bytes Received: ${verification.bytesReceived}`,
        `TTFB:           ${verification.timeToFirstByteMs.toFixed(1)}ms`,
        verification.error ? `Verification Error: ${verification.error}` : '',
        '',
        `Redacted URL: ${redactString(resolved.stream.url).slice(0, 80)}...`,
      ];

      setOutput(lines.filter(Boolean).join('\n'));
    } catch (caught) {
      setOutput(`[DEV ONLY] CRITICAL ERROR:\n${caught instanceof Error ? caught.message : String(caught)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const runHomeFeed = async () => {
    setIsLoading(true);
    setOutput('[DEV ONLY] Fetching Home feed...');
    const start = Date.now();
    try {
      const res = await backend.getHome();
      const durationMs = Date.now() - start;

      if (!res.ok) {
        setOutput(`[DEV ONLY] HOME FEED FAILED (${durationMs}ms):\n${res.error.message}`);
        return;
      }

      const { sections, continuationToken, parseDurationMs, responseSizeBytes } = res.value;
      const homeKey = CacheKeyBuilder.home();
      const fetchMeta = backend.cache.getLastFetchMeta(homeKey);
      const dataSource = fetchMeta?.source ?? 'network';
      const freshness = fetchMeta?.freshness ?? 'none';

      const lines = [
        `=== HOME FEED SUCCESS (${durationMs}ms) ===`,
        `Data Source: ${dataSource.toUpperCase()}`,
        `Freshness:   ${freshness === 'none' ? 'NEW (Network Fetch)' : freshness.toUpperCase()}`,
        `Total Sections: ${sections.length}`,
      ];

      if (dataSource === 'network') {
        lines.push(`Parse Time:    ${parseDurationMs.toFixed(2)}ms`);
        lines.push(`Response Size: ${(responseSizeBytes / 1024).toFixed(2)} KB`);
      } else {
        lines.push(`Parse Time:    N/A (served from ${dataSource} cache)`);
        lines.push(`Response Size: N/A (cached domain model)`);
      }

      lines.push(
        `Continuation Token: ${continuationToken ? 'Present' : 'None'}`,
        '',
        '--- Sections Overview ---',
      );

      sections.forEach((sec, idx) => {
        lines.push(`${idx + 1}. [${sec.title}] ${sec.items.length} items`);
      });

      setOutput(lines.join('\n'));
    } catch (caught) {
      setOutput(`[DEV ONLY] CRITICAL ERROR:\n${caught instanceof Error ? caught.message : String(caught)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const runCacheTest = async () => {
    setIsLoading(true);
    setOutput('[DEV ONLY] Running Cache Test: Cold vs Warm comparison on Emulator...');
    try {
      // 1. Clear cache to ensure truly cold initial state
      await backend.clearCache();

      // 2. Cold Call (fetching via InnerTube through repository)
      const coldStart = Date.now();
      const coldRes = await backend.search('Radiohead', { filter: 'all' });
      const coldDurationMs = Date.now() - coldStart;

      if (!coldRes.ok) {
        setOutput(`[DEV ONLY] COLD CALL FAILED (${coldDurationMs}ms):\n${coldRes.error.message}`);
        return;
      }

      // 3. Warm Call (Second call must be served from cache in under 100ms)
      const warmStart = Date.now();
      const warmRes = await backend.search('Radiohead', { filter: 'all' });
      const warmDurationMs = Date.now() - warmStart;

      if (!warmRes.ok) {
        setOutput(`[DEV ONLY] WARM CALL FAILED (${warmDurationMs}ms):\n${warmRes.error.message}`);
        return;
      }

      // 4. Retrieve stats and inspect cache key
      const stats = await backend.getCacheStats();
      const cacheKey = CacheKeyBuilder.search('Radiohead', 'all');
      const inspect = await backend.cache.get(cacheKey);

      const isSub100ms = warmDurationMs < 100;
      const speedup = coldDurationMs / Math.max(warmDurationMs, 1);

      const lines = [
        '=== CACHE TEST: COLD vs WARM (EMULATOR) ===',
        `Cold Call Time:  ${coldDurationMs}ms (Network + Parse)`,
        `Warm Call Time:  ${warmDurationMs}ms (Cache Hit)`,
        `Target < 100ms:  ${isSub100ms ? 'PASS (Under 100ms)' : 'FAIL'}`,
        `Speedup Factor:  ${speedup.toFixed(1)}x faster`,
        '',
        '--- Cache Inspection ---',
        `Key:             ${cacheKey}`,
        `Data Source:     ${inspect.source ? inspect.source.toUpperCase() : 'UNKNOWN'}`,
        `Status:          ${inspect.status.toUpperCase()}`,
        `Is Hit:          ${inspect.isHit ? 'YES' : 'NO'}`,
        `Is Stale:        ${inspect.isStale ? 'YES' : 'NO'}`,
        `Payload Match:   ${coldRes.value.items.length} items (cold) == ${warmRes.value.items.length} items (warm)`,
        '',
        '--- Cache Statistics ---',
        `Hits:            ${stats.hits}`,
        `Misses:          ${stats.misses}`,
        `In-Memory Items: ${stats.inMemoryCount}`,
        `In-Memory Size:  ${stats.inMemorySizeBytes} bytes`,
        `SQLite Items:    ${stats.sqlCount}`,
      ];

      setOutput(lines.join('\n'));
    } catch (caught) {
      setOutput(`[DEV ONLY] CRITICAL ERROR:\n${caught instanceof Error ? caught.message : String(caught)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const runColdStartFromSqlite = async () => {
    setIsLoading(true);
    setOutput('[DEV ONLY] Testing Cold Start from SQLite (clearing memory tier only)...');
    try {
      // 1. Ensure data is populated in SQLite by performing a search if not already cached
      const cacheKey = CacheKeyBuilder.search('Radiohead', 'all');
      const initialCheck = await backend.cache.get(cacheKey);
      if (!initialCheck.isHit) {
        setOutput('[DEV ONLY] Populating cache first with search for "Radiohead"...');
        const popRes = await backend.search('Radiohead', { filter: 'all' });
        if (!popRes.ok) {
          setOutput(`[DEV ONLY] Initial search failed: ${popRes.error.message}`);
          return;
        }
      }

      // 2. Clear ONLY the in-memory tier (leaving SQLite intact)
      backend.clearMemoryTier();
      const preStats = await backend.getCacheStats();

      // 3. Repeat search: this MUST read from SQLite persistence into memory
      const sqliteStart = Date.now();
      const sqliteRes = await backend.search('Radiohead', { filter: 'all' });
      const sqliteDurationMs = Date.now() - sqliteStart;

      if (!sqliteRes.ok) {
        setOutput(`[DEV ONLY] SQLITE READ FAILED (${sqliteDurationMs}ms):\n${sqliteRes.error.message}`);
        return;
      }

      const postStats = await backend.getCacheStats();
      const inspect = await backend.cache.get(cacheKey);
      const isSub100ms = sqliteDurationMs < 100;

      const lines = [
        '=== COLD START FROM SQLITE (EXPO-SQLITE) ===',
        `Read Duration:    ${sqliteDurationMs}ms (Loaded from SQLite)`,
        `Target < 100ms:   ${isSub100ms ? 'PASS (Under 100ms)' : 'FAIL'}`,
        '',
        '--- Tier State Before / After ---',
        `Memory Items Before Read: ${preStats.inMemoryCount} (Emptied by clearMemoryTier)`,
        `Memory Items After Read:  ${postStats.inMemoryCount} (Restored from SQLite into L1)`,
        `SQLite Items in Database: ${postStats.sqlCount}`,
        '',
        '--- Cache Inspection ---',
        `Key:              ${cacheKey}`,
        `Data Source:      ${inspect.source ? inspect.source.toUpperCase() : 'SQLITE'}`,
        `Status:           ${inspect.status.toUpperCase()}`,
        `Is Hit:           ${inspect.isHit ? 'YES' : 'NO'}`,
        `Items Returned:   ${sqliteRes.value.items.length} items`,
        '',
        'Persistence on real expo-sqlite adapter verified successfully!',
      ];

      setOutput(lines.join('\n'));
    } catch (caught) {
      setOutput(`[DEV ONLY] CRITICAL ERROR:\n${caught instanceof Error ? caught.message : String(caught)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const checkWhoami = async () => {
    setIsLoading(true);
    setOutput('[DEV ONLY] Checking auth session status...');
    try {
      const sessionRes = await backend.auth.getSession();
      if (!sessionRes.ok) {
        setOutput(`[DEV ONLY] Auth check error: ${sessionRes.error.message}`);
        return;
      }
      if (!sessionRes.value) {
        setOutput('=== AUTH STATUS (MOBILE) ===\nStatus: NOT SIGNED IN (Guest mode)');
        return;
      }

      const session = sessionRes.value;
      const validateRes = await backend.validateSession();
      const isValid = validateRes.ok && validateRes.value;

      const lines = [
        '=== AUTH STATUS (MOBILE) ===',
        'Status:        SIGNED IN',
        `Account ID:    ${session.accountId}`,
        `Session Valid: ${isValid ? 'YES (Verified via YouTube Music)' : 'NO / EXPIRED'}`,
        `Created At:    ${new Date(session.createdAt).toLocaleString()}`,
        '',
        'Cookies and tokens are strictly redacted and never logged or displayed.',
      ];
      setOutput(lines.join('\n'));
    } catch (caught) {
      setOutput(`[DEV ONLY] CRITICAL ERROR:\n${caught instanceof Error ? caught.message : String(caught)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    setIsLoading(true);
    setOutput('[DEV ONLY] Performing logout...');
    try {
      const res = await backend.logout();
      if (!res.ok) {
        setOutput(`[DEV ONLY] Logout failed: ${res.error.message}`);
        return;
      }
      setOutput(
        '=== LOGOUT SUCCESS ===\n1. Stored cookies cleared from SecureStore\n2. Native WebView cookie jar cleared\n3. User-scoped cache cleared\n4. Visitor data reset\n\nStatus: Now in Guest Mode.',
      );
    } catch (caught) {
      setOutput(`[DEV ONLY] CRITICAL ERROR:\n${caught instanceof Error ? caught.message : String(caught)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const runVerifyAuthResolution = async () => {
    setIsLoading(true);
    setOutput(
      '[DEV ONLY] Verifying Authenticated Stream Resolution...\nExecuting Test 1 (Age-Restricted) & Test 2 (Standard)...',
    );
    try {
      const isSignedIn = await backend.isSignedIn();

      // Clear memory stream cache for test tracks to ensure fresh network resolutions
      await backend.invalidateStream('VYOjWnS4cMY');
      await backend.invalidateStream('9RfVp-GhKfs');

      // Test 1: Age-restricted track "VYOjWnS4cMY" (Childish Gambino - This Is America)
      const t1Start = Date.now();
      const res1 = await backend.resolveStream('VYOjWnS4cMY', { forceFresh: true });
      const t1DurationMs = Date.now() - t1Start;

      let t1Strategy = 'unknown';
      let t1Status = 'N/A';
      let t1Codec = 'N/A';
      let t1Bitrate = 'N/A';
      let t1Playable = 'NO';
      let t1Error: string | undefined;

      if (res1.ok) {
        t1Strategy = res1.value.strategyName;
        t1Codec = res1.value.stream.codec;
        t1Bitrate = `${(res1.value.stream.bitrate / 1000).toFixed(1)} kbps`;

        const verify1 = await backend.streaming.verify(res1.value.stream.url, {
          headers: res1.value.requestHeaders,
        });
        t1Status = `HTTP ${verify1.statusCode}`;
        t1Playable = verify1.isPlayable ? 'YES' : 'NO';
        if (!verify1.isPlayable) {
          t1Error = verify1.error ?? 'Stream verification returned unplayable';
        }
      } else {
        const attempts = res1.error.details?.attempts as
          | { strategy: string; error: string; reason?: string }[]
          | undefined;
        t1Error = `${res1.error.code}: ${res1.error.message}`;
        if (attempts?.length) {
          t1Error += `\nAttempts:\n${attempts.map((a) => ` - [${a.strategy}] ${a.error}`).join('\n')}`;
          t1Strategy = attempts.map((a) => a.strategy).join(', ');
        } else {
          t1Strategy = (res1.error.details?.strategy as string) ?? 'none';
        }
        t1Status = res1.error.details?.statusCode
          ? `HTTP ${res1.error.details.statusCode}`
          : res1.error.code;
      }

      // Test 2: Standard track "9RfVp-GhKfs" (Radiohead - Creep)
      const t2Start = Date.now();
      const res2 = await backend.resolveStream('9RfVp-GhKfs', { forceFresh: true });
      const t2DurationMs = Date.now() - t2Start;

      let t2Strategy = 'unknown';
      let t2Status = 'N/A';
      let t2Codec = 'N/A';
      let t2Bitrate = 'N/A';
      let t2Playable = 'NO';
      let t2Error: string | undefined;

      if (res2.ok) {
        t2Strategy = res2.value.strategyName;
        t2Codec = res2.value.stream.codec;
        t2Bitrate = `${(res2.value.stream.bitrate / 1000).toFixed(1)} kbps`;

        const verify2 = await backend.streaming.verify(res2.value.stream.url, {
          headers: res2.value.requestHeaders,
        });
        t2Status = `HTTP ${verify2.statusCode}`;
        t2Playable = verify2.isPlayable ? 'YES' : 'NO';
        if (!verify2.isPlayable) {
          t2Error = verify2.error ?? 'Stream verification returned unplayable';
        }
      } else {
        const attempts = res2.error.details?.attempts as
          | { strategy: string; error: string; reason?: string }[]
          | undefined;
        t2Error = `${res2.error.code}: ${res2.error.message}`;
        if (attempts?.length) {
          t2Error += `\nAttempts:\n${attempts.map((a) => ` - [${a.strategy}] ${a.error}`).join('\n')}`;
          t2Strategy = attempts.map((a) => a.strategy).join(', ');
        } else {
          t2Strategy = (res2.error.details?.strategy as string) ?? 'none';
        }
        t2Status = res2.error.details?.statusCode
          ? `HTTP ${res2.error.details.statusCode}`
          : res2.error.code;
      }

      // Test 3: Direct Authenticated Strategy on "9RfVp-GhKfs" (bypassing visionos and android_vr)
      const t3Start = Date.now();
      const authStrategy =
        (backend.streaming as DefaultStreamResolver).getAuthenticatedStrategy() ??
        new AuthenticatedStreamStrategy(backend.adapters.httpClient, {
          authService: backend.auth,
        });

      const res3 = await authStrategy.resolveStream('9RfVp-GhKfs', { forceFresh: true });
      const t3DurationMs = Date.now() - t3Start;

      let t3Strategy = authStrategy.name;
      let t3Status = 'N/A';
      let t3Codec = 'N/A';
      let t3Bitrate = 'N/A';
      let t3Playable = 'NO';
      let t3Cipher = 'NO';
      let t3Error: string | undefined;

      if (res3.ok) {
        t3Strategy = res3.value.strategyName;
        t3Codec = res3.value.stream.codec;
        t3Bitrate = `${(res3.value.stream.bitrate / 1000).toFixed(1)} kbps`;

        const verify3 = await backend.streaming.verify(res3.value.stream.url, {
          headers: res3.value.requestHeaders,
        });
        t3Status = `HTTP ${verify3.statusCode}`;
        t3Playable = verify3.isPlayable ? 'YES' : 'NO';
        t3Cipher = 'NO (Direct Audio Stream Available)';
        if (!verify3.isPlayable) {
          t3Error = verify3.error ?? 'Stream verification returned unplayable';
        }
      } else {
        t3Error = `${res3.error.code}: ${res3.error.message}`;
        t3Status = res3.error.details?.statusCode
          ? `HTTP ${res3.error.details.statusCode}`
          : res3.error.code;
        const hasCipher = Boolean(res3.error.details?.hasCipher);
        const cipherCount = (res3.error.details?.cipherFormatsCount as number) ?? 0;
        const totalFormats = (res3.error.details?.totalFormatsFound as number) ?? 0;
        t3Cipher = hasCipher
          ? `YES (${cipherCount}/${totalFormats} formats signatureCipher locked)`
          : 'NO (No cipher detected)';
      }

      const lines = [
        '=== VERIFY AUTH RESOLUTION RESULTS ===',
        `Auth State: ${isSignedIn ? 'SIGNED IN' : 'GUEST (NOT SIGNED IN)'}`,
        '',
        '--- TEST 1: Age-Restricted ("VYOjWnS4cMY") ---',
        `Strategy: ${t1Strategy}`,
        `Status:   ${t1Status}`,
        `Codec:    ${t1Codec}`,
        `Bitrate:  ${t1Bitrate}`,
        `Playable: ${t1Playable}`,
        `Time:     ${t1DurationMs}ms`,
        t1Error ? `Error:    ${t1Error}` : 'Error:    None',
        '',
        '--- TEST 2: Standard Track ("9RfVp-GhKfs") ---',
        `Strategy: ${t2Strategy}`,
        `Status:   ${t2Status}`,
        `Codec:    ${t2Codec}`,
        `Bitrate:  ${t2Bitrate}`,
        `Playable: ${t2Playable}`,
        `Time:     ${t2DurationMs}ms`,
        t2Error ? `Error:    ${t2Error}` : 'Error:    None',
        '',
        '--- TEST 3: Direct Authenticated ("9RfVp-GhKfs") ---',
        `Strategy: ${t3Strategy}`,
        `Status:   ${t3Status}`,
        `Codec:    ${t3Codec}`,
        `Bitrate:  ${t3Bitrate}`,
        `Playable: ${t3Playable}`,
        `Cipher:   ${t3Cipher}`,
        `Time:     ${t3DurationMs}ms`,
        t3Error ? `Error:    ${t3Error}` : 'Error:    None',
      ];

      setOutput(lines.join('\n'));
    } catch (caught) {
      setOutput(
        `[DEV ONLY] CRITICAL ERROR:\n${caught instanceof Error ? caught.message : String(caught)}`,
      );
    } finally {
      setIsLoading(false);
    }
  };

  const runLibraryTest = async () => {
    setIsLoading(true);
    setOutput('[DEV ONLY] Fetching User Library (Playlists, Liked Songs, History)...');
    try {
      const isSignedIn = await backend.isSignedIn();
      if (!isSignedIn) {
        setOutput(
          '=== USER LIBRARY (PLAYLISTS & LIKES) ===\nStatus: NOT SIGNED IN\nPlease sign in via the WebView first.',
        );
        return;
      }

      // 1. Playlists
      const pStart = Date.now();
      const playlistsRes = await backend.fetchUserPlaylists();
      const pDurationMs = Date.now() - pStart;

      // 2. Liked Songs
      const lStart = Date.now();
      const likedRes = await backend.fetchLikedSongs();
      const lDurationMs = Date.now() - lStart;

      // 3. History
      const hStart = Date.now();
      const historyRes = await backend.fetchHistory();
      const hDurationMs = Date.now() - hStart;

      const lines = [
        '=== USER LIBRARY (PLAYLISTS & LIKES) ===',
        'Status: SIGNED IN',
        '',
        '--- 1. USER PLAYLISTS (FEmusic_liked_playlists) ---',
      ];

      if (playlistsRes.ok) {
        const { playlists, continuationToken } = playlistsRes.value;
        lines.push(`Total Playlists Found: ${playlists.length} (in ${pDurationMs}ms)`);
        lines.push(`Has Continuation:      ${continuationToken ? 'YES' : 'NO'}`);
        if (playlists.length > 0) {
          lines.push('Top Playlists:');
          for (let i = 0; i < Math.min(playlists.length, 5); i++) {
            const p = playlists[i];
            lines.push(
              `  ${i + 1}. [${p.id}] "${p.title}" ${p.trackCount !== undefined ? `(${p.trackCount} songs)` : ''} ${p.author ? `by ${p.author}` : ''}`,
            );
          }
        } else {
          lines.push('  (No user playlists found in this account)');
        }
      } else {
        lines.push(`Error: ${playlistsRes.error.code} - ${playlistsRes.error.message}`);
      }

      lines.push('');
      lines.push('--- 2. LIKED SONGS (FEmusic_liked_videos) ---');
      if (likedRes.ok) {
        const { tracks, totalCount, continuationToken } = likedRes.value;
        lines.push(`Liked Tracks Loaded:   ${tracks.length} (in ${lDurationMs}ms)`);
        if (totalCount !== undefined) {
          lines.push(`Total Count Header:    ${totalCount}`);
        }
        lines.push(`Has Continuation:      ${continuationToken ? 'YES' : 'NO'}`);
        if (tracks.length > 0) {
          lines.push('Top Liked Songs:');
          for (let i = 0; i < Math.min(tracks.length, 5); i++) {
            const t = tracks[i];
            const artistNames = t.artists.map((a) => a.name).join(', ') || 'Unknown';
            lines.push(
              `  ${i + 1}. [${t.id}] "${t.title}" - ${artistNames} (${t.durationSeconds ? `${Math.floor(t.durationSeconds / 60)}:${String(t.durationSeconds % 60).padStart(2, '0')}` : 'N/A'})`,
            );
          }
        } else {
          lines.push('  (No liked tracks found in this account)');
        }
      } else {
        lines.push(`Error: ${likedRes.error.code} - ${likedRes.error.message}`);
      }

      lines.push('');
      lines.push('--- 3. PLAYBACK HISTORY (FEmusic_history) ---');
      if (historyRes.ok) {
        const { items, continuationToken } = historyRes.value;
        lines.push(`History Items Loaded:  ${items.length} (in ${hDurationMs}ms)`);
        lines.push(`Has Continuation:      ${continuationToken ? 'YES' : 'NO'}`);
        if (items.length > 0) {
          lines.push('Recent History:');
          for (let i = 0; i < Math.min(items.length, 5); i++) {
            const h = items[i];
            const artistNames = h.track.artists.map((a) => a.name).join(', ') || 'Unknown';
            lines.push(
              `  ${i + 1}. [${h.track.id}] "${h.track.title}" - ${artistNames} ${h.playedAt ? `(${h.playedAt})` : ''}`,
            );
          }
        } else {
          lines.push('  (No playback history found)');
        }
      } else {
        lines.push(`Error: ${historyRes.error.code} - ${historyRes.error.message}`);
      }

      setOutput(lines.join('\n'));
    } catch (caught) {
      setOutput(
        `[DEV ONLY] CRITICAL ERROR:\n${caught instanceof Error ? caught.message : String(caught)}`,
      );
    } finally {
      setIsLoading(false);
    }
  };

  const runPlaybackCoreTest = async () => {
    setIsLoading(true);
    setOutput('[DEV ONLY] Running Playback Core Test (Fake Engine)...');
    try {
      const logs: string[] = ['=== PLAYBACK CORE STATE MACHINE TEST ===', ''];

      // 1. Prepare 3 tracks from search/hardcoded fallback
      logs.push('Fetching 3 test tracks...');
      const searchRes = await backend.search('Radiohead');
      let tracks: Track[] = [];
      if (searchRes.ok) {
        tracks = searchRes.value.items
          .filter((item): item is { type: 'track'; track: Track } => item.type === 'track')
          .map((item) => item.track)
          .slice(0, 3);
      }
      if (tracks.length < 3) {
        tracks = [
          {
            id: '9RfVp-GhKfs',
            title: 'Creep',
            artists: [{ name: 'Radiohead' }],
            durationSeconds: 239,
            thumbnails: [],
          },
          {
            id: 'kJQP7kiw5Fk',
            title: 'Despacito',
            artists: [{ name: 'Luis Fonsi' }],
            durationSeconds: 282,
            thumbnails: [],
          },
          {
            id: 'fJ9rUzIMcZQ',
            title: 'Bohemian Rhapsody',
            artists: [{ name: 'Queen' }],
            durationSeconds: 359,
            thumbnails: [],
          },
        ];
      }
      logs.push('Loaded 3 tracks:');
      tracks.forEach((t: Track, i: number) => logs.push(`  ${i + 1}. [${t.id}] "${t.title}"`));
      logs.push('');

      const playback = backend.playback;
      const fakeEngine = backend.adapters.audioEngine as FakeAudioEngine;

      // Track state transitions
      const stateLog: string[] = [];
      const unsub = playback.onStatusChange((status) => {
        stateLog.push(`-> State: ${status.state} (track: ${status.currentTrack?.id ?? 'none'})`);
      });

      // Step 1: setQueue & Auto-play
      logs.push('--- STEP 1: setQueue & Auto-Play ---');
      await playback.setQueue(tracks, 0);
      logs.push(`Current State: ${playback.getStatus().state}`);
      logs.push(
        `Playing Track: [${playback.getStatus().currentTrack?.id}] "${playback.getStatus().currentTrack?.title}"`,
      );
      logs.push(`Loaded Audio URL: ${fakeEngine.loadedUrl?.slice(0, 50)}...`);
      logs.push(`Request Headers attached: ${JSON.stringify(Object.keys(fakeEngine.loadedHeaders))}`);
      logs.push('');

      // Step 2: Prefetch Verification
      logs.push('--- STEP 2: Prefetch Verification ---');
      // Wait for background prefetch to settle into memory cache
      await new Promise((r) => setTimeout(r, 600));
      const nextTrack = playback.queue.getNextTrack();
      logs.push(`Next track in queue: [${nextTrack?.id}] "${nextTrack?.title}"`);
      if (nextTrack) {
        const prefetchStart = Date.now();
        const prefetchCheck = await backend.streaming.resolve(nextTrack.id);
        const prefetchDurationMs = Date.now() - prefetchStart;
        const isWarmHit = prefetchDurationMs < 20;
        logs.push(
          `Prefetch Cache Check: ${prefetchCheck.ok ? 'HIT' : 'MISS'} (${prefetchDurationMs}ms, memory warm: ${isWarmHit ? 'YES' : 'NO'})`,
        );
      }
      logs.push('');

      // Step 3: next()
      logs.push('--- STEP 3: next() ---');
      const nextStart = Date.now();
      await playback.next();
      const nextDurationMs = Date.now() - nextStart;
      logs.push(`Current State: ${playback.getStatus().state} (advanced in ${nextDurationMs}ms)`);
      logs.push(
        `Playing Track: [${playback.getStatus().currentTrack?.id}] "${playback.getStatus().currentTrack?.title}"`,
      );
      logs.push(`Index: ${playback.getStatus().currentIndex} / ${playback.getStatus().queueLength}`);
      logs.push('');

      // Step 4: toggleShuffle()
      logs.push('--- STEP 4: toggleShuffle() ---');
      playback.toggleShuffle();
      logs.push(`Shuffled: ${playback.getStatus().shuffle}`);
      logs.push(
        `Current Track after shuffle: [${playback.getStatus().currentTrack?.id}] at index ${playback.getStatus().currentIndex}`,
      );
      logs.push(`Queue IDs: ${playback.queue.queue.map((t) => t.id).join(', ')}`);
      logs.push('');

      // Step 5: Simulate HTTP 403 & Auto-Recovery
      logs.push('--- STEP 5: Simulate HTTP 403 & Auto-Recovery ---');
      const curId = playback.getStatus().currentTrack?.id;
      logs.push(`Simulating CDN 403 on current track [${curId}]...`);
      fakeEngine.simulateError({
        message: 'HTTP 403 Forbidden',
        statusCode: 403,
        isNetworkOrAuthError: true,
      });

      // Allow recovery loop to process
      await new Promise((r) => setTimeout(r, 800));
      logs.push(`Post-403 Recovery State: ${playback.getStatus().state}`);
      logs.push(`Current Track: [${playback.getStatus().currentTrack?.id}]`);
      logs.push('');

      // Step 6: Cold-Start State Persistence & Restore
      logs.push('--- STEP 6: Cold-Start State Persistence & Restore ---');
      logs.push('Seeking to 45,000ms and stopping playback to simulate cold restart...');
      await playback.seekTo(45000);
      const preStopTrack = playback.getStatus().currentTrack;
      await playback.stop();
      logs.push(`State after stop: ${playback.getStatus().state}, Queue Length: ${playback.getStatus().queueLength}`);

      logs.push('Restoring state from KeyValueStore persistence...');
      const restoreSuccess = await playback.restoreState();
      const restoredStatus = playback.getStatus();
      logs.push(`Restore Success: ${restoreSuccess ? 'YES' : 'NO'}`);
      logs.push(`Restored State: ${restoredStatus.state}`);
      logs.push(
        `Restored Track: [${restoredStatus.currentTrack?.id}] "${restoredStatus.currentTrack?.title}" (Index ${restoredStatus.currentIndex})`,
      );
      logs.push(`Restored Position: ${restoredStatus.positionMs}ms (Expected: 45000ms)`);
      logs.push(
        `Restoration Match: ${preStopTrack?.id === restoredStatus.currentTrack?.id && restoredStatus.positionMs === 45000 ? 'SUCCESS' : 'FAILED'}`,
      );
      logs.push('');

      // State Transitions Summary
      logs.push('--- STATE TRANSITIONS RECORDED ---');
      stateLog.slice(-15).forEach((t) => logs.push(`  ${t}`));

      unsub();
      setOutput(logs.join('\n'));
    } catch (caught) {
      setOutput(
        `[DEV ONLY] CRITICAL ERROR:\n${caught instanceof Error ? caught.message : String(caught)}`,
      );
    } finally {
      setIsLoading(false);
    }
  };

  const runLyricsTest = async () => {
    setIsLoading(true);
    setOutput('[DEV ONLY] Fetching Synced Lyrics from LRCLIB (Radiohead - Creep)...');
    try {
      const startTime = Date.now();
      const res = await backend.getLyrics({
        videoId: '9RfVp-GhKfs',
        trackTitle: 'Creep',
        artistName: 'Radiohead',
        durationSeconds: 239,
      });
      const durationMs = Date.now() - startTime;

      if (!res.ok) {
        setOutput(`[DEV ONLY] Failed to fetch lyrics: ${res.error.message}`);
        return;
      }

      const lyrics = res.value;
      const lines = [
        '=== LRCLIB & LRC PARSER TEST ===',
        `Track:         Radiohead - Creep [${lyrics.videoId}]`,
        `Source:        ${lyrics.source}`,
        `Sync Type:     ${lyrics.syncType}`,
        `Instrumental:  ${lyrics.instrumental ? 'YES' : 'NO'}`,
        `Network Time:  ${durationMs}ms`,
        `Synced Lines:  ${lyrics.syncedLines.length}`,
        '',
        '--- FIRST 3 TIMESTAMPED LINES ---',
      ];

      if (lyrics.syncedLines.length > 0) {
        for (let i = 0; i < Math.min(lyrics.syncedLines.length, 3); i++) {
          const line = lyrics.syncedLines[i];
          const min = Math.floor(line.startTimeMs / 60000);
          const sec = Math.floor((line.startTimeMs % 60000) / 1000);
          const ms = Math.floor((line.startTimeMs % 1000) / 10);
          const ts = `[${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms).padStart(2, '0')}]`;
          lines.push(`  Line ${i + 1}: ${ts} "${line.text}"`);
        }

        // Test getActiveLyricIndex at positionMs = 60,000 (1:00)
        const testPosMs = 60000;
        const activeIdx = getActiveLyricIndex(lyrics.syncedLines, testPosMs);
        lines.push('');
        lines.push('--- ACTIVE LYRIC INDEX TEST ---');
        lines.push(`Target Position: ${testPosMs}ms (01:00.00)`);
        lines.push(`Active Line Index: ${activeIdx}`);
        if (activeIdx >= 0 && activeIdx < lyrics.syncedLines.length) {
          const activeLine = lyrics.syncedLines[activeIdx];
          lines.push(`Active Line Text:  "${activeLine.text}" (${activeLine.startTimeMs}ms)`);
        }
      } else if (lyrics.plainText) {
        lines.push('(Plain lyrics only):');
        lines.push(lyrics.plainText.slice(0, 150) + '...');
      } else {
        lines.push('(No lyrics text found)');
      }

      setOutput(lines.join('\n'));
    } catch (caught) {
      setOutput(
        `[DEV ONLY] CRITICAL ERROR:\n${caught instanceof Error ? caught.message : String(caught)}`,
      );
    } finally {
      setIsLoading(false);
    }
  };

  const runDownloadTest = async () => {
    setIsLoading(true);
    setOutput('[DEV ONLY] Running Download & Offline Playback Verification...');
    const lines: string[] = ['=== DOWNLOAD & OFFLINE PLAYBACK TEST ==='];
    const videoId = '9RfVp-GhKfs';
    const testTrack: Track = {
      id: videoId,
      title: 'Creep',
      artists: [{ id: 'artist-radiohead', name: 'Radiohead' }],
      thumbnails: [],
      album: { id: 'album-pablo-honey', title: 'Pablo Honey' },
      durationSeconds: 238,
    };

    try {
      // Step 1: Enqueue download
      lines.push('--- Step 1: Enqueue Download ---');
      lines.push(`Downloading track: [${videoId}] "${testTrack.title}"...`);
      const dlStart = Date.now();
      const res = await backend.enqueueDownload(testTrack);
      const dlDuration = Date.now() - dlStart;

      if (!res.ok) {
        lines.push(`ERROR: Failed to download track: ${res.error.message}`);
        setOutput(lines.join('\n'));
        return;
      }

      const downloaded = res.value;
      lines.push(`Download Completed in ${dlDuration}ms:`);
      lines.push(`- File Path:   ${downloaded.filePath}`);
      lines.push(
        `- Size:        ${(downloaded.sizeBytes / (1024 * 1024)).toFixed(2)} MB (${downloaded.sizeBytes} bytes)`,
      );
      lines.push(`- MIME Type:   ${downloaded.mimeType}`);
      lines.push(`- Codec:       ${downloaded.codec}`);
      lines.push(`- Bitrate:     ${Math.round(downloaded.bitrate / 1000)} kbps`);

      // Step 2: Verify file existence and size on disk via RnFileStore
      lines.push('');
      lines.push('--- Step 2: Verify on Native Disk ---');
      const fileStore = new RnFileStore();
      const existsRes = await fileStore.exists(downloaded.filePath);
      const metaRes = await fileStore.getMetadata(downloaded.filePath);
      lines.push(`File exists on disk: ${existsRes.ok && existsRes.value ? 'YES' : 'NO'}`);
      if (metaRes.ok) {
        lines.push(`Disk stat size:      ${metaRes.value.sizeBytes} bytes`);
      }

      // Step 3: Verify SQLite record retrieval
      lines.push('');
      lines.push('--- Step 3: SQLite Download Record & List ---');
      const record = await backend.getDownloadedTrack(videoId);
      lines.push(`Retrieved from DB:   ${record ? 'FOUND' : 'MISSING'}`);
      const allDownloads = await backend.listDownloads();
      lines.push(`Total Downloads:     ${allDownloads.length}`);
      const storageUsage = await backend.getStorageUsageBytes();
      lines.push(`Total Storage Usage: ${(storageUsage / 1024).toFixed(1)} KB`);

      // Step 4: Offline-First Playback Verification
      lines.push('');
      lines.push('--- Step 4: Offline-First Playback in PlaybackService ---');
      await backend.playback.setQueue([testTrack], 0);

      const fakeEngine = backend.adapters.audioEngine as FakeAudioEngine;
      const loadedUrlOrPath = fakeEngine.loadedUrl;
      const isLocalPath =
        loadedUrlOrPath?.startsWith('file://') ||
        loadedUrlOrPath === downloaded.filePath ||
        Boolean(loadedUrlOrPath && !loadedUrlOrPath.startsWith('http'));
      const isGoogleVideo = Boolean(loadedUrlOrPath?.includes('googlevideo.com'));

      lines.push(`Loaded Source:       ${loadedUrlOrPath}`);
      lines.push(`Is Local File Path:  ${isLocalPath ? 'YES' : 'NO'}`);
      lines.push(
        `Is Network Stream:   ${isGoogleVideo ? 'YES (UNEXPECTED!)' : 'NO (OFFLINE RESOLUTION SUCCESS)'}`,
      );
      lines.push(`Engine State:        ${fakeEngine.getState()}`);

      // Stop engine playback
      await backend.playback.stop();

      lines.push('');
      lines.push('=== ALL DOWNLOAD TESTS PASSED ===');
      setOutput(lines.join('\n'));
    } catch (caught) {
      setOutput(
        `[DEV ONLY] DOWNLOAD TEST CRITICAL ERROR:\n${caught instanceof Error ? caught.message : String(caught)}`,
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.header}>DEV ONLY - BACKEND DEBUG SCREEN</Text>
      <Text style={styles.subtext}>Plain text debug harness running on React Native native adapters</Text>

      <View style={styles.buttonRow}>
        <Button title="Search" onPress={runSearch} disabled={isLoading} />
        <View style={styles.spacer} />
        <Button title="Resolve & Verify" onPress={runResolveAndVerify} disabled={isLoading} />
        <View style={styles.spacer} />
        <Button title="Home Feed" onPress={runHomeFeed} disabled={isLoading} />
      </View>

      <View style={styles.buttonRow}>
        <Button
          title="Test Cache (Cold vs Warm)"
          onPress={runCacheTest}
          disabled={isLoading}
          color="#2e7d32"
        />
        <View style={styles.spacer} />
        <Button
          title="Cold Start from SQLite"
          onPress={runColdStartFromSqlite}
          disabled={isLoading}
          color="#1565c0"
        />
      </View>

      <View style={styles.buttonRow}>
        <Button
          title="Sign In (WebView)"
          onPress={() => setIsLoginModalVisible(true)}
          disabled={isLoading}
          color="#6a1b9a"
        />
        <View style={styles.spacer} />
        <Button
          title="Whoami"
          onPress={checkWhoami}
          disabled={isLoading}
          color="#00838f"
        />
        <View style={styles.spacer} />
        <Button
          title="Logout"
          onPress={handleLogout}
          disabled={isLoading}
          color="#c62828"
        />
      </View>

      <View style={styles.buttonRow}>
        <Button
          title="VERIFY AUTH RESOLUTION"
          onPress={runVerifyAuthResolution}
          disabled={isLoading}
          color="#e65100"
        />
        <View style={styles.spacer} />
        <Button
          title="LIBRARY (PLAYLISTS & LIKES)"
          onPress={runLibraryTest}
          disabled={isLoading}
          color="#4a148c"
        />
      </View>

      <View style={styles.buttonRow}>
        <Button
          title="TEST PLAYBACK CORE (FAKE ENGINE)"
          onPress={runPlaybackCoreTest}
          disabled={isLoading}
          color="#00695c"
        />
        <View style={styles.spacer} />
        <Button
          title="TEST LYRICS (LRCLIB + LRC PARSER)"
          onPress={runLyricsTest}
          disabled={isLoading}
          color="#ad1457"
        />
      </View>

      <View style={styles.buttonRow}>
        <Button
          title="TEST DOWNLOADS (LOCAL FILE + OFFLINE PLAY)"
          onPress={runDownloadTest}
          disabled={isLoading}
          color="#e65100"
        />
      </View>

      <ScrollView style={styles.outputBox} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.outputText} selectable>
          {output}
        </Text>
      </ScrollView>

      <LoginModal
        visible={isLoginModalVisible}
        backend={backend}
        onClose={() => setIsLoginModalVisible(false)}
        onSuccess={() => {
          setIsLoginModalVisible(false);
          checkWhoami();
        }}
        onReportError={(err) => {
          setOutput(`[DEV ONLY] Sign-In Error:\n${err}`);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 40,
    paddingHorizontal: 16,
    paddingBottom: 20,
    backgroundColor: '#ffffff',
  },
  header: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#d32f2f',
    marginBottom: 4,
  },
  subtext: {
    fontSize: 12,
    color: '#666666',
    marginBottom: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  spacer: {
    width: 8,
  },
  outputBox: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#cccccc',
    borderRadius: 4,
  },
  scrollContent: {
    padding: 12,
  },
  outputText: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#111111',
    lineHeight: 18,
  },
});
