/**
 * Android VR InnerTube Stream Strategy.
 * Impersonates Meta Quest 3 Android VR client context, returning direct, unencrypted HTTPS audio formats.
 */

import { INNERTUBE_CLIENT_CONFIGS, type AudioCodec, type Clock, type Logger } from '@/backend/core';
import type { HttpClient } from '@/backend/platform';
import { BaseInnertubeStreamStrategy } from './base-strategy';

export interface AndroidVrStrategyOptions {
  preferredCodecs?: AudioCodec[];
  clock?: Clock;
  logger?: Logger;
}

export class AndroidVrStreamStrategy extends BaseInnertubeStreamStrategy {
  constructor(httpClient: HttpClient, options: AndroidVrStrategyOptions = {}) {
    const config = INNERTUBE_CLIENT_CONFIGS.ANDROID_VR;
    super(httpClient, {
      name: 'android_vr',
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
