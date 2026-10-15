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

export const INNERTUBE_CLIENT_CONFIGS = {
  WEB_REMIX: {
    clientName: 'WEB_REMIX',
    clientVersion: '1.20260101.01.00',
    clientPlatform: 'DESKTOP',
    clientNameHeader: '67',
    origin: 'https://music.youtube.com',
    referer: 'https://music.youtube.com/',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  },
  VISIONOS: {
    clientName: 'VISIONOS',
    clientVersion: '1.02',
    clientPlatform: 'MOBILE',
    clientNameHeader: '101',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
    extraClientContext: {
      deviceMake: 'Apple',
      deviceModel: 'RealityDevice17,1',
      osName: 'visionOS',
      osVersion: '26.5.23O471',
    },
  },
  ANDROID_VR: {
    clientName: 'ANDROID_VR',
    clientVersion: '1.65.10',
    clientPlatform: 'ANDROID',
    clientNameHeader: '28',
    userAgent:
      'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
    extraClientContext: {
      deviceMake: 'Oculus',
      deviceModel: 'Quest 3',
      androidSdkVersion: 32,
      osName: 'Android',
      osVersion: '12L',
    },
  },
} as const;

export const DEFAULT_INNERTUBE_CONFIG: InnertubeClientConfig = {
  baseUrl: 'https://music.youtube.com/youtubei/v1',
  clientName: INNERTUBE_CLIENT_CONFIGS.WEB_REMIX.clientName,
  clientVersion: INNERTUBE_CLIENT_CONFIGS.WEB_REMIX.clientVersion,
  clientPlatform: INNERTUBE_CLIENT_CONFIGS.WEB_REMIX.clientPlatform,
  clientNameHeader: INNERTUBE_CLIENT_CONFIGS.WEB_REMIX.clientNameHeader,
  origin: INNERTUBE_CLIENT_CONFIGS.WEB_REMIX.origin,
  referer: INNERTUBE_CLIENT_CONFIGS.WEB_REMIX.referer,
  userAgent: INNERTUBE_CLIENT_CONFIGS.WEB_REMIX.userAgent,
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
