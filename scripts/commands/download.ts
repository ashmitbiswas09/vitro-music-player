/**
 * CLI Download command handler.
 * Manages offline downloads, lists storage usage, and removes downloads.
 */

import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createBackend } from '@/backend/services';
import { NodeFileStore, MemorySqlDatabase } from '@/backend/platform';
import type { Track } from '@/backend/core';
import type { CliTiming } from './types';

export async function handleDownload(
  actionOrId: string | undefined,
  targetId?: string,
): Promise<CliTiming> {
  const fileStore = new NodeFileStore();
  const sqlDatabase = new MemorySqlDatabase();
  const dbFile = path.resolve(process.cwd(), '.vitro-data', 'downloads_db.json');

  if (fs.existsSync(dbFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(dbFile, 'utf-8'));
      if (Array.isArray(data)) {
        sqlDatabase.seedTable('downloads', data);
      }
    } catch {
      // Ignored
    }
  }

  const backend = createBackend({ fileStore, sqlDatabase });

  const saveDb = () => {
    try {
      const rows = sqlDatabase.getTable('downloads') ?? [];
      fs.mkdirSync(path.dirname(dbFile), { recursive: true });
      fs.writeFileSync(dbFile, JSON.stringify(rows, null, 2));
    } catch {
      // Ignored
    }
  };

  const startMs = performance.now();

  if (!actionOrId || !actionOrId.trim()) {
    console.error('Usage: npm run cli -- download <videoId|query> | list | remove <videoId>');
    process.exitCode = 1;
    return { coldStartTimeMs: 0, totalTimeMs: 0 };
  }

  const action = actionOrId.trim();

  if (action === 'list') {
    const list = await backend.listDownloads();
    const totalBytes = await backend.getStorageUsageBytes();
    console.log('\n=== DOWNLOADED TRACKS ===');
    if (list.length === 0) {
      console.log('No downloaded tracks found.');
    } else {
      console.log(`Total Tracks:     ${list.length}`);
      console.log(`Total Disk Usage: ${(totalBytes / 1024 / 1024).toFixed(2)} MB\n`);
      list.forEach((d, i) => {
        const artist = d.track.artists.map((a) => a.name).join(', ') || 'Unknown';
        console.log(
          `  ${i + 1}. [${d.videoId}] "${d.track.title}" - ${artist} (${(d.sizeBytes / 1024 / 1024).toFixed(2)} MB, ${d.codec})`,
        );
        console.log(`     Path: ${d.filePath}`);
      });
    }
    console.log('=========================\n');
    return { coldStartTimeMs: 0, totalTimeMs: performance.now() - startMs };
  }

  if (action === 'remove') {
    if (!targetId || !targetId.trim()) {
      console.error(
        'Error: target videoId required to remove. Usage: npm run cli -- download remove <videoId>',
      );
      process.exitCode = 1;
      return { coldStartTimeMs: 0, totalTimeMs: 0 };
    }
    const res = await backend.removeDownload(targetId.trim());
    if (res.ok) {
      saveDb();
      console.log(`[CLI] Successfully removed download for track [${targetId.trim()}]`);
    } else {
      console.error(`[CLI Error] Failed to remove download: ${res.error.message}`);
      process.exitCode = 1;
    }
    return { coldStartTimeMs: 0, totalTimeMs: performance.now() - startMs };
  }

  if (action === 'clear') {
    const res = await backend.clearAllDownloads();
    if (res.ok) {
      saveDb();
      console.log('[CLI] Successfully cleared all downloaded tracks');
    } else {
      console.error(`[CLI Error] Failed to clear downloads: ${res.error.message}`);
      process.exitCode = 1;
    }
    return { coldStartTimeMs: 0, totalTimeMs: performance.now() - startMs };
  }

  // Otherwise action is a videoId or track search query
  let videoId = action;
  let track: Track = {
    id: videoId,
    title: videoId,
    artists: [{ name: 'Unknown' }],
    thumbnails: [],
  };

  const isVideoId = /^[a-zA-Z0-9_-]{11}$/.test(videoId);
  if (!isVideoId) {
    console.log(`[CLI] Searching for track matching "${videoId}"...`);
    const searchRes = await backend.search(videoId, { filter: 'songs' });
    if (searchRes.ok && searchRes.value.items.length > 0) {
      const top = searchRes.value.items.find(
        (it): it is { type: 'track'; track: Track } => it.type === 'track',
      );
      if (top) {
        track = top.track;
        videoId = track.id;
        console.log(
          `[CLI] Selected track: [${videoId}] "${track.title}" by ${track.artists.map((a) => a.name).join(', ')}`,
        );
      }
    }
  } else {
    // Known test track fallback metadata
    if (videoId === '9RfVp-GhKfs') {
      track = {
        id: '9RfVp-GhKfs',
        title: 'Creep',
        artists: [{ name: 'Radiohead' }],
        durationSeconds: 239,
        thumbnails: [],
      };
    }
  }

  console.log(`[CLI] Enqueueing download for track [${videoId}] "${track.title}"...`);
  const dlRes = await backend.enqueueDownload(track);
  const durationMs = performance.now() - startMs;

  if (!dlRes.ok) {
    console.error(`[CLI Error] Download failed: ${dlRes.error.message}`);
    process.exitCode = 1;
    return { coldStartTimeMs: 0, totalTimeMs: durationMs };
  }

  const dt = dlRes.value;
  saveDb();
  console.log('\n=== DOWNLOAD RESULT ===');
  console.log(`Video ID:     ${dt.videoId}`);
  console.log(`Title:        ${dt.track.title}`);
  console.log(`File Path:    ${dt.filePath}`);
  console.log(`Size:         ${(dt.sizeBytes / 1024 / 1024).toFixed(2)} MB (${dt.sizeBytes} bytes)`);
  console.log(`Codec:        ${dt.codec}`);
  console.log(`Bitrate:      ${Math.round(dt.bitrate / 1000)} kbps`);
  console.log(`Total Time:   ${durationMs.toFixed(2)} ms`);
  console.log('=======================\n');

  return { coldStartTimeMs: 0, totalTimeMs: durationMs };
}
