/**
 * VisionOS InnerTube Stream Strategy.
 * Impersonates Apple Vision Pro client context, returning direct, unencrypted HTTPS audio formats.
 */

import { INNERTUBE_CLIENT_CONFIGS, type AudioCodec, type Clock, type Logger } from '@/backend/core';
import type { HttpClient } from '@/backend/platform';
import { BaseInnertubeStreamStrategy } from './base-strategy';

export interface VisionOsStrategyOptions {
  preferredCodecs?: AudioCodec[];
  clock?: Clock;
  logger?: Logger;
}

export class VisionOsStreamStrategy extends BaseInnertubeStreamStrategy {
  constructor(httpClient: HttpClient, options: VisionOsStrategyOptions = {}) {
    const config = INNERTUBE_CLIENT_CONFIGS.VISIONOS;
    super(httpClient, {
      name: 'visionos',
      clientName: config.clientName,
      clientVersion: config.clientVersion,
      clientPlatform: config.clientPlatform,
      clientNameHeader: config.clientNameHeader,
      userAgent: config.userAgent,
      extraClientContext: config.extraClientContext,
      preferredCodecs: options.preferredCodecs,
      clock: options.clock,
      logger: options.logger,
    });
  }
}
