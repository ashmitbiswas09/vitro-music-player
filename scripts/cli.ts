/**
 * Node CLI for terminal testing and exploration of the backend without an emulator.
 * Run with tsx: npm run cli -- <command> [args]
 */

import { performance } from 'node:perf_hooks';
import type { SearchFilter } from '@/backend/innertube';
import {
  type CliTiming,
  formatNumber,
  printUsage,
  handleSearch,
  handleResolve,
  handleHealth,
  handleHome,
  handleAlbum,
  handleArtist,
  handlePlaylist,
  handleNext,
  handleSuggest,
  handleCache,
  handleWhoami,
} from './commands';

const coldStartBegin = performance.now();

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  const coldStartTimeMs = performance.now() - coldStartBegin;

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printUsage();
    console.log(`[Perf] Cold Start: ${coldStartTimeMs.toFixed(2)} ms\n`);
    return;
  }

  const cmdStart = performance.now();
  let timingDetails: Partial<CliTiming> = {};

  switch (command.toLowerCase()) {
    case 'search': {
      let query = '';
      let filter: SearchFilter = 'all';
      let shouldRecord = false;

      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--record') {
          shouldRecord = true;
        } else if (args[i] === '--filter' && i + 1 < args.length) {
          filter = args[i + 1] as SearchFilter;
          i++;
        } else if (!args[i].startsWith('--')) {
          query += (query ? ' ' : '') + args[i];
        }
      }

      if (!query.trim()) {
        console.error(
          'Error: Search query is required. Usage: npm run cli -- search <query> [--filter <filter>] [--record]',
        );
        process.exitCode = 1;
        return;
      }

      timingDetails = await handleSearch(query.trim(), filter, shouldRecord);
      break;
    }
    case 'resolve': {
      let videoId = '';
      let shouldVerify = false;
      let shouldVerifyFull = false;
      let shouldRecord = false;

      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--verify-full') {
          shouldVerifyFull = true;
        } else if (args[i] === '--verify') {
          shouldVerify = true;
        } else if (args[i] === '--record') {
          shouldRecord = true;
        } else if (!args[i].startsWith('--')) {
          videoId = args[i];
        }
      }

      timingDetails = await handleResolve(
        videoId,
        shouldVerify,
        shouldVerifyFull,
        shouldRecord,
      );
      break;
    }
    case 'home': {
      const shouldRecord = args.includes('--record');
      timingDetails = await handleHome(shouldRecord);
      break;
    }
    case 'album': {
      const browseId = args.slice(1).find((a) => !a.startsWith('--'));
      const shouldRecord = args.includes('--record');
      timingDetails = await handleAlbum(browseId, shouldRecord);
      break;
    }
    case 'artist': {
      const browseId = args.slice(1).find((a) => !a.startsWith('--'));
      const shouldRecord = args.includes('--record');
      timingDetails = await handleArtist(browseId, shouldRecord);
      break;
    }
    case 'playlist': {
      const playlistId = args.slice(1).find((a) => !a.startsWith('--'));
      const shouldRecord = args.includes('--record');
      timingDetails = await handlePlaylist(playlistId, shouldRecord);
      break;
    }
    case 'next': {
      let videoId = '';
      let playlistId: string | undefined;
      let shouldRecord = false;

      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--record') {
          shouldRecord = true;
        } else if (args[i] === '--playlist' && i + 1 < args.length) {
          playlistId = args[i + 1];
          i++;
        } else if (!args[i].startsWith('--') && !videoId) {
          videoId = args[i];
        }
      }

      timingDetails = await handleNext(videoId, playlistId, shouldRecord);
      break;
    }
    case 'suggest': {
      const shouldRecord = args.includes('--record');
      const text = args
        .slice(1)
        .filter((a) => !a.startsWith('--'))
        .join(' ');
      timingDetails = await handleSuggest(text, shouldRecord);
      break;
    }
    case 'health': {
      let mode: 'search' | 'fixed' = 'search';
      if (args.includes('--fixed')) {
        mode = 'fixed';
      } else {
        const modeIdx = args.indexOf('--mode');
        if (modeIdx !== -1 && modeIdx + 1 < args.length && args[modeIdx + 1] === 'fixed') {
          mode = 'fixed';
        }
      }
      timingDetails = await handleHealth(mode);
      break;
    }
    case 'cache': {
      const subcommand = args[1] ?? 'stats';
      const targetArg = args[2];
      timingDetails = await handleCache(subcommand, targetArg);
      break;
    }
    case 'whoami': {
      timingDetails = await handleWhoami();
      break;
    }
    default:
      console.error(`Unknown command: "${command}"`);
      printUsage();
      process.exitCode = 1;
      return;
  }

  const cmdEnd = performance.now();

  console.log('\n---------------------------------');
  console.log(`[Perf] Cold Start Time:       ${coldStartTimeMs.toFixed(2)} ms`);
  if (timingDetails.commandExecutionMs !== undefined) {
    console.log(`[Perf] Network Latency:       ${timingDetails.commandExecutionMs.toFixed(2)} ms`);
  }
  if (timingDetails.parseTimeMs !== undefined) {
    console.log(`[Perf] Parse Time:            ${timingDetails.parseTimeMs.toFixed(2)} ms`);
  }
  if (timingDetails.responseSizeBytes !== undefined) {
    console.log(
      `[Perf] Response Size:         ${(timingDetails.responseSizeBytes / 1024).toFixed(2)} KB (${formatNumber(timingDetails.responseSizeBytes)} bytes)`,
    );
  }
  console.log(`[Perf] Command Total Time:    ${(cmdEnd - cmdStart).toFixed(2)} ms`);
  console.log(`[Perf] Total Process Time:    ${(cmdEnd - coldStartBegin).toFixed(2)} ms`);
}

main().catch((err: unknown) => {
  console.error('Fatal CLI Error:', err);
  process.exit(1);
});
