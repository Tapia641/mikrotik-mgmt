/** Presentacion de valores tecnicos de RouterOS en la UI. */

const DASH = '—';

/** Fecha/hora local legible; `null` o invalida → guion. */
export function formatDateTime(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return DASH;

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? DASH : parsed.toLocaleString('es-ES');
}

/** Bits por segundo con unidad adaptada (bps / kbps / Mbps / Gbps). */
export function formatBitsPerSecond(bits: number): string {
  if (!Number.isFinite(bits) || bits <= 0) return '0 bps';
  if (bits < 1_000) return `${Math.round(bits)} bps`;
  if (bits < 1_000_000) return `${(bits / 1_000).toFixed(1)} kbps`;
  if (bits < 1_000_000_000) return `${(bits / 1_000_000).toFixed(2)} Mbps`;

  return `${(bits / 1_000_000_000).toFixed(2)} Gbps`;
}

/** Bytes con unidad binaria adaptada. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'] as const;
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit] ?? 'B'}`;
}

/** Porcentaje entero acotado a [0, 100]. */
export function percentage(used: number, total: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return 0;

  return Math.min(100, Math.max(0, Math.round((used / total) * 100)));
}
