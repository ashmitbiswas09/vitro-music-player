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
} from '@/backend/platform/rn';
import { redactString } from '@/backend/core';
import { CacheKeyBuilder } from '@/backend/cache';

export function DebugScreen() {
  const [output, setOutput] = useState<string>('Ready. Press a button below to test.');
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Initialize backend singleton wired to native React Native adapters
  const backend = useMemo(() => {
    const sqlite = new RnSqliteDatabase('vitro.db');
    return createBackend({
      httpClient: new FetchHttpClient(),
      secureStore: new RnSecureStore(),
      sqlDatabase: sqlite,
      keyValueStore: new RnKeyValueStore(sqlite),
      fileStore: new RnFileStore(),
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
      const lines = [
        `=== SEARCH SUCCESS (${durationMs}ms) ===`,
        `Items Count: ${items.length}`,
        `Parse Time: ${parseDurationMs.toFixed(2)}ms`,
        `Response Size: ${(responseSizeBytes / 1024).toFixed(2)} KB`,
        '',
        '--- First 5 Results ---',
      ];

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
      const lines = [
        `=== RESOLVE & VERIFY SUCCESS (${durationMs}ms) ===`,
        `Video ID: ${videoId}`,
        `Strategy: ${resolved.strategyName}`,
        `Audio Codec: ${resolved.stream.codec}`,
        `Bitrate: ${(resolved.stream.bitrate / 1000).toFixed(1)} kbps`,
        `Expires At: ${new Date(resolved.stream.expiresAt).toLocaleTimeString()}`,
        `Loudness: ${resolved.stream.loudnessDb !== undefined ? `${resolved.stream.loudnessDb} dB` : 'N/A'}`,
        '',
        '--- HTTP Verification ---',
        `Playable: ${verification.isPlayable ? 'YES' : 'NO'}`,
        `HTTP Status: ${verification.statusCode}`,
        `Content-Type: ${verification.contentType ?? 'none'}`,
        `Content-Range: ${verification.contentRange ?? 'none'}`,
        `Bytes Received: ${verification.bytesReceived}`,
        `TTFB: ${verification.timeToFirstByteMs.toFixed(1)}ms`,
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
      const lines = [
        `=== HOME FEED SUCCESS (${durationMs}ms) ===`,
        `Total Sections: ${sections.length}`,
        `Parse Time: ${parseDurationMs.toFixed(2)}ms`,
        `Response Size: ${(responseSizeBytes / 1024).toFixed(2)} KB`,
        `Continuation Token: ${continuationToken ? 'Present' : 'None'}`,
        '',
        '--- Sections Overview ---',
      ];

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
      </View>

      <ScrollView style={styles.outputBox} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.outputText} selectable>
          {output}
        </Text>
      </ScrollView>
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
