import { describe, it, expect } from 'vitest';
import {
  createLogger,
  SilentLogger,
  redactString,
  redactValue,
  type LogContext,
  type LogLevel,
} from '@/backend/core';

describe('Logger with Sensitive Data Redaction', () => {
  it('redacts Authorization bearer tokens and SAPISIDHASH in strings', () => {
    const raw = 'Header Authorization: Bearer ya29.a0AfH6SM... and SAPISIDHASH 1699999999_abcdef';
    const redacted = redactString(raw);
    expect(redacted).not.toContain('ya29.a0AfH6SM');
    expect(redacted).not.toContain('1699999999_abcdef');
    expect(redacted).toContain('Bearer [REDACTED]');
    expect(redacted).toContain('SAPISIDHASH [REDACTED]');
  });

  it('redacts sensitive cookies in strings', () => {
    const cookieHeader =
      'SID=abc123456; HSID=def789; SAPISID=sec999; __Secure-3PAPISID=xyz000; other=ok';
    const redacted = redactString(cookieHeader);
    expect(redacted).toContain('SID=[REDACTED]');
    expect(redacted).toContain('SAPISID=[REDACTED]');
    expect(redacted).toContain('__Secure-[REDACTED]=[REDACTED]');
    expect(redacted).not.toContain('abc123456');
    expect(redacted).not.toContain('sec999');
  });

  it('redacts sensitive object keys recursively', () => {
    const payload = {
      username: 'tester',
      password: 'superSecretPassword',
      token: 'jwt.token.here',
      session: {
        cookies: 'SID=secret_cookie',
        visitorData: 'Cgt2aXNpdG9y',
      },
      headers: {
        authorization: 'Bearer secret_token',
      },
      safeField: 12345,
    };

    const sanitized = redactValue(payload) as Record<string, unknown>;
    expect(sanitized.username).toBe('tester');
    expect(sanitized.password).toBe('[REDACTED]');
    expect(sanitized.token).toBe('[REDACTED]');
    expect((sanitized.session as Record<string, unknown>).cookies).toBe('[REDACTED]');
    expect((sanitized.session as Record<string, unknown>).visitorData).toBe('[REDACTED]');
    expect((sanitized.headers as Record<string, unknown>).authorization).toBe('[REDACTED]');
    expect(sanitized.safeField).toBe(12345);
  });

  it('safely handles circular references without infinite loops', () => {
    const circularObj: Record<string, unknown> = { name: 'cyclic' };
    circularObj.self = circularObj;

    const sanitized = redactValue(circularObj) as Record<string, unknown>;
    expect(sanitized.name).toBe('cyclic');
    expect(sanitized.self).toBe('[Circular]');
  });

  it('logs messages and context through custom handler', () => {
    const logs: { level: LogLevel; message: string; context?: LogContext }[] = [];
    const logger = createLogger({
      level: 'debug',
      prefix: 'Test',
      handler: (level, message, context) => {
        logs.push({ level, message, context });
      },
    });

    logger.info('User logged in', { token: 'secretToken123', userId: 'user_42' });

    expect(logs).toHaveLength(1);
    expect(logs[0].message).toBe('[Test] User logged in');
    expect(logs[0].context?.userId).toBe('user_42');
    expect(logs[0].context?.token).toBe('[REDACTED]');
  });

  it('supports child loggers with merged context', () => {
    const logs: { level: LogLevel; message: string; context?: LogContext }[] = [];
    const parent = createLogger({
      level: 'info',
      handler: (level, message, context) => logs.push({ level, message, context }),
    });

    const child = parent.child({ module: 'innertube', secret: 'hidden' });
    child.warn('Warning triggered', { action: 'retry' });

    expect(logs).toHaveLength(1);
    expect(logs[0].context?.module).toBe('innertube');
    expect(logs[0].context?.action).toBe('retry');
    expect(logs[0].context?.secret).toBe('[REDACTED]');
  });

  it('SilentLogger suppresses all output', () => {
    const silent = new SilentLogger();
    expect(() => {
      silent.debug('d');
      silent.info('i');
      silent.warn('w');
      silent.error('e');
      silent.child().info('child');
    }).not.toThrow();
  });
});
