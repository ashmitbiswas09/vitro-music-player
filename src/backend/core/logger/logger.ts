/**
 * Redacting logger for Vitro Music Player.
 * Automatically sanitizes sensitive tokens, cookies, authorization headers, and personal data.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: unknown, context?: LogContext): void;
  child(context: LogContext): Logger;
}

export type LogHandler = (level: LogLevel, message: string, context?: LogContext) => void;

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /cookie/i,
  /authorization/i,
  /sapisid/i,
  /session/i,
  /visitor.*data/i,
  /visitor.*id/i,
  /^ip$/i,
  /client_?ip/i,
  /^bui$/i,
  /(?:^|_)api_?key/i,
  /private_?key/i,
  /secret_?key/i,
  /auth_?key/i,
  /signing_?key/i,
];

const WHOLE_HEADER_PATTERNS: { regex: RegExp; replacement: string }[] = [
  // Redact whole Cookie and Set-Cookie headers in strings
  { regex: /(set-cookie:\s*)[^\r\n]+/gi, replacement: '$1[REDACTED]' },
  { regex: /(cookie:\s*)[^\r\n]+/gi, replacement: '$1[REDACTED]' },
  // Redact any Authorization header scheme in strings
  { regex: /(authorization:\s*)[^\r\n]+/gi, replacement: '$1[REDACTED]' },
  // Redact X-Goog-Visitor-Id header in strings
  { regex: /(x-goog-visitor-id:\s*)[^\r\n]+/gi, replacement: '$1[REDACTED]' },
];

const SENSITIVE_STRING_PATTERNS: { regex: RegExp; replacement: string }[] = [
  // Any authorization scheme keyword: Bearer, Basic, Digest, OAuth, SAPISIDHASH, HMAC, etc.
  {
    regex: /\b(Bearer|Basic|Digest|OAuth|SAPISIDHASH|HMAC)\s+[\w\-._~+/]+=*/gi,
    replacement: '$1 [REDACTED]',
  },
  // Identifying and signed stream URL query parameters (ip, ipbits, client_ip, remote_ip, bui, sig, lsig, signature, s, key, token, auth, visitor_data, visitorData, visitor_id, session, session_id)
  {
    regex:
      /([?&](?:ip|ipbits|client_ip|remote_ip|bui|sig|lsig|signature|s|key|token|auth|visitor_data|visitorData|visitor_id|session|session_id)=)[^&"'\s\\;,]+/gi,
    replacement: '$1[REDACTED]',
  },
  // Standalone ip parameter (IPv4, IPv6, or query-like)
  {
    regex: /\b((?:client_?|remote_?)?ip=)(?!\[REDACTED\])[^&"'\s\\;,]+/gi,
    replacement: '$1[REDACTED]',
  },
  // Standalone sig, lsig, signature, bui parameter
  {
    regex: /\b((?:l?sig|signature|bui)=)(?!\[REDACTED\])[^&"'\s\\;,]+/gi,
    replacement: '$1[REDACTED]',
  },
  // Standalone cookie tokens
  {
    regex: /(SID|HSID|SSID|APISID|SAPISID|LOGIN_INFO|VISITOR_INFO1_LIVE|YSC)=[^;,\s"&]+/gi,
    replacement: '$1=[REDACTED]',
  },
  { regex: /__Secure-[^=]+=[^;,\s"&]+/gi, replacement: '__Secure-[REDACTED]=[REDACTED]' },
  // VisitorData patterns in key-value text or JSON
  {
    regex:
      /(["']?(?:visitorData|visitor_data|visitor-id|visitor_id)["']?\s*[:=]\s*["'])(?!\[REDACTED\])(?:Cg[A-Za-z0-9%_-]{15,}|[^"'\s\r\n]+)(["'])/gi,
    replacement: '$1[REDACTED]$2',
  },
];

export function redactString(input: string): string {
  let sanitized = input;
  for (const { regex, replacement } of WHOLE_HEADER_PATTERNS) {
    sanitized = sanitized.replace(regex, replacement);
  }
  for (const { regex, replacement } of SENSITIVE_STRING_PATTERNS) {
    sanitized = sanitized.replace(regex, replacement);
  }
  return sanitized;
}

export function redactValue(val: unknown, seen = new WeakSet()): unknown {
  if (val === null || val === undefined) {
    return val;
  }

  if (typeof val === 'string') {
    return redactString(val);
  }

  if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'bigint') {
    return val;
  }

  if (val instanceof Error) {
    return {
      name: val.name,
      message: redactString(val.message),
      stack: val.stack ? redactString(val.stack) : undefined,
    };
  }

  if (typeof val === 'object') {
    if (seen.has(val)) {
      return '[Circular]';
    }
    seen.add(val);

    if (Array.isArray(val)) {
      return val.map((item) => redactValue(item, seen));
    }

    // Check if this object represents a parameter pair (like YouTube's { key: "visitor_data", value: "..." })
    const isParamPair =
      typeof (val as Record<string, unknown>).key === 'string' &&
      'value' in (val as Record<string, unknown>);
    const paramKey = isParamPair ? ((val as Record<string, unknown>).key as string) : '';
    const isSensitiveParam =
      isParamPair &&
      /visitor.*data|visitor.*id|^ip$|client.*ip|bui|cookie|token|auth|session|secret/i.test(
        paramKey,
      );

    const result: Record<string, unknown> = {};
    for (const [key, propVal] of Object.entries(val as Record<string, unknown>)) {
      if (isSensitiveParam && key === 'value') {
        result[key] = '[REDACTED]';
        continue;
      }

      // 1. Check for whole header keys (cookie, set-cookie, authorization)
      const isWholeHeaderKey = /^(?:cookie|set-cookie|authorization)$/i.test(key);
      if (isWholeHeaderKey) {
        result[key] = '[REDACTED]';
        continue;
      }

      // 2. Check for general sensitive keys
      const isSensitiveKey = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
      if (isSensitiveKey) {
        if (typeof propVal === 'object' && propVal !== null && !Array.isArray(propVal)) {
          result[key] = redactValue(propVal, seen);
        } else {
          result[key] = '[REDACTED]';
        }
      } else {
        result[key] = redactValue(propVal, seen);
      }
    }
    return result;
  }

  return String(val);
}

export interface LoggerOptions {
  level?: LogLevel;
  prefix?: string;
  handler?: LogHandler;
}

const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class RedactingLogger implements Logger {
  private readonly minLevel: LogLevel;
  private readonly prefix?: string;
  private readonly context: LogContext;
  private readonly handler: LogHandler;

  constructor(options: LoggerOptions = {}, context: LogContext = {}) {
    this.minLevel = options.level ?? 'info';
    this.prefix = options.prefix;
    this.context = context;
    this.handler = options.handler ?? defaultLogHandler;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_SEVERITY[level] >= LOG_LEVEL_SEVERITY[this.minLevel];
  }

  private formatMessage(msg: string): string {
    const sanitized = redactString(msg);
    return this.prefix ? `[${this.prefix}] ${sanitized}` : sanitized;
  }

  private mergeContext(extra?: LogContext): LogContext | undefined {
    if (!this.context && !extra) return undefined;
    const combined = { ...this.context, ...extra };
    return redactValue(combined) as LogContext;
  }

  debug(message: string, context?: LogContext): void {
    if (!this.shouldLog('debug')) return;
    this.handler('debug', this.formatMessage(message), this.mergeContext(context));
  }

  info(message: string, context?: LogContext): void {
    if (!this.shouldLog('info')) return;
    this.handler('info', this.formatMessage(message), this.mergeContext(context));
  }

  warn(message: string, context?: LogContext): void {
    if (!this.shouldLog('warn')) return;
    this.handler('warn', this.formatMessage(message), this.mergeContext(context));
  }

  error(message: string, error?: unknown, context?: LogContext): void {
    if (!this.shouldLog('error')) return;
    const errorDetails = error ? { error: redactValue(error) } : undefined;
    const merged = { ...errorDetails, ...context };
    this.handler('error', this.formatMessage(message), this.mergeContext(merged));
  }

  child(extraContext: LogContext): Logger {
    return new RedactingLogger(
      {
        level: this.minLevel,
        prefix: this.prefix,
        handler: this.handler,
      },
      { ...this.context, ...extraContext },
    );
  }
}

function defaultLogHandler(level: LogLevel, message: string, context?: LogContext): void {
  const timestamp = new Date().toISOString();
  const contextStr =
    context && Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : '';
  const out = `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`;

  switch (level) {
    case 'error':
      console.warn(out);
      break;
    case 'warn':
      console.warn(out);
      break;
    case 'info':
      console.info(out);
      break;
    case 'debug':
      console.debug(out);
      break;
  }
}

export function createLogger(options?: LoggerOptions): Logger {
  return new RedactingLogger(options);
}

export const logger: Logger = createLogger();


export class SilentLogger implements Logger {
  debug(_message: string, _context?: LogContext): void {}
  info(_message: string, _context?: LogContext): void {}
  warn(_message: string, _context?: LogContext): void {}
  error(_message: string, _error?: unknown, _context?: LogContext): void {}
  child(_context?: LogContext): Logger {
    return this;
  }
}
