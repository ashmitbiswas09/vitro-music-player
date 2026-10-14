# Performance Baseline (Android Emulator)

Measured performance metrics on the Android emulator (Pixel 8 / API 35) using React Native native platform adapters (`expo-sqlite`, `expo-secure-store`, `FetchHttpClient`).

*Note: All numbers below are measured from the Android emulator environment and represent end-to-end operation timings.*

## Current Baseline Metrics (Phases 1–6)

| Operation | Metric / Duration | Data Source & Tier | Notes |
|:---|:---|:---|:---|
| **Search ("Radiohead", all)** | **~1.0 s** (~1000 ms) | Network | InnerTube search endpoint, JSON parse, Zod validation |
| **Home Feed (Browse)** | **~0.44 s** (~440 ms) | Network | `FEmusic_home` browse feed with section parsing |
| **Stream Resolve & Verify (VisionOS)** | **~379 ms** | Network | Player endpoint + HTTP 206 Range check on Opus 150.1 kbps stream |
| **Stream Resolve & Verify (Full Chain)** | **~2.0 s** (~2000 ms) | Network | Strategy fallback chain + TTFB verification |
| **Cache Hit (In-Memory)** | **~0–2 ms** | L1 Memory (LRU) | Stale-While-Revalidate memory lookup (sub-100 ms target easily met) |
| **Cold Start from SQLite** | **~50 ms** | L2 SQLite (`expo-sqlite`) | Read parsed domain models from disk persistence after clearing memory tier / app restart |
| **Mutation Queue Persistence** | **~1–4 ms** | SQLite (`pending_mutations`) | Local write/read for optimistic likes and playlist edits |

## Evolution Across Phases

- **Phase 4 (Cache)**: Established L1 in-memory LRU (< 2 ms) and L2 SQLite persistence (~50 ms cold start). Network roundtrips: search ~1.0 s, home ~0.44 s.
- **Phase 4b (Cache Hardening)**: Stream URLs restricted to memory tier only (0 ms memory hit, 0 SQLite persistence). Verified parsed domain model storage.
- **Phase 5 (Auth Module)**: Chunked SecureStore storage (<= 1500B chunks), SAPISID request hashing via `Sha1Port`, `authenticated-visionos` stream resolution fallback. Standard stream resolution on emulator: 379 ms (Opus 150.1 kbps).
- **Phase 6 (Library Module)**: User playlists (`FEmusic_liked_playlists`), liked songs (`FEmusic_liked_videos`), and playback history (`FEmusic_history`). Offline optimistic mutation queue persisted in `SqlDatabase` with background drain and rollback on fatal HTTP 400 rejection.

*This baseline is updated after each phase to track performance evolution and detect regressions.*

