/**
 * Default core configuration and InnerTube client constants.
 * All client values are centralized here and overridable.
 */

export interface InnertubeClientConfig {
  baseUrl: string;
  clientName: string;
  clientVersion: string;
  clientPlatform: string;
  clientNameHeader: string;
  origin: string;
  referer: string;
  userAgent: string;
  defaultLocale: string;
  defaultCountry: string;
  apiKey?: string;
  requestTimeoutMs: number;
  maxRetryAttempts: number;
  retryInitialDelayMs: number;
}

export interface AudioConfig {
  preferredCodecs: ('opus' | 'aac' | 'other')[];
  maxPrefetchCount: number;
}

export interface CacheConfig {
  searchTtlMs: number;
  homeTtlMs: number;
  artistTtlMs: number;
  albumTtlMs: number;
  playlistTtlMs: number;
}

export interface AppConfig {
  innertube: InnertubeClientConfig;
  audio: AudioConfig;
  cache: CacheConfig;
}

export const DEFAULT_INNERTUBE_CONFIG: InnertubeClientConfig = {
  baseUrl: 'https://music.youtube.com/youtubei/v1',
  clientName: 'WEB_REMIX',
  clientVersion: '1.20260101.01.00',
  clientPlatform: 'DESKTOP',
  clientNameHeader: '67',
  origin: 'https://music.youtube.com',
  referer: 'https://music.youtube.com/',
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  defaultLocale: 'en',
  defaultCountry: 'US',
  requestTimeoutMs: 15000,
  maxRetryAttempts: 3,
  retryInitialDelayMs: 500,
};

export const DEFAULT_CONFIG: AppConfig = {
  innertube: DEFAULT_INNERTUBE_CONFIG,
  audio: {
    preferredCodecs: ['opus', 'aac', 'other'],
    maxPrefetchCount: 2,
  },
  cache: {
    searchTtlMs: 60 * 60 * 1000, // 1 hour
    homeTtlMs: 15 * 60 * 1000, // 15 mins
    artistTtlMs: 24 * 60 * 60 * 1000, // 24 hours
    albumTtlMs: 24 * 60 * 60 * 1000, // 24 hours
    playlistTtlMs: 30 * 60 * 1000, // 30 mins
  },
};

export function createAppConfig(overrides?: {
  innertube?: Partial<InnertubeClientConfig>;
  audio?: Partial<AudioConfig>;
  cache?: Partial<CacheConfig>;
}): AppConfig {
  return {
    innertube: {
      ...DEFAULT_CONFIG.innertube,
      ...overrides?.innertube,
    },
    audio: {
      ...DEFAULT_CONFIG.audio,
      ...overrides?.audio,
    },
    cache: {
      ...DEFAULT_CONFIG.cache,
      ...overrides?.cache,
    },
  };
}
