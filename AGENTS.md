This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Backend Architecture Rules (Active Phase: Backend Only)

- **Pure Backend Isolation**: All backend logic lives in `src/backend/`. Do NOT touch UI, App.tsx, styling, or navigation.
- **No React in Backend**: Nothing under `src/backend/` may import from `react` or `react-native`, except adapters in `src/backend/platform/rn/`.
- **Ports & Adapters**: Modules depend only on interfaces and `core`. Platform-specific APIs are implemented via adapters (`platform/rn` for mobile, `platform/memory` for tests/CLI).
- **Module Encapsulation**: Each module exposes only its public API via `index.ts`. Cross-module internal imports are strictly forbidden and enforced by ESLint.
- **Strict TypeScript & Zod**: Strict mode enabled. No `any`. Validate all external API responses defensively at the boundary using Zod.
- **Security & Privacy**: Never log or commit credentials, cookies, or tokens. Logger must redact sensitive headers/data.
- **Verification**: Always run `npm test`, `npm run lint`, and `npm run typecheck` before declaring any task complete.

## Expo & Development Commands

```bash
npx expo install <package>  # Resolves SDK-compatible native/Expo packages (ask before adding dependencies)
npm run test                # Run unit tests via Vitest in plain Node
npm run lint                # Run ESLint (includes architectural boundary checks)
npm run typecheck           # TypeScript typecheck (tsc --noEmit)
npm run cli -- <command>    # Run backend CLI for terminal testing without emulator
npx expo start              # Start the dev server
```

## Navigation & Routing

- Routes live in `src/app/` (Expo Router). Keep backend/non-route code outside `src/app/`.
- Docs: https://docs.expo.dev/router/introduction.md

## Native Rules

- Never edit `ios/` and `android/` directly (Continuous Native Generation). Configure native behavior in `app.json` and config plugins.
- Before adding ANY dependency, ask the user first and justify it in one line.
