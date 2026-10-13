/**
 * Auth module public API.
 * Cookie/session storage, signed-request header generation, session checks, and logout.
 */

export const AUTH_MODULE_NAME = 'auth' as const;

export * from './types';
export * from './session-store';
export * from './sapisid-hasher';
export * from './auth-service';
