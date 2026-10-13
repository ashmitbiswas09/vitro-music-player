# Performance Baseline (Android Emulator)

Measured performance metrics on the Android emulator (Pixel 8 / API 35) using React Native native platform adapters (`expo-sqlite`, `expo-secure-store`, `FetchHttpClient`).

*Note: All numbers below are measured from the Android emulator environment and represent end-to-end operation timings.*

## Current Baseline Metrics (Phases 1–4b)

| Operation | Metric / Duration | Data Source & Tier | Notes |
|:---|:---|:---|:---|
| **Search ("Radiohead", all)** | **~1.0 s** (~1000 ms) | Network | InnerTube search endpoint, JSON parse, Zod validation |
| **Home Feed (Browse)** | **~0.44 s** (~440 ms) | Network | `FEmusic_home` browse feed with section parsing |
| **Stream Resolve & Verify** | **~2.0 s** (~2000 ms) | Network | YouTube Music player resolution + ranged HTTP verification (TTFB ~300-500 ms) |
| **Cache Hit (In-Memory)** | **~0–2 ms** | L1 Memory (LRU) | Stale-While-Revalidate memory lookup (sub-100 ms target easily met) |
| **Cold Start from SQLite** | **~50 ms** | L2 SQLite (`expo-sqlite`) | Read parsed domain models from disk persistence after clearing memory tier / app restart |

## Evolution Across Phases

- **Phase 4 (Cache)**: Established L1 in-memory LRU (< 2 ms) and L2 SQLite persistence (~50 ms cold start). Network roundtrips: search ~1.0 s, home ~0.44 s.
- **Phase 4b (Cache Hardening)**: Stream URLs restricted to memory tier only (0 ms memory hit, 0 SQLite persistence). Verified parsed domain model storage.
- **Phase 5 (Auth Module)**: *To be measured after authenticated flows are integrated.*

*This baseline will be updated after each phase to track performance evolution and detect regressions.*
