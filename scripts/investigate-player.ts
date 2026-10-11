import { FetchHttpClient } from '@/backend/platform';
import fs from 'node:fs';
import path from 'node:path';

interface ClientSetup {
  name: string;
  url: string;
  clientName: string;
  clientVersion: string;
  clientPlatform?: string;
  clientNameHeader?: string;
  userAgent: string;
  extraContext?: any;
}

const CLIENT_CANDIDATES: ClientSetup[] = [
  {
    name: 'ANDROID_VR',
    url: 'https://www.youtube.com/youtubei/v1/player',
    clientName: 'ANDROID_VR',
    clientVersion: '1.65.10',
    clientPlatform: 'ANDROID',
    clientNameHeader: '28',
    userAgent:
      'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
    extraContext: {
      context: {
        client: {
          clientName: 'ANDROID_VR',
          clientVersion: '1.65.10',
          deviceMake: 'Oculus',
          deviceModel: 'Quest 3',
          androidSdkVersion: 32,
          osName: 'Android',
          osVersion: '12L',
        },
      },
    },
  },
  {
    name: 'IOS',
    url: 'https://www.youtube.com/youtubei/v1/player',
    clientName: 'IOS',
    clientVersion: '21.26.4',
    clientPlatform: 'IOS',
    clientNameHeader: '5',
    userAgent: 'com.google.ios.youtube/21.26.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
    extraContext: {
      context: {
        client: {
          clientName: 'IOS',
          clientVersion: '21.26.4',
          deviceMake: 'Apple',
          deviceModel: 'iPhone16,2',
          osName: 'iPhone',
          osVersion: '18.3.2.22D82',
        },
      },
    },
  },
  {
    name: 'ANDROID',
    url: 'https://www.youtube.com/youtubei/v1/player',
    clientName: 'ANDROID',
    clientVersion: '21.26.364',
    clientPlatform: 'ANDROID',
    clientNameHeader: '3',
    userAgent: 'com.google.android.youtube/21.26.364 (Linux; U; Android 11) gzip',
    extraContext: {
      context: {
        client: {
          clientName: 'ANDROID',
          clientVersion: '21.26.364',
          androidSdkVersion: 30,
          osName: 'Android',
          osVersion: '11',
        },
      },
    },
  },
  {
    name: 'VISIONOS',
    url: 'https://www.youtube.com/youtubei/v1/player',
    clientName: 'VISIONOS',
    clientVersion: '1.02',
    clientPlatform: 'MOBILE',
    clientNameHeader: '101',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
    extraContext: {
      context: {
        client: {
          clientName: 'VISIONOS',
          clientVersion: '1.02',
          deviceMake: 'Apple',
          deviceModel: 'RealityDevice17,1',
          osName: 'visionOS',
          osVersion: '26.5.23O471',
        },
      },
    },
  },
  {
    name: 'TVHTML5',
    url: 'https://www.youtube.com/youtubei/v1/player',
    clientName: 'TVHTML5',
    clientVersion: '7.20260707.07.00',
    clientPlatform: 'TV',
    clientNameHeader: '7',
    userAgent:
      'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/25.lts.30.1034943-gold (unlike Gecko), Unknown_TV_Unknown_0/Unknown (Unknown, Unknown)',
  },
  {
    name: 'WEB_MUSIC',
    url: 'https://music.youtube.com/youtubei/v1/player',
    clientName: 'WEB_REMIX',
    clientVersion: '1.20260707.12.00',
    clientPlatform: 'WEB',
    clientNameHeader: '67',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  },
];

