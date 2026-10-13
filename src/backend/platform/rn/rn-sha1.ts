/**
 * React Native / Expo implementation of Sha1Port using expo-crypto.
 */

import * as Crypto from 'expo-crypto';
import type { Sha1Port } from '../types';

export class RnSha1 implements Sha1Port {
  async digestHex(data: string): Promise<string> {
    return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA1, data);
  }
}
