import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Sanitized Fixtures Leak Scanner', () => {
  const sanitizedDir = path.resolve(__dirname, '../fixtures/sanitized');
  const recordedDir = path.resolve(__dirname, '../fixtures/recorded');

  it('scans fixtures/sanitized directory and asserts it contains files', () => {
    expect(fs.existsSync(sanitizedDir)).toBe(true);
    const files = fs.readdirSync(sanitizedDir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
  });

  // Extract all known visitorData tokens from raw recordings to ensure none leaked
  const knownVisitorTokens = new Set<string>();
  if (fs.existsSync(recordedDir)) {
    const recordedFiles = fs.readdirSync(recordedDir).filter((f) => f.endsWith('.json'));
    for (const file of recordedFiles) {
      const content = fs.readFileSync(path.join(recordedDir, file), 'utf-8');
      const matches = content.match(
        /(?:visitorData|visitor_data)["']?\s*[:=]\s*["']([^"'\r\n]{10,})["']/gi,
      );
      if (matches) {
        for (const m of matches) {
          const valMatch = m.match(/["']([^"'\r\n]{10,})["']$/);
          if (valMatch && valMatch[1] && valMatch[1] !== '[REDACTED]') {
            knownVisitorTokens.add(valMatch[1]);
          }
        }
      }
    }
  }

  const files = fs.existsSync(sanitizedDir)
    ? fs.readdirSync(sanitizedDir).filter((f) => f.endsWith('.json'))
    : [];

  describe.each(files)('Fixture: %s', (filename) => {
    const filePath = path.join(sanitizedDir, filename);
    const rawContent = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(rawContent);

    it('contains no ip= followed by a real IP address (IPv4 or IPv6)', () => {
      // Real IPv4: 4 octets separated by dots
      const ipv4Match = rawContent.match(/(?:[?&]|\b)ip=(?:\d{1,3}\.){3}\d{1,3}/i);
      expect(
        ipv4Match,
        `Found real IPv4 address in ${filename}: ${ipv4Match ? ipv4Match[0] : ''}`,
      ).toBeNull();

      // Real IPv6: hex colons
      const ipv6Match = rawContent.match(
        /(?:[?&]|\b)ip=(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}/i,
      );
      expect(
        ipv6Match,
        `Found real IPv6 address in ${filename}: ${ipv6Match ? ipv6Match[0] : ''}`,
      ).toBeNull();

      // Any non-redacted ip= parameter
      const nonRedactedIp = rawContent.match(/(?:[?&]|\b)ip=(?!\[REDACTED\])[^&"'\s\\]+/i);
      expect(
        nonRedactedIp,
        `Found non-redacted ip= parameter in ${filename}: ${nonRedactedIp ? nonRedactedIp[0] : ''}`,
      ).toBeNull();
    });

    it('contains no non-redacted sig= or lsig=', () => {
      const nonRedactedSig = rawContent.match(
        /(?:[?&]|\b)(?:sig|lsig)=(?!\[REDACTED\])[^&"'\s\\]+/i,
      );
      expect(
        nonRedactedSig,
        `Found non-redacted sig= or lsig= in ${filename}: ${nonRedactedSig ? nonRedactedSig[0] : ''}`,
      ).toBeNull();
    });

    it('contains no non-redacted bui= or identifying parameters', () => {
      const nonRedactedBui = rawContent.match(/(?:[?&]|\b)bui=(?!\[REDACTED\])[^&"'\s\\]+/i);
      expect(
        nonRedactedBui,
        `Found non-redacted bui= parameter in ${filename}: ${nonRedactedBui ? nonRedactedBui[0] : ''}`,
      ).toBeNull();
    });

    it('contains no unredacted visitorData values or tokens', () => {
      // 1. Check raw visitor patterns
      const rawVisitorMatch = rawContent.match(
        /(["']?(?:visitorData|visitor_data|visitor-id|visitor_id)["']?\s*[:=]\s*["'])(?!\[REDACTED\])([^"'\r\n]+)(["'])/i,
      );
      expect(
        rawVisitorMatch,
        `Found unredacted visitorData in ${filename}: ${rawVisitorMatch ? rawVisitorMatch[0] : ''}`,
      ).toBeNull();

      // 2. Check X-Goog-Visitor-Id header
      const visitorHeaderMatch = rawContent.match(
        /(?:x-goog-visitor-id:\s*)(?!\[REDACTED\])[^\r\n]+/i,
      );
      expect(
        visitorHeaderMatch,
        `Found unredacted x-goog-visitor-id in ${filename}: ${visitorHeaderMatch ? visitorHeaderMatch[0] : ''}`,
      ).toBeNull();

      // 3. Check against all known real visitor tokens extracted from recorded fixtures
      for (const token of knownVisitorTokens) {
        expect(
          rawContent.includes(token),
          `Found raw visitorData token in ${filename}: ${token.slice(0, 20)}...`,
        ).toBe(false);
      }

      // 4. Recursive inspection of parsed JSON object for visitorData / visitor_data keys
      function inspectObjectForVisitorData(obj: unknown, pathStr = ''): void {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
          obj.forEach((item, idx) => inspectObjectForVisitorData(item, `${pathStr}[${idx}]`));
          return;
        }

        const record = obj as Record<string, unknown>;
        // Check { key: "visitor_data", value: "..." }
        if (
          typeof record.key === 'string' &&
          /visitor.*(?:data|id)/i.test(record.key) &&
          'value' in record
        ) {
          expect(
            record.value,
            `Expected parameter pair at ${pathStr} for ${record.key} to be redacted, got ${String(record.value)}`,
          ).toBe('[REDACTED]');
        }

        for (const [key, val] of Object.entries(record)) {
          if (/visitor.*(?:data|id)/i.test(key) && typeof val === 'string') {
            expect(val, `Expected property at ${pathStr}.${key} to be [REDACTED], got ${val}`).toBe(
              '[REDACTED]',
            );
          } else {
            inspectObjectForVisitorData(val, `${pathStr}.${key}`);
          }
        }
      }

      inspectObjectForVisitorData(parsed);
    });

    it('contains nothing cookie-like', () => {
      // Cookie and Set-Cookie headers
      const cookieHeaderMatch = rawContent.match(
        /(?:^|["'\s])(?:cookie|set-cookie)\s*[:=]\s*["']?(?!\[REDACTED\])[^"'\r\n]+/i,
      );
      expect(
        cookieHeaderMatch,
        `Found unredacted cookie header in ${filename}: ${cookieHeaderMatch ? cookieHeaderMatch[0] : ''}`,
      ).toBeNull();

      // Cookie name-value pairs (SID, HSID, SSID, APISID, SAPISID, LOGIN_INFO, etc.)
      const cookieTokenMatch = rawContent.match(
        /(?:SID|HSID|SSID|APISID|SAPISID|LOGIN_INFO|VISITOR_INFO1_LIVE|YSC|__Secure-[^=]+)=(?!\[REDACTED\])[^;,\s"&]+/i,
      );
      expect(
        cookieTokenMatch,
        `Found unredacted cookie token in ${filename}: ${cookieTokenMatch ? cookieTokenMatch[0] : ''}`,
      ).toBeNull();

      // Recursive check on parsed object
      function inspectObjectForCookies(obj: unknown, pathStr = ''): void {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
          obj.forEach((item, idx) => inspectObjectForCookies(item, `${pathStr}[${idx}]`));
          return;
        }

        const record = obj as Record<string, unknown>;
        for (const [key, val] of Object.entries(record)) {
          if (/^(?:cookie|set-cookie)$/i.test(key) && typeof val === 'string') {
            expect(
              val,
              `Expected cookie key at ${pathStr}.${key} to be [REDACTED], got ${val}`,
            ).toBe('[REDACTED]');
          } else {
            inspectObjectForCookies(val, `${pathStr}.${key}`);
          }
        }
      }

      inspectObjectForCookies(parsed);
    });
  });
});
