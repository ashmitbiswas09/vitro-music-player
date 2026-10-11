import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';
import path from 'node:path';

describe('ESLint Architecture Boundaries', { timeout: 60000 }, () => {
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

  it('forbids ANY relative cross-module import', async () => {
    const results = await eslint.lintText(
      `import { CORE_MODULE_NAME } from '../core';\nexport const m = CORE_MODULE_NAME;\n`,
      {
        filePath: path.resolve(__dirname, '../src/backend/innertube/sample.ts'),
      },
    );
    expect(results[0].errorCount).toBeGreaterThan(0);
    const hasRelativeMsg = results[0].messages.some((m) =>
      m.message.includes('Cross-module relative import'),
    );
    expect(hasRelativeMsg).toBe(true);
  });

  it('forbids deep subpath imports into another module', async () => {
    const results = await eslint.lintText(
      `import { helper } from '@/backend/innertube/parsers/search';\nexport const x = helper;\n`,
      {
        filePath: path.resolve(__dirname, '../src/backend/library/sample.ts'),
      },
    );
    expect(results[0].errorCount).toBeGreaterThan(0);
    const hasDeepMsg = results[0].messages.some((m) => m.message.includes('Deep subpath'));
    expect(hasDeepMsg).toBe(true);
  });

  it('forbids importing own module barrel via alias', async () => {
    const results = await eslint.lintText(
      `import { AUTH_MODULE_NAME } from '@/backend/auth';\nexport const a = AUTH_MODULE_NAME;\n`,
      {
        filePath: path.resolve(__dirname, '../src/backend/auth/sample.ts'),
      },
    );
    expect(results[0].errorCount).toBeGreaterThan(0);
    const hasSelfMsg = results[0].messages.some((m) =>
      m.message.includes('Do not import own module barrel'),
    );
    expect(hasSelfMsg).toBe(true);
  });

  it('enforces allowed-dependencies map: rejects cache importing innertube', async () => {
    const results = await eslint.lintText(
      `import { INNERTUBE_MODULE_NAME } from '@/backend/innertube';\nexport const x = INNERTUBE_MODULE_NAME;\n`,
      {
        filePath: path.resolve(__dirname, '../src/backend/cache/sample.ts'),
      },
    );
    expect(results[0].errorCount).toBeGreaterThan(0);
    const hasDisallowedMsg = results[0].messages.some((m) =>
      m.message.includes('is not allowed to import "innertube"'),
    );
    expect(hasDisallowedMsg).toBe(true);
  });

  it('enforces allowed-dependencies map: rejects core depending on any module', async () => {
    const results = await eslint.lintText(
      `import { PLATFORM_MODULE_NAME } from '@/backend/platform';\nexport const x = PLATFORM_MODULE_NAME;\n`,
      {
        filePath: path.resolve(__dirname, '../src/backend/core/sample.ts'),
      },
    );
    expect(results[0].errorCount).toBeGreaterThan(0);
    const hasDisallowedMsg = results[0].messages.some((m) =>
      m.message.includes('is not allowed to import "platform"'),
    );
    expect(hasDisallowedMsg).toBe(true);
  });

  it('allows valid barrel import according to allowed-dependencies map', async () => {
    const results = await eslint.lintText(
      `import { CORE_MODULE_NAME } from '@/backend/core';\nexport const m = CORE_MODULE_NAME;\n`,
      {
        filePath: path.resolve(__dirname, '../src/backend/cache/sample.ts'),
      },
    );
    const boundaryErrors = results[0].messages.filter(
      (m) => m.ruleId === 'backend-boundaries/enforce-boundaries',
    );
    expect(boundaryErrors.length).toBe(0);
  });

  it('forbids root backend barrel inside backend modules', async () => {
    const results = await eslint.lintText(
      `import { CORE_MODULE_NAME } from '@/backend';\nexport const m = CORE_MODULE_NAME;\n`,
      {
        filePath: path.resolve(__dirname, '../src/backend/cache/sample.ts'),
      },
    );
    expect(results[0].errorCount).toBeGreaterThan(0);
    const hasRootMsg = results[0].messages.some((m) => m.message.includes('backend root barrel'));
    expect(hasRootMsg).toBe(true);
  });
});
