import fs from 'node:fs';
import path from 'node:path';
import { redactValue } from '../src/backend/core/logger/logger';

const FIXTURES = [
  'resolve_9RfVp-GhKfs.json',
  'resolve_fJ9rUzIMcZQ.json',
  'search_radiohead.json',
  'search_radiohead_creep.json',
];

function main(): void {
  const recordedDir = path.resolve(__dirname, '../fixtures/recorded');
  const sanitizedDir = path.resolve(__dirname, '../fixtures/sanitized');

  fs.mkdirSync(sanitizedDir, { recursive: true });

  console.log('[Sanitizer] Regenerating sanitized fixtures from recorded raw files...');

  for (const filename of FIXTURES) {
    const recordedPath = path.join(recordedDir, filename);
    const sanitizedPath = path.join(sanitizedDir, filename);

    if (!fs.existsSync(recordedPath)) {
      console.warn(`[Sanitizer] Warning: Raw recorded file not found: ${recordedPath}`);
      continue;
    }

    const rawContent = fs.readFileSync(recordedPath, 'utf-8');
    const parsed = JSON.parse(rawContent);
    const sanitized = redactValue(parsed);

    fs.writeFileSync(sanitizedPath, JSON.stringify(sanitized, null, 2) + '\n', 'utf-8');
    console.log(`[Sanitizer] Successfully regenerated: ${filename}`);
  }

  console.log('[Sanitizer] Done.');
}

main();
