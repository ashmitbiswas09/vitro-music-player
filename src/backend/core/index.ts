/**
 * Core module public API.
 * Shared domain models, Result/errors, logger, config, clock, events, and performance timing.
 */

export * from './types/domain';
export * from './types/errors';
export * from './types/result';
export * from './logger/logger';
export * from './config/config';
export * from './clock/clock';
export * from './events/emitter';
export * from './perf/perf';
export * from './utils/retry';
