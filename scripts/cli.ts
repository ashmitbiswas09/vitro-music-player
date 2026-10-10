/**
 * Node CLI for terminal testing and exploration of the backend without an emulator.
 * Run with tsx: npm run cli -- <command> [args]
 */

const coldStartBegin = performance.now();

interface CliTiming {
  coldStartTimeMs: number;
  commandExecutionMs?: number;
  totalTimeMs: number;
}

function printUsage(): void {
  console.log(`
Vitro Music Player - Backend CLI
=================================
Usage:
  npm run cli -- <command> [options]
  npx tsx scripts/cli.ts <command> [options]

Commands:
  search <query>      Search YouTube Music tracks/albums/artists (connected in Phase 2)
  resolve <videoId>   Resolve best audio stream URL and format (connected in Phase 3)
  home                Fetch personalized or browse home feed (connected in Phase 2)
  help, --help, -h    Show this help menu

Examples:
  npm run cli -- search "Radiohead Creep"
  npm run cli -- resolve "dQw4w9WgXcQ"
  npm run cli -- home
`);
}

async function handleSearch(query: string | undefined): Promise<void> {
  if (!query) {
    console.error('Error: Search query is required. Usage: npm run cli -- search <query>');
    process.exitCode = 1;
    return;
  }

  const searchStart = performance.now();
  console.log(`[CLI] Searching for: "${query}"...`);
  console.log('[CLI] Status: NOT IMPLEMENTED YET (scheduled for Phase 2 - Innertube).');
  console.log('[CLI] Result: No fake data returned.');
  const searchLatencyMs = performance.now() - searchStart;

  console.log(`[Perf] Search Latency: ${searchLatencyMs.toFixed(2)} ms`);
}

async function handleResolve(videoId: string | undefined): Promise<void> {
  if (!videoId) {
    console.error('Error: videoId is required. Usage: npm run cli -- resolve <videoId>');
    process.exitCode = 1;
    return;
  }

  const resolveStart = performance.now();
  console.log(`[CLI] Resolving audio stream for videoId: "${videoId}"...`);
  console.log('[CLI] Status: NOT IMPLEMENTED YET (scheduled for Phase 3 - Streaming Resolver).');
  console.log('[CLI] Result: No fake data returned.');
  const resolveLatencyMs = performance.now() - resolveStart;

  console.log(`[Perf] Time to Resolve Stream: ${resolveLatencyMs.toFixed(2)} ms`);
}

async function handleHome(): Promise<void> {
  const homeStart = performance.now();
  console.log('[CLI] Fetching Home feed...');
  console.log('[CLI] Status: NOT IMPLEMENTED YET (scheduled for Phase 2 - Innertube Browse).');
  console.log('[CLI] Result: No fake data returned.');
  const homeLatencyMs = performance.now() - homeStart;

  console.log(`[Perf] Home Feed Latency: ${homeLatencyMs.toFixed(2)} ms`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const commandArg = args.slice(1).join(' ').trim();

  const coldStartTimeMs = performance.now() - coldStartBegin;

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printUsage();
    console.log(`[Perf] Cold Start: ${coldStartTimeMs.toFixed(2)} ms\n`);
    return;
  }

  const cmdStart = performance.now();

  switch (command.toLowerCase()) {
    case 'search':
      await handleSearch(commandArg);
      break;
    case 'resolve':
      await handleResolve(commandArg);
      break;
    case 'home':
      await handleHome();
      break;
    default:
      console.error(`Unknown command: "${command}"`);
      printUsage();
      process.exitCode = 1;
      return;
  }

  const cmdEnd = performance.now();
  const timing: CliTiming = {
    coldStartTimeMs,
    commandExecutionMs: cmdEnd - cmdStart,
    totalTimeMs: performance.now() - coldStartBegin,
  };

  console.log('---------------------------------');
  console.log(`[Perf] Cold Start Time:       ${timing.coldStartTimeMs.toFixed(2)} ms`);
  if (timing.commandExecutionMs !== undefined) {
    console.log(`[Perf] Command Execution:     ${timing.commandExecutionMs.toFixed(2)} ms`);
  }
  console.log(`[Perf] Total Process Time:    ${timing.totalTimeMs.toFixed(2)} ms`);
}

main().catch((err: unknown) => {
  console.error('Fatal CLI Error:', err);
  process.exit(1);
});
