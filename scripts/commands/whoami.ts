/**
 * CLI whoami command handler.
 * Reports whether the session is signed in or not.
 * Strictly avoids logging or printing any emails, cookies, or sensitive tokens.
 */

import { performance } from 'node:perf_hooks';
import { FetchHttpClient, MemorySecureStore, NodeSha1 } from '@/backend/platform';
import { AuthService } from '@/backend/auth';
import type { CliTiming } from './types';

export async function handleWhoami(): Promise<Partial<CliTiming>> {
  const start = performance.now();

  const auth = new AuthService({
    httpClient: new FetchHttpClient(),
    secureStore: new MemorySecureStore(),
    sha1: new NodeSha1(),
  });

  const sessionRes = await auth.getSession();
  const executionMs = performance.now() - start;

  console.log('\n=== AUTH STATUS (CLI) ===');
  if (sessionRes.ok && sessionRes.value) {
    console.log('Status:      Signed in');
    console.log(`Account ID:  ${sessionRes.value.accountId}`);
    console.log(`Created:     ${new Date(sessionRes.value.createdAt).toLocaleString()}`);
  } else {
    console.log('Status:      Not signed in (Guest mode)');
  }

  return {
    commandExecutionMs: executionMs,
  };
}
