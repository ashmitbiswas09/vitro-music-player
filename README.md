# Vitro Music Player

> [!WARNING]
> **DISCLAIMER**: **Unofficial learning/personal project. Not affiliated with, endorsed by, or sponsored by YouTube or Google.**

Vitro Music Player is a high-performance, offline-first mobile music player built with Expo / React Native, TypeScript, and a decoupled hexagonal backend architecture.

---

## Architecture Overview

Vitro strictly follows the **Ports & Adapters (Hexagonal) Architecture**:
- **Pure Backend Isolation**: All business logic lives in `src/backend/` and is completely decoupled from UI and framework layers.
- **Zero React in Backend**: Core and domain services never import `react` or `react-native`. Platform-specific capabilities (disk storage, secure store, cryptography, networking) are abstracted behind strict Port interfaces under `src/backend/platform/`.
- **Adapters**:
  - `platform/rn`: Native React Native / Expo adapters (`expo-sqlite`, `expo-secure-store`, `expo-file-system`, `expo-crypto`, `FetchHttpClient`).
  - `platform/memory`: In-memory implementations for unit tests and headless CLI execution (`MemorySqlDatabase`, `MemorySecureStore`, `MemoryFileStore`, `NodeSha1`).
- **Encapsulated Modules**:
  - `core`: Domain models, Redacting Logger, SystemClock, Result/Error types, and centralized InnerTube client configurations.
  - `platform`: Port interfaces and platform adapter implementations.
  - `auth`: Secure chunked session persistence (<= 1500 bytes/chunk to respect Android SharedPreferences limits), SAPISIDHASH request signing, and atomic logout.
  - `innertube`: Type-safe InnerTube client, defensive parsers, and endpoint handlers.
  - `streaming`: Multi-strategy audio stream resolution (`visionos`, `android_vr`, `authenticated-visionos`) with IP-bound URL memory-only caching.
  - `cache`: Two-tier Stale-While-Revalidate caching (L1 Memory LRU + L2 SQLite disk persistence).
  - `library`: User library operations (playlists, liked songs, history) with offline SQLite mutation queue and FIFO synchronization.
  - `playback-core`: Headless playback engine, queue manager, prefetching, auto-radio continuation, and 403 auto-recovery.
  - `lyrics`: Synchronized LRC and plain-text lyrics via LRCLIB with sub-millisecond $O(\log N)$ binary search line tracking and 7-day TTL caching.
  - `downloads`: Native zero-copy binary streaming directly to sandboxed disk storage, unthrottled ranged downloads, cold-start interrupted download recovery, and offline-first playback integration.
  - `services`: Unified backend facade (`createBackend()`, `MusicRepository`, and `warmUp()`).

---

## Security & Privacy Rules

- **Credential Redaction**: Passwords, tokens, cookies, visitor IDs, IP addresses, and `SAPISIDHASH` headers are strictly redacted by the logging subsystem (`createLogger`).
- **No Sensitive Commits**: Recorded sessions are restricted to `fixtures/recorded/` and are strictly gitignored.
- **Atomic Logout**: Purges SecureStore credentials, wipes native WebView cookies, resets `visitorData`, deletes user-scoped SQLite cache, and clears the offline mutation queue.
- **CLI Safety**: The `whoami` CLI command reports only signed-in/signed-out binary state and non-sensitive hashes, never credentials or personal email.

---

## Development Setup

### Prerequisites
- **Node.js**: `>= 22.5.0`
- **JDK**: Java Development Kit 17
- **Android Studio & SDK**: Android SDK Platform 35, Android Build Tools, and an Android Virtual Device (AVD).

### Installation
```bash
# Clone the repository
git clone https://github.com/ashmitbiswas09/vitro-music-player.git
cd vitro-music-player

# Install dependencies
npm install
```

### Running on Android
```bash
# Start Android dev build on connected emulator or device
npm run android

# Start Metro bundler
npm run dev
```

---

## Headless CLI Tooling

Vitro provides a full headless CLI for terminal testing and operations without running an emulator:

```bash
# Inspect authentication state safely
npm run cli -- whoami

# Search YouTube Music
npm run cli -- search "Radiohead"

# Resolve audio stream
npm run cli -- resolve "9RfVp-GhKfs"

# Browse Home feed
npm run cli -- home

# Fetch Album details
npm run cli -- album "MPREb_..."

# Fetch Artist profile
npm run cli -- artist "UC..."

# Fetch Lyrics
npm run cli -- lyrics "Radiohead Creep"

# Download a track unthrottled
npm run cli -- download "9RfVp-GhKfs"

# List downloaded tracks
npm run cli -- downloads

# Remove a download
npm run cli -- remove-download "9RfVp-GhKfs"
```

---

## Verification & Testing

Every change is verified against strict unit test suites, architectural lint boundaries, and TypeScript checks:

```bash
# Run Vitest test suite
npm test

# Run ESLint (including module boundary rules)
npm run lint

# Run TypeScript type check
npm run typecheck
```

---

## License

[MIT](LICENSE) © 2026 Vitro Music Player Contributors
