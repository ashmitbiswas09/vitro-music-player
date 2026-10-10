/**
 * Shared domain entities and models for Vitro Music Player.
 * Models are defensive and validate only the essential fields we consume.
 */

import { z } from 'zod';

export const ThumbnailSchema = z.object({
  url: z.string().min(1),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
});
export type Thumbnail = z.infer<typeof ThumbnailSchema>;

export const ArtistBasicSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
});
export type ArtistBasic = z.infer<typeof ArtistBasicSchema>;

export const AlbumBasicSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
});
export type AlbumBasic = z.infer<typeof AlbumBasicSchema>;

export const TrackSchema = z.object({
  id: z.string().min(1), // YouTube videoId
  title: z.string().min(1),
  artists: z.array(ArtistBasicSchema).default([]),
  album: AlbumBasicSchema.optional(),
  durationSeconds: z.number().nonnegative().optional(),
  thumbnails: z.array(ThumbnailSchema).default([]),
  isExplicit: z.boolean().optional(),
  isLive: z.boolean().optional(),
});
export type Track = z.infer<typeof TrackSchema>;

export const ArtistSchema = z.object({
  id: z.string().min(1), // browseId
  name: z.string().min(1),
  thumbnails: z.array(ThumbnailSchema).default([]),
  description: z.string().optional(),
  topTracks: z.array(TrackSchema).optional(),
});
export type Artist = z.infer<typeof ArtistSchema>;

export const AlbumSchema = z.object({
  id: z.string().min(1), // browseId
  title: z.string().min(1),
  artists: z.array(ArtistBasicSchema).default([]),
  year: z.union([z.number(), z.string()]).optional(),
  thumbnails: z.array(ThumbnailSchema).default([]),
  trackCount: z.number().nonnegative().optional(),
  durationSeconds: z.number().nonnegative().optional(),
  tracks: z.array(TrackSchema).optional(),
});
export type Album = z.infer<typeof AlbumSchema>;

export const PlaylistSchema = z.object({
  id: z.string().min(1), // playlistId
  title: z.string().min(1),
  description: z.string().optional(),
  thumbnails: z.array(ThumbnailSchema).default([]),
  author: z.string().optional(),
  trackCount: z.number().nonnegative().optional(),
  tracks: z.array(TrackSchema).optional(),
  continuationToken: z.string().optional(),
});
export type Playlist = z.infer<typeof PlaylistSchema>;

export const AudioCodecSchema = z.enum(['opus', 'aac', 'other']);
export type AudioCodec = z.infer<typeof AudioCodecSchema>;

export const AudioStreamSchema = z.object({
  url: z.string().min(1),
  mimeType: z.string(),
  codec: AudioCodecSchema,
  bitrate: z.number().positive(),
  sampleRate: z.number().positive().optional(),
  contentLength: z.number().positive().optional(),
  expiresAt: z.number().positive(), // Epoch ms
  loudnessDb: z.number().optional(),
});
export type AudioStream = z.infer<typeof AudioStreamSchema>;

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'error';
export type RepeatMode = 'off' | 'one' | 'all';

export interface PlaybackState {
  status: PlaybackStatus;
  currentTrack?: Track;
  positionMs: number;
  durationMs: number;
  isShuffle: boolean;
  repeatMode: RepeatMode;
}
