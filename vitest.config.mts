import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/backend/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      '@/backend': path.resolve(__dirname, './src/backend'),
      '@/scripts': path.resolve(__dirname, './scripts'),
    },
  },
});
