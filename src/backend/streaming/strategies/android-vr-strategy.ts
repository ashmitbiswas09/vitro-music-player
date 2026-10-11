/**
 * Android VR InnerTube Stream Strategy.
 * Impersonates Meta Quest 3 Android VR client context, returning direct, unencrypted HTTPS audio formats.
 */

import type { AudioCodec, Clock, Logger } from '@/backend/core';
import type { HttpClient } from '@/backend/platform';
import { BaseInnertubeStreamStrategy } from './base-strategy';

export interface AndroidVrStrategyOptions {
  preferredCodecs?: AudioCodec[];
  clock?: Clock;
  logger?: Logger;
}

export class AndroidVrStreamStrategy extends BaseInnertubeStreamStrategy {
  constructor(httpClient: HttpClient, options: AndroidVrStrategyOptions = {}) {
    super(httpClient, {
      name: 'android_vr',
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
      preferredCodecs: options.preferredCodecs,
      clock: options.clock,
      logger: options.logger,
    });
  }
}
