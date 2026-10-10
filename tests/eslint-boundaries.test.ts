import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';
import path from 'node:path';

describe('ESLint Architecture Boundaries', () => {
  const eslint = new ESLint({
    overrideConfigFile: path.resolve(__dirname, '../eslint.config.js'),
  });

  it('rejects React/React Native imports in src/backend/core', async () => {
    const results = await eslint.lintText(`import React from 'react';`, {
      filePath: path.resolve(__dirname, '../src/backend/core/sample.ts'),
    });
    expect(results[0].errorCount).toBeGreaterThan(0);
    const hasBoundaryMsg = results[0].messages.some((m) =>
      m.message.includes('Only platform/rn adapters may import React Native'),
    );
    expect(hasBoundaryMsg).toBe(true);
  });

  it('allows React Native imports inside src/backend/platform/rn', async () => {
    const results = await eslint.lintText(
      `import { Platform } from 'react-native';\nexport const p = Platform;\n`,
      {
        filePath: path.resolve(__dirname, '../src/backend/platform/rn/sample.ts'),
      },
    );
    const boundaryErrors = results[0].messages.filter((m) =>
      m.message.includes('Only platform/rn adapters may import React Native'),
    );
    expect(boundaryErrors.length).toBe(0);
  });

  it('rejects cross-module internal imports', async () => {
    const results = await eslint.lintText(
      `import { helper } from '@/backend/innertube/parsers/search';\nexport const x = helper;\n`,
      {
        filePath: path.resolve(__dirname, '../src/backend/auth/sample.ts'),
      },
    );
    expect(results[0].errorCount).toBeGreaterThan(0);
    const hasBoundaryMsg = results[0].messages.some((m) =>
      m.message.includes('Cross-module internal import'),
    );
    expect(hasBoundaryMsg).toBe(true);
  });

  it('allows cross-module imports from public barrels', async () => {
    const results = await eslint.lintText(
      `import { INNERTUBE_MODULE_NAME } from '@/backend/innertube';\nexport const m = INNERTUBE_MODULE_NAME;\n`,
      {
        filePath: path.resolve(__dirname, '../src/backend/auth/sample.ts'),
      },
    );
    const boundaryErrors = results[0].messages.filter((m) =>
      m.message.includes('Cross-module internal import'),
    );
    expect(boundaryErrors.length).toBe(0);
  });

  it('rejects core module depending on other modules', async () => {
    const results = await eslint.lintText(
      `import { INNERTUBE_MODULE_NAME } from '@/backend/innertube';\nexport const m = INNERTUBE_MODULE_NAME;\n`,
      {
        filePath: path.resolve(__dirname, '../src/backend/core/sample.ts'),
      },
    );
    expect(results[0].errorCount).toBeGreaterThan(0);
    const hasFoundationMsg = results[0].messages.some((m) =>
      m.message.includes('The core module is the foundation'),
    );
    expect(hasFoundationMsg).toBe(true);
  });
});
