/**
 * Streaming module public barrel API.
 * StreamResolver port, pluggable strategies, and audio format parsing.
 */

export const STREAMING_MODULE_NAME = 'streaming' as const;

export type {
  StreamResolver,
  StreamResolverOptions,
  StreamStrategy,
  ResolvedStream,
  ResolveOptions,
  StreamVerificationOptions,
  StreamVerificationResult,
  FullVerificationOptions,
  FullVerificationResult,
} from './types';

export { DefaultStreamResolver } from './resolver';

export { BaseInnertubeStreamStrategy, type BaseStrategyConfig } from './strategies/base-strategy';
export {
  VisionOsStreamStrategy,
  type VisionOsStrategyOptions,
} from './strategies/visionos-strategy';
export {
  AndroidVrStreamStrategy,
  type AndroidVrStrategyOptions,
} from './strategies/android-vr-strategy';
export {
  AuthenticatedStreamStrategy,
  type AuthenticatedStrategyConfig,
} from './strategies/authenticated-strategy';

export {
  parsePlayerResponse,
  selectBestAudioFormat,
  parseCodec,
  parseExpiresAt,
  type PlayerFormatRaw,
  type PlayerResponse,
  type ParsedPlayerResult,
} from './parsers/player-parser';
