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

const ALLOWED_DEPENDENCIES = {
  core: [],
  platform: ['core'],
  innertube: ['core', 'platform', 'auth'],
  auth: ['core', 'platform'],
  cache: ['core', 'platform'],
  streaming: ['core', 'platform', 'innertube'],
  library: ['core', 'platform', 'innertube', 'auth', 'cache'],
  'playback-core': ['core', 'platform', 'streaming', 'innertube', 'cache'],
  lyrics: ['core', 'platform'],
  downloads: ['core', 'platform', 'streaming', 'cache'],
  services: [
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
  ],
};

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
          noRelativeCrossModule:
            'Cross-module relative import "{{source}}" into "{{targetModule}}" is forbidden. Import only through its public barrel "@/backend/{{targetModule}}".',
          noDeepModuleImport:
            'Import into another module must strictly use "@/backend/{{targetModule}}". Deep subpath "{{source}}" is forbidden.',
          noBackendRootImport:
            'Do not import from the backend root barrel inside backend modules. Import specific module barrels.',
          noSelfAliasImport:
            'Do not import own module barrel via "@/backend/{{targetModule}}". Use internal relative imports.',
          disallowedDependency:
            'Module "{{currentModule}}" is not allowed to import "{{targetModule}}". Allowed dependencies: [{{allowed}}].',
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

          // 3. Forbid ANY relative cross-module import
          if (source.startsWith('.')) {
            const dir = path.dirname(filename);
            const resolvedTarget = path.resolve(dir, source).replace(/\\/g, '/');
            const targetInfo = getBackendModuleInfo(resolvedTarget);

            if (targetInfo && targetInfo.moduleName !== currentInfo.moduleName) {
              context.report({
                node: node.source,
                messageId: 'noRelativeCrossModule',
                data: { source, targetModule: targetInfo.moduleName },
              });
              return;
            }
          }

          // 4. Validate alias imports: must be exact '@/backend/<targetModule>'
          if (source.startsWith('@/backend/')) {
            const subpath = source.slice('@/backend/'.length);
            const segments = subpath.split('/');
            const targetModule = segments[0];

            if (BACKEND_MODULES.includes(targetModule)) {
              // Rule 4a: Must not import own barrel via alias
              if (targetModule === currentInfo.moduleName) {
                context.report({
                  node: node.source,
                  messageId: 'noSelfAliasImport',
                  data: { targetModule },
                });
                return;
              }

              // Rule 4b: No deep import into another module
              if (segments.length > 1) {
                context.report({
                  node: node.source,
                  messageId: 'noDeepModuleImport',
                  data: { source, targetModule },
                });
                return;
              }

              // Rule 4c: Check allowed dependencies map
              const allowed = ALLOWED_DEPENDENCIES[currentInfo.moduleName] || [];
              if (!allowed.includes(targetModule)) {
                context.report({
                  node: node.source,
                  messageId: 'disallowedDependency',
                  data: {
                    currentModule: currentInfo.moduleName,
                    targetModule,
                    allowed: allowed.join(', ') || 'none',
                  },
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
