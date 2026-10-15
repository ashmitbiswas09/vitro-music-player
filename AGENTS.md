This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Backend Architecture Rules (Active Phase: Backend Only)

- **Pure Backend Isolation**: All backend logic lives in `src/backend/`. Do NOT touch UI, App.tsx, styling, or navigation.
- **No React in Backend**: Nothing under `src/backend/` may import from `react` or `react-native`, except adapters in `src/backend/platform/rn/`.
- **Ports & Adapters**: Modules depend only on interfaces and `core`. Platform-specific APIs are implemented via adapters (`platform/rn` for mobile, `platform/memory` for tests/CLI).
- **Module Encapsulation**: Each module exposes only its public API via `index.ts`. Cross-module internal imports are strictly forbidden and enforced by ESLint.
- **Strict TypeScript & Zod**: Strict mode enabled. No `any`. Validate all external API responses defensively at the boundary using Zod.
- **Security & Privacy**:
  - Never log, print, or commit credentials, cookies, tokens, or personal account identifiers.
  - Logger must redact sensitive headers (`Authorization`, `Cookie`, `X-Goog-Visitor-Id`, `SAPISIDHASH`).
  - Any raw recorded response from a signed-in session must go ONLY into the gitignored `fixtures/recorded/` directory and NEVER into `fixtures/sanitized/` or version control.
  - CLI commands such as `whoami` report only binary signed-in/signed-out state and non-sensitive hashes, never user email or raw cookie values.
- **Auth Architecture**:
  - Session storage in `SecureStore` must be chunked (<= 1500 bytes/chunk) to prevent Android 2048-byte `SharedPreferences` limits.
  - Request signing generates `SAPISIDHASH` through the `Sha1Port` abstraction (`expo-crypto` in RN, `node:crypto` in tests/CLI).
  - Logout must atomically clear stored session chunks, wipe native WebView cookie jars, reset `visitorData`, and purge user-scoped cache (`cache.clearUserScopedData()`).
- **Library Architecture**:
  - All library operations (`fetchUserPlaylists`, `fetchLikedSongs`, `fetchHistory`, `setLiked`, `addTrackToPlaylist`, `removeTrackToPlaylist`) enforce session authentication and throw/return `AuthError` (`MISSING_SESSION`) if signed out.
  - Library queries are scoped under `auth:user:<accountId>:library:...` and purged atomically on logout along with SQLite mutation queue (`pending_mutations`, `user_likes`).
  - Offline mutation queue persists pending operations in `SqlDatabase` (`pending_mutations`, `user_likes`), supporting optimistic state, FIFO draining, and automatic rollback on fatal HTTP 400 rejection.
- **Playback Core Architecture**:
  - `AudioEngine` is a platform port interface (`load`, `play`, `pause`, `seekTo`, `setVolume`, `stop`, state/position/end/error events). Native audio engines connect via adapter; `FakeAudioEngine` is used in tests and CLI.
  - `load()` passes `stream.requestHeaders` (e.g. `User-Agent`, `Accept`) ensuring CDN streams are authorized.
  - Stream expiry check (< 60s) automatically invalidates and re-resolves fresh URLs before playback.
  - Audio errors with HTTP 403 / network failure automatically trigger single-attempt re-resolution and playback retry before failing to `ERROR`.
  - Background prefetching pre-resolves the next 1-2 upcoming tracks into stream cache on track load.
  - Queue continuation (`innertube.getNext`) extends the queue automatically when reaching the end if `autoRadio` is enabled.
  - Playback state (queue, originalQueue, index, position, repeat/shuffle) persists to storage for cold-start restoration without persisting IP-bound stream URLs.
- **Lyrics Architecture**:
  - `LyricsService` integrates LRCLIB (`/api/get` with fallback to `/api/search` picking closest duration within +/- 5s).
  - Noisy YouTube video titles are automatically cleaned (stripping suffixes like `(Official Video)`, `[Official Audio]`, `feat. ...`).
  - LRC format parser handles standard/3-digit ms timestamps, multi-timestamps, metadata tags, and `[offset:+/-ms]`.
  - Active line resolution uses binary search (`getActiveLyricIndex`) returning current active lyric index at given `positionMs`.
  - Caches lyrics in `CacheManager` (L1 memory + L2 SQLite) with a 7-day TTL (`guest` scope) and negative caching (1-hour TTL) for tracks with no lyrics.
- **Dependency Rules**:
  - Before adding ANY native or Expo package, ask the user first and justify it in one line.
  - Install only SDK-compatible packages with `npx expo install <package>`.
- **Verification**: Always run `npm test`, `npm run lint`, and `npm run typecheck` before declaring any task complete.

## Expo & Development Commands

```bash
npx expo install <package>  # Resolves SDK-compatible native/Expo packages (ask before adding dependencies)
npm run test                # Run unit tests via Vitest in plain Node
npm run lint                # Run ESLint (includes architectural boundary checks)
npm run typecheck           # TypeScript typecheck (tsc --noEmit)
npm run cli -- <command>    # Run backend CLI for terminal testing without emulator
npm run cli -- whoami       # Inspect auth state without exposing credentials
npx expo start              # Start the dev server
```

## Navigation & Routing

- Routes live in `src/app/` (Expo Router). Keep backend/non-route code outside `src/app/`.
- Docs: https://docs.expo.dev/router/introduction.md

## Native Rules

- Never edit `ios/` and `android/` directly (Continuous Native Generation). Configure native behavior in `app.json` and config plugins.
- Before adding ANY dependency, ask the user first and justify it in one line.