async function getGuestVisitorData(): Promise<string | undefined> {
  try {
    const res = await fetch('https://music.youtube.com', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    const html = await res.text();
    const match = html.match(/"VISITOR_DATA":\s*"([^"]+)"/);
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

async function testCandidate(candidate: ClientSetup, videoId: string, visitorData?: string) {
  const http = new FetchHttpClient();
  const recordedDir = path.resolve(__dirname, '../fixtures/recorded');
  fs.mkdirSync(recordedDir, { recursive: true });

  console.log(`\n========================================`);
  console.log(`Testing Client: ${candidate.name} at ${candidate.url}`);
  console.log(`========================================`);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': candidate.userAgent,
  };
  if (candidate.clientNameHeader) {
    headers['X-YouTube-Client-Name'] = candidate.clientNameHeader;
    headers['X-YouTube-Client-Version'] = candidate.clientVersion;
  }
  if (visitorData) {
    headers['X-Goog-Visitor-Id'] = visitorData;
  }

  const clientObj: Record<string, any> = {
    clientName: candidate.clientName,
    clientVersion: candidate.clientVersion,
    clientPlatform: candidate.clientPlatform ?? 'DESKTOP',
    hl: 'en',
    gl: 'US',
    utcOffsetMinutes: 0,
  };
  if (visitorData) {
    clientObj.visitorData = visitorData;
  }

  const body: any = {
    context: {
      client: clientObj,
      user: {
        lockedSafetyMode: false,
      },
      request: {
        useSsl: true,
      },
    },
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
  };

  if (candidate.extraContext) {
    // deep merge
    if (candidate.extraContext.playbackContext) {
      body.playbackContext = candidate.extraContext.playbackContext;
    }
    if (candidate.extraContext.context?.client) {
      Object.assign(body.context.client, candidate.extraContext.context.client);
    }
  }

  const start = performance.now();
  const res = await http.post<any>(candidate.url, body, {
    headers,
    timeoutMs: 15000,
  });
  const duration = performance.now() - start;

  if (!res.ok) {
    console.log(`[Error] Request failed in ${duration.toFixed(2)} ms: ${res.error.message}`);
    console.log(`[Error Details]:`, JSON.stringify(res.error.details, null, 2));
    return;
  }

  const data = res.value.data;
  const fixturePath = path.join(
    recordedDir,
    `player_${candidate.name.toLowerCase()}_${videoId}.json`,
  );
  fs.writeFileSync(fixturePath, JSON.stringify(data, null, 2), 'utf-8');

  console.log(`[Status] HTTP ${res.value.status} in ${duration.toFixed(2)} ms`);
  console.log(
    `[Playability] Status: ${data.playabilityStatus?.status}, Reason: ${data.playabilityStatus?.reason ?? 'none'}`,
  );

  const streamingData = data.streamingData;
  if (!streamingData) {
    console.log(`[StreamingData] MISSING streamingData!`);
    return;
  }

  const formats = streamingData.formats || [];
  const adaptiveFormats = streamingData.adaptiveFormats || [];
  console.log(
    `[StreamingData] formats: ${formats.length}, adaptiveFormats: ${adaptiveFormats.length}`,
  );
  console.log(`[StreamingData] expiresInSeconds: ${streamingData.expiresInSeconds}`);

  const allFormats = [...formats, ...adaptiveFormats];
  const audioFormats = allFormats.filter((f: any) => f.mimeType?.startsWith('audio/'));
  console.log(`[Audio Formats Found]: ${audioFormats.length}`);

  for (const af of audioFormats) {
    const hasDirectUrl = typeof af.url === 'string' && af.url.length > 0;
    const hasCipher = !!(af.signatureCipher || af.cipher);
    console.log(
      `  - itag: ${af.itag}, mime: ${af.mimeType}, bitrate: ${af.bitrate}, directUrl: ${hasDirectUrl}, cipher: ${hasCipher}`,
    );

    if (hasDirectUrl) {
      console.log(`    Testing Range request (0-1023)...`);
      const rangeStart = performance.now();
      try {
        const verifyRes = await fetch(af.url, {
          method: 'GET',
          headers: {
            Range: 'bytes=0-1023',
            'User-Agent': candidate.userAgent,
          },
        });
        const rangeDuration = performance.now() - rangeStart;
        console.log(`    --> Range Status: ${verifyRes.status} in ${rangeDuration.toFixed(2)} ms`);
        console.log(`    --> Content-Type: ${verifyRes.headers.get('content-type')}`);
        console.log(`    --> Content-Range: ${verifyRes.headers.get('content-range')}`);
        const buf = await verifyRes.arrayBuffer();
        console.log(`    --> Bytes received: ${buf.byteLength}`);
        if (verifyRes.status === 200 || verifyRes.status === 206) {
          console.log(`    [SUCCESS] Stream is DIRECTLY PLAYABLE!`);
        } else {
          console.log(`    [FAIL] HTTP ${verifyRes.status}`);
        }
      } catch (err: any) {
        console.log(`    [FAIL] Range request error: ${err.message}`);
      }
    }
  }
}

async function main() {
  const videoId = process.argv[2] || '9RfVp-GhKfs';
  console.log(`Investigating Player Endpoint for videoId: "${videoId}"...`);
  const visitorData = await getGuestVisitorData();
  console.log(
    `Using guest visitorData: ${visitorData ? visitorData.slice(0, 15) + '...' : 'none'}`,
  );

  for (const candidate of CLIENT_CANDIDATES) {
    await testCandidate(candidate, videoId, visitorData);
    await new Promise((r) => setTimeout(r, 600));
  }
}

main().catch(console.error);
