/**
 * Defensive Zod-based parser for YouTube player endpoint responses.
 * Extracts, sorts, and selects the highest-bitrate direct audio stream (Opus/AAC).
 */

import { z } from 'zod';
import {
  type AudioCodec,
  type AudioStream,
  AudioStreamSchema,
  StreamError,
  type StreamErrorReason,
  type Result,
  ok,
  err,
} from '@/backend/core';

export const PlayerFormatRawSchema = z.object({
  itag: z.number(),
  url: z.string().optional(),
  cipher: z.string().optional(),
  signatureCipher: z.string().optional(),
  mimeType: z.string(),
  bitrate: z.number(),
  averageBitrate: z.number().optional(),
  contentLength: z.union([z.string(), z.number()]).optional(),
  audioQuality: z.string().optional(),
  audioSampleRate: z.union([z.string(), z.number()]).optional(),
  audioChannels: z.number().optional(),
  loudnessDb: z.number().optional(),
  approxDurationMs: z.union([z.string(), z.number()]).optional(),
});

export type PlayerFormatRaw = z.infer<typeof PlayerFormatRawSchema>;

export const PlayerStreamingDataSchema = z.object({
  expiresInSeconds: z.union([z.string(), z.number()]).optional(),
  formats: z.array(PlayerFormatRawSchema).optional(),
  adaptiveFormats: z.array(PlayerFormatRawSchema).optional(),
});

export const PlayerResponseSchema = z.object({
  playabilityStatus: z
    .object({
      status: z.string(),
      reason: z.string().optional(),
      playableInEmbed: z.boolean().optional(),
    })
    .optional(),
  streamingData: PlayerStreamingDataSchema.optional(),
  videoDetails: z
    .object({
      videoId: z.string().optional(),
      title: z.string().optional(),
      author: z.string().optional(),
      channelId: z.string().optional(),
      lengthSeconds: z.union([z.string(), z.number()]).optional(),
    })
    .optional(),
});

export type PlayerResponse = z.infer<typeof PlayerResponseSchema>;

export interface ParsedPlayerResult {
  stream: AudioStream;
  videoDetails?: {
    videoId?: string;
    title?: string;
    author?: string;
    lengthSeconds?: number;
  };
  rawFormat: PlayerFormatRaw;
}

export function parseCodec(mimeType: string): AudioCodec {
  const normalized = mimeType.toLowerCase();
  if (
    normalized.includes('codecs="opus"') ||
    normalized.includes("codecs='opus'") ||
    normalized.includes('opus')
  ) {
    return 'opus';
  }
  if (
    normalized.includes('codecs="mp4a') ||
    normalized.includes("codecs='mp4a") ||
    normalized.includes('mp4a') ||
    normalized.includes('aac')
  ) {
    return 'aac';
  }
  return 'other';
}

export function parseExpiresAt(
  streamUrl: string,
  expiresInSeconds: string | number | undefined,
  nowMs: number,
): number {
  try {
    const urlObj = new URL(streamUrl);
    const expireParam = urlObj.searchParams.get('expire');
    if (expireParam) {
      const epochSec = Number(expireParam);
      if (!Number.isNaN(epochSec) && epochSec > 0) {
        return epochSec * 1000;
      }
    }
  } catch {
    // If streamUrl cannot be parsed as a URL, fall back to expiresInSeconds
  }

  const ttlSeconds = Number(expiresInSeconds);
  if (!Number.isNaN(ttlSeconds) && ttlSeconds > 0) {
    return nowMs + ttlSeconds * 1000;
  }

  // Fallback to standard 6 hours if unspecified
  return nowMs + 6 * 60 * 60 * 1000;
}

