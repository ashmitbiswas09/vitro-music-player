// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const path = require('node:path');

const BACKEND_MODULES = [
  'core',
  'platform',
  'innertube',
  'auth',
  'streaming',
  'cache',
  'library',
  'playback-core',
  'lyrics',
  'downloads',
  'services',
];

function getBackendModuleInfo(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const backendIndex = normalized.indexOf('/src/backend/');
  if (backendIndex === -1) return null;

  const rest = normalized.slice(backendIndex + '/src/backend/'.length);
  const parts = rest.split('/');
  const moduleName = parts[0];

  if (!BACKEND_MODULES.includes(moduleName)) return null;

  return {
    moduleName,
    isRnAdapter: moduleName === 'platform' && parts[1] === 'rn',
    relativePath: rest,
  };
}

const backendBoundariesPlugin = {
  meta: {
    name: 'backend-boundaries',
  },
  rules: {
    'enforce-boundaries': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Enforce architecture boundaries and encapsulation for backend modules',
        },
        schema: [],
        messages: {
          noUiInBackend:
            'Importing "{{source}}" is prohibited in backend code. Only platform/rn adapters may import React Native / Expo native UI modules.',
          noCrossModuleInternal:
            'Cross-module internal import "{{source}}" is forbidden. Import only from the public barrel of "{{targetModule}}".',
          noBackendRootImport:
            'Do not import from the backend root barrel inside backend modules. Import specific module barrels.',
          coreCannotDependOnOthers:
            'The core module is the foundation and cannot depend on other backend module "{{targetModule}}".',
          noDependOnServices:
            'Module "{{currentModule}}" cannot depend on "services". Services is the composition root.',
        },
      },
      create(context) {
        const filename = context.filename || (context.getFilename ? context.getFilename() : '');
        if (!filename) return {};

        const currentInfo = getBackendModuleInfo(filename);
        if (!currentInfo) return {};

        const checkImportSource = (node) => {
          if (!node || !node.source || typeof node.source.value !== 'string') return;
          const source = node.source.value;

          // 1. Prohibit UI imports (react, react-native, etc.) outside platform/rn
          const isUiImport =
            source === 'react' ||
            source === 'react-native' ||
            source.startsWith('react/') ||
            source.startsWith('react-native/') ||
            source.startsWith('expo-router') ||
            source.startsWith('@react-navigation/');

          if (isUiImport && !currentInfo.isRnAdapter) {
            context.report({
              node: node.source,
              messageId: 'noUiInBackend',
              data: { source },
            });
            return;
          }

          // 2. Prohibit root backend barrel inside backend modules
          if (source === '@/backend' || source === '@/backend/index') {
            context.report({
              node: node.source,
              messageId: 'noBackendRootImport',
            });
            return;
          }

          // 3. Check alias imports like '@/backend/<module>/...'
          if (source.startsWith('@/backend/')) {
            const afterPrefix = source.slice('@/backend/'.length);
            const segments = afterPrefix.split('/');
            const targetModule = segments[0];

            if (BACKEND_MODULES.includes(targetModule)) {
              if (targetModule !== currentInfo.moduleName) {
                // If it imports deeper than the module root barrel
                if (segments.length > 1 && segments[1] !== 'index' && segments[1] !== '') {
                  context.report({
                    node: node.source,
                    messageId: 'noCrossModuleInternal',
                    data: { source, targetModule },
                  });
                  return;
                }

                if (currentInfo.moduleName === 'core') {
                  context.report({
                    node: node.source,
                    messageId: 'coreCannotDependOnOthers',
                    data: { targetModule },
                  });
                  return;
                }

                if (targetModule === 'services' && currentInfo.moduleName !== 'services') {
                  context.report({
                    node: node.source,
                    messageId: 'noDependOnServices',
                    data: { currentModule: currentInfo.moduleName },
                  });
                  return;
                }
              }
            }
            return;
          }

          // 4. Check relative imports like '../...'
          if (source.startsWith('.')) {
            const dir = path.dirname(filename);
            const resolvedTarget = path.resolve(dir, source).replace(/\\/g, '/');
            const targetInfo = getBackendModuleInfo(resolvedTarget);

            if (targetInfo && targetInfo.moduleName !== currentInfo.moduleName) {
              const isBarrel =
                targetInfo.relativePath === targetInfo.moduleName ||
                targetInfo.relativePath === `${targetInfo.moduleName}/index` ||
                targetInfo.relativePath === `${targetInfo.moduleName}/index.ts` ||
                targetInfo.relativePath === `${targetInfo.moduleName}/index.js`;

              if (!isBarrel) {
                context.report({
                  node: node.source,
                  messageId: 'noCrossModuleInternal',
                  data: { source, targetModule: targetInfo.moduleName },
                });
                return;
              }

              if (currentInfo.moduleName === 'core') {
                context.report({
                  node: node.source,
                  messageId: 'coreCannotDependOnOthers',
                  data: { targetModule: targetInfo.moduleName },
                });
                return;
              }

              if (targetInfo.moduleName === 'services' && currentInfo.moduleName !== 'services') {
                context.report({
                  node: node.source,
                  messageId: 'noDependOnServices',
                  data: { currentModule: currentInfo.moduleName },
                });
                return;
              }
            }
          }
        };

        return {
          ImportDeclaration: checkImportSource,
          ExportNamedDeclaration: checkImportSource,
          ExportAllDeclaration: checkImportSource,
        };
      },
    },
  },
};

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'web-build/*', '.expo/*'],
  },
  {
    files: ['src/backend/**/*.{ts,tsx,js,jsx}'],
    plugins: {
      'backend-boundaries': backendBoundariesPlugin,
    },
    rules: {
      'backend-boundaries/enforce-boundaries': 'error',
    },
  },
]);
