/**
 * VisionOS InnerTube Stream Strategy.
 * Impersonates Apple Vision Pro client context, returning direct, unencrypted HTTPS audio formats.
 */

import type { AudioCodec, Clock, Logger } from '@/backend/core';
import type { HttpClient } from '@/backend/platform';
import { BaseInnertubeStreamStrategy } from './base-strategy';

export interface VisionOsStrategyOptions {
  preferredCodecs?: AudioCodec[];
  clock?: Clock;
  logger?: Logger;
}

export class VisionOsStreamStrategy extends BaseInnertubeStreamStrategy {
  constructor(httpClient: HttpClient, options: VisionOsStrategyOptions = {}) {
    super(httpClient, {
      name: 'visionos',
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
      preferredCodecs: options.preferredCodecs,
      clock: options.clock,
      logger: options.logger,
    });
  }
}
