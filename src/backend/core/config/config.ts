/**
 * Default core configuration and constants for Vitro Music Player.
 */

export interface AppConfig {
  innertube: {
    baseUrl: string;
    clientName: string;
    clientVersion: string;
    userAgent: string;
    defaultLocale: string;
    defaultCountry: string;
    requestTimeoutMs: number;
  };
  audio: {
    preferredCodecs: ('opus' | 'aac' | 'other')[];
    maxPrefetchCount: number;
  };
  cache: {
    searchTtlMs: number;
    homeTtlMs: number;
    artistTtlMs: number;
    albumTtlMs: number;
    playlistTtlMs: number;
  };
}

export const DEFAULT_CONFIG: AppConfig = {
  innertube: {
    baseUrl: 'https://music.youtube.com/youtubei/v1',
    clientName: 'WEB_REMIX',
    clientVersion: '1.20240101.01.00',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    defaultLocale: 'en',
    defaultCountry: 'US',
    requestTimeoutMs: 15000,
  },
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
