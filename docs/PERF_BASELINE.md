# Performance Baseline (Android Emulator)

Measured performance metrics on the Android emulator (Pixel 8 / API 35) using React Native native platform adapters (`expo-sqlite`, `expo-secure-store`, `FetchHttpClient`).

*Note: All numbers below are measured from the Android emulator environment and represent end-to-end operation timings.*

## Current Baseline Metrics (Phases 1–7)

| Operation | Metric / Duration | Data Source & Tier | Notes |
|:---|:---|:---|:---|
| **Search ("Radiohead", all)** | **~1.0 s** (~1000 ms) | Network | InnerTube search endpoint, JSON parse, Zod validation |
| **Home Feed (Browse)** | **~0.44 s** (~440 ms) | Network | `FEmusic_home` browse feed with section parsing |
| **Stream Resolve (VisionOS - Standard)** | **~182 ms** | Network | `9RfVp-GhKfs`: HTTP 206 Range check on Opus 150.1 kbps stream |
| **Stream Resolve (VisionOS - Age-Restricted)** | **~971 ms** | Network | `VYOjWnS4cMY`: HTTP 206 Range check on Opus 150.3 kbps stream |
| **Stream Resolve (Authenticated VisionOS)** | **HTTP 400** | Network | Native client context rejects web browser cookies; auto-fallback disabled |
| **Library: Playlists (`FEmusic_liked_playlists`)** | **~408 ms** | Network | 2 playlists found (`[PLQcZqxkSRJW8]`, `[SE]`) |
| **Library: Liked Songs (`FEmusic_liked_videos`)** | **~302 ms** | Network | Authenticated user liked tracks shelf parse |
| **Library: History (`FEmusic_history`)** | **~350 ms** | Network | 1 item loaded (`[90DKXLbzLto] "The Night We Met"`) |
| **Cache Hit (In-Memory)** | **~0–2 ms** | L1 Memory (LRU) | Stale-While-Revalidate memory lookup (sub-100 ms target easily met) |
| **Cold Start from SQLite** | **~50 ms** | L2 SQLite (`expo-sqlite`) | Read parsed domain models from disk persistence after clearing memory tier / app restart |
| **Mutation Queue Persistence** | **~1–4 ms** | SQLite (`pending_mutations`) | Local write/read for optimistic likes and playlist edits |
| **Playback Queue State Operations** | **< 1 ms** | Memory | Headless state machine (next, prev, shuffle, repeat) |
| **Playback State Cold-Start Restore** | **~1–2 ms** | Storage | Reconstitute queue and playback position from KeyValueStore |
| **Lyrics: LRCLIB Network Fetch** | **~200–500 ms** | Network | REST lookup via `/api/get` or `/api/search` with duration matching |
| **Lyrics: Active Line Binary Search** | **< 0.05 ms** | Memory | $O(\log N)$ binary search on sorted timestamped lines |
| **Lyrics: L1 Cache Hit** | **< 0.1 ms** | L1 Memory (LRU) | Sub-millisecond in-memory lyrics return |
| **Lyrics: L2 SQLite Cold Read** | **~5–10 ms** | L2 SQLite (`expo-sqlite`) | Read persisted parsed lyrics from disk on cold start |

## Evolution Across Phases

- **Phase 4 (Cache)**: Established L1 in-memory LRU (< 2 ms) and L2 SQLite persistence (~50 ms cold start). Network roundtrips: search ~1.0 s, home ~0.44 s.
- **Phase 4b (Cache Hardening)**: Stream URLs restricted to memory tier only (0 ms memory hit, 0 SQLite persistence). Verified parsed domain model storage.
- **Phase 5 (Auth Module)**: Chunked SecureStore storage (<= 1500B chunks), SAPISID request hashing via `Sha1Port`.
- **Phase 6 (Library Module & Stream Auth Verification)**:
  - User playlists (`FEmusic_liked_playlists`): 408 ms (2 found). Full playlist IDs preserved across browse prefixes.
  - Liked songs (`FEmusic_liked_videos`): 302 ms.
  - Playback history (`FEmusic_history`): 350 ms.
  - Stream empirical results: `visionos` resolves standard track in 182 ms (Opus 150.1 kbps) and age-restricted track in 971 ms (Opus 150.3 kbps). `authenticated-visionos` yields HTTP 400. Auto-fallback disabled by default. Offline mutation queue purged on logout.
- **Phase 7 (Playback Core Module)**:
  - Headless queue manager & audio engine contract.
  - In-memory queue operations (< 1 ms). Stream prefetch ahead (1-2 tracks) eliminates latency between track transitions.
  - Automatic HTTP 403 recovery with stream cache invalidation and single-retry re-resolution (suppressing premature ERROR flashes).
  - Pre-playback stream expiry check (< 60s) guaranteeing valid playback URLs.
  - Monotonic request generation counter guarding against rapid-skip race conditions.
  - Throttled position persistence (<= 1 write per 5000ms).
  - Cold-start playback state restoration (~1-2 ms) from `KeyValueStore` without persisting IP-bound URLs.
- **Phase 8 (Lyrics Module)**:
  - Synced and plain-text lyrics via LRCLIB with automatic YouTube title cleaning.
  - Sub-millisecond $O(\log N)$ active line resolution (`getActiveLyricIndex`) enabling $60\text{ fps}$ scrolling without re-scanning arrays.
  - Defensive LRC format parser handling standard/3-digit ms, multi-timestamps, metadata tags, and offsets.
  - 7-day positive caching in L1 Memory and L2 SQLite (`guest` scope) and 1-hour negative caching for missing lyrics.

*This baseline is updated after each phase to track performance evolution and detect regressions.*