export function selectBestAudioFormat(
  formats: PlayerFormatRaw[],
  preferredCodecs: AudioCodec[],
  expiresInSeconds: string | number | undefined,
  nowMs: number,
): { stream: AudioStream; rawFormat: PlayerFormatRaw } | null {
  // Only consider formats with direct playable URL and audio mimeType
  const playableAudio = formats.filter(
    (f) =>
      typeof f.url === 'string' &&
      f.url.length > 0 &&
      f.mimeType.toLowerCase().startsWith('audio/'),
  );

  if (playableAudio.length === 0) {
    return null;
  }

  // Sort by preferred codec first, then highest bitrate
  playableAudio.sort((a, b) => {
    const aCodec = parseCodec(a.mimeType);
    const bCodec = parseCodec(b.mimeType);

    const aRank = preferredCodecs.indexOf(aCodec);
    const bRank = preferredCodecs.indexOf(bCodec);

    const effectiveARank = aRank === -1 ? 999 : aRank;
    const effectiveBRank = bRank === -1 ? 999 : bRank;

    if (effectiveARank !== effectiveBRank) {
      return effectiveARank - effectiveBRank;
    }

    return b.bitrate - a.bitrate;
  });

  const best = playableAudio[0];
  const codec = parseCodec(best.mimeType);
  const expiresAt = parseExpiresAt(best.url!, expiresInSeconds, nowMs);

  const sampleRate = best.audioSampleRate ? Number(best.audioSampleRate) : undefined;
  const contentLength = best.contentLength ? Number(best.contentLength) : undefined;

  const candidateStream: AudioStream = {
    url: best.url!,
    mimeType: best.mimeType,
    codec,
    bitrate: best.bitrate,
    sampleRate: sampleRate && !Number.isNaN(sampleRate) ? sampleRate : undefined,
    contentLength: contentLength && !Number.isNaN(contentLength) ? contentLength : undefined,
    expiresAt,
    loudnessDb: best.loudnessDb !== undefined ? Number(best.loudnessDb.toFixed(2)) : undefined,
  };

  const validation = AudioStreamSchema.safeParse(candidateStream);
  if (!validation.success) {
    return null;
  }

  return {
    stream: validation.data,
    rawFormat: best,
  };
}

export function parsePlayerResponse(
  raw: unknown,
  options: {
    videoId: string;
    preferredCodecs?: AudioCodec[];
    nowMs: number;
  },
): Result<ParsedPlayerResult, StreamError> {
  const { videoId, preferredCodecs = ['opus', 'aac', 'other'], nowMs } = options;

  const parsed = PlayerResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return err(
      new StreamError(
        `Failed to parse player response: ${parsed.error.message}`,
        videoId,
        'NO_FORMATS',
        { validationErrors: parsed.error.issues },
      ),
    );
  }

  const { playabilityStatus, streamingData, videoDetails } = parsed.data;

  // Check playability
  if (playabilityStatus) {
    const status = playabilityStatus.status.toUpperCase();
    if (status !== 'OK') {
      const reasonText = playabilityStatus.reason ?? status;
      const lowerReason = reasonText.toLowerCase();

      let typedReason: StreamErrorReason = 'UNPLAYABLE';
      let recoverableWithAuth = false;

      if (
        status === 'LOGIN_REQUIRED' ||
        lowerReason.includes('sign in') ||
        lowerReason.includes('confirm you’re not a bot') ||
        lowerReason.includes("confirm you're not a bot") ||
        lowerReason.includes('age')
      ) {
        typedReason = 'LOGIN_REQUIRED';
        recoverableWithAuth = true;
      } else if (
        status === 'LIVE_STREAM_OFFLINE' ||
        lowerReason.includes('live stream') ||
        lowerReason.includes('streamed live')
      ) {
        typedReason = 'LIVE_STREAM';
        recoverableWithAuth = false;
      } else if (
        lowerReason.includes('processing') ||
        lowerReason.includes('check back later')
      ) {
        typedReason = 'PROCESSING';
        recoverableWithAuth = false;
      } else if (
        status === 'ERROR' ||
        lowerReason.includes('unavailable') ||
        lowerReason.includes('removed') ||
        lowerReason.includes('private')
      ) {
        typedReason = 'UNAVAILABLE';
        recoverableWithAuth = lowerReason.includes('private') || lowerReason.includes('members');
      }

      return err(
        new StreamError(
          `Video is not playable (${status}): ${reasonText}`,
          videoId,
          typedReason,
          { status, reason: reasonText },
          undefined,
          recoverableWithAuth,
        ),
      );
    }
  }

  if (!streamingData) {
    return err(new StreamError('Player response is missing streamingData', videoId, 'NO_FORMATS'));
  }

  const allFormats = [...(streamingData.formats ?? []), ...(streamingData.adaptiveFormats ?? [])];

  const selection = selectBestAudioFormat(
    allFormats,
    preferredCodecs,
    streamingData.expiresInSeconds,
    nowMs,
  );

  if (!selection) {
    return err(
      new StreamError(
        `No direct playable audio streams found for videoId "${videoId}"`,
        videoId,
        'NO_FORMATS',
        { totalFormatsFound: allFormats.length },
      ),
    );
  }

  const parsedDetails = videoDetails
    ? {
        videoId: videoDetails.videoId,
        title: videoDetails.title,
        author: videoDetails.author,
        lengthSeconds: videoDetails.lengthSeconds ? Number(videoDetails.lengthSeconds) : undefined,
      }
    : undefined;

  return ok({
    stream: selection.stream,
    videoDetails: parsedDetails,
    rawFormat: selection.rawFormat,
  });
}
