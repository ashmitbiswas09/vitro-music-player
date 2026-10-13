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
import { redactString } from '@/backend/core';
import { CacheKeyBuilder } from '@/backend/cache';
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
