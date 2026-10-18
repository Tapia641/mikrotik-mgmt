/**
 * Utilidades transversales sin dependencias externas.
 * `src/lib` es una capa hoja (no importa `core`, `database` ni `app`).
 */

type ClassValue = string | number | null | undefined | false | ClassValue[];

/** Une clases condicionales (sustituto propio de `clsx`). */
export function cn(...values: ClassValue[]): string {
  const out: string[] = [];

  const walk = (value: ClassValue): void => {
    if (!value && value !== 0) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    out.push(String(value));
  };

  for (const value of values) walk(value);
  return out.join(' ');
}

/** `1234567` → `"1.21 MB"` (base 1024, 2 decimales). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 2)} ${units[exponent]}`;
}

/** Formatea un monto con su moneda (`IDR`, `PEN`, `USD`...). */
export function formatCurrency(amount: number, currency: string, locale = 'es-PE'): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** `"2M/2M"` → `{ uploadBps: 2_000_000, downloadBps: 2_000_000 }`. */
export function parseRosRateLimit(rateLimit: string | null): {
  uploadBps: number;
  downloadBps: number;
} | null {
  if (!rateLimit) return null;
  const [upload = '0', download = '0'] = rateLimit.split('/');
  return { uploadBps: parseRosBits(upload), downloadBps: parseRosBits(download) };
}

function parseRosBits(token: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*([kKmMgG]?)/.exec(token.trim());
  if (!match) return 0;
  const amount = Number(match[1] ?? 0);
  const suffix = (match[2] ?? '').toLowerCase();
  const factor = suffix === 'k' ? 1_000 : suffix === 'm' ? 1_000_000 : suffix === 'g' ? 1_000_000_000 : 1;
  return Math.round(amount * factor);
}

/** `"1w2d3h"` → segundos. Devuelve `null` para `null`/`"0"`/inválido. */
export function parseRosDuration(duration: string | null): number | null {
  if (!duration) return null;
  const match = /^(?:(\d+)w)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(duration.trim());
  if (!match) return null;

  const [, w, d, h, m, s] = match;
  const seconds =
    Number(w ?? 0) * 604800 +
    Number(d ?? 0) * 86400 +
    Number(h ?? 0) * 3600 +
    Number(m ?? 0) * 60 +
    Number(s ?? 0);

  return seconds > 0 ? seconds : null;
}
