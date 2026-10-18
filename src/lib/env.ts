import type { AppEnv, LogLevel, NodeEnv } from '@/types';

/**
 * Acceso tipado y centralizado a `process.env`.
 * `src/lib` es una capa hoja: no importa nada de `core`/`database`/`app`.
 *
 * TODO(env): validar con zod al arranque (fallar rapido si falta
 * SESSION_SECRET o ENCRYPTION_KEY en produccion) y cachear el resultado.
 */

function readString(key: string, fallback: string): string {
  const value = process.env[key];
  return value !== undefined && value.trim() !== '' ? value.trim() : fallback;
}

function readNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readNodeEnv(): NodeEnv {
  const raw = process.env.NODE_ENV;
  return raw === 'production' || raw === 'test' ? raw : 'development';
}

const LOG_LEVELS: readonly LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

function readLogLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL;
  return LOG_LEVELS.includes(raw as LogLevel) ? (raw as LogLevel) : 'info';
}

export const env: AppEnv = {
  NODE_ENV: readNodeEnv(),
  APP_NAME: readString('APP_NAME', 'MikroTik Web Manager'),
  APP_URL: readString('APP_URL', 'http://localhost:3000'),
  DATABASE_FILE: readString('DATABASE_FILE', './data/mikrotik-manager.sqlite'),
  SESSION_SECRET: readString('SESSION_SECRET', 'dev-only-insecure-secret-change-me'),
  SESSION_TTL_SECONDS: readNumber('SESSION_TTL_SECONDS', 60 * 60 * 12),
  ENCRYPTION_KEY: readString('ENCRYPTION_KEY', ''),
  MIKROTIK_API_PORT: readNumber('MIKROTIK_API_PORT', 8728),
  MIKROTIK_API_SSL_PORT: readNumber('MIKROTIK_API_SSL_PORT', 8729),
  MIKROTIK_DEFAULT_TIMEOUT_MS: readNumber('MIKROTIK_DEFAULT_TIMEOUT_MS', 8000),
  MIKROTIK_POOL_MAX_CONNECTIONS: readNumber('MIKROTIK_POOL_MAX_CONNECTIONS', 8),
  LOG_LEVEL: readLogLevel(),
};

/** `true` si faltan secretos obligatorios (bloquear arranque en produccion). */
export const hasInsecureDefaults =
  env.SESSION_SECRET === 'dev-only-insecure-secret-change-me' || env.ENCRYPTION_KEY === '';
