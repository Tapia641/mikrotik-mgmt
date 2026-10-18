/**
 * Limitador de tasa en memoria (ventana deslizante por clave).
 *
 * Es un guardarrail por proceso: protege endpoints sensibles (login) de
 * fuerza bruta. No es distribuido; para varios procesos hay que mover el
 * estado a Redis/SQLite.
 */
export interface RateLimiter {
  /** Devuelve `true` si la peticion esta permitida. */
  check(key: string): boolean;
  /** Reinicia el contador de una clave (p. ej. tras un login exitoso). */
  reset(key: string): void;
}

export interface RateLimiterOptions {
  readonly max: number;
  readonly windowMs: number;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const buckets = new Map<string, number[]>();

  return {
    check(key) {
      const now = Date.now();
      const cutoff = now - options.windowMs;
      const timestamps = (buckets.get(key) ?? []).filter((t) => t > cutoff);

      if (timestamps.length >= options.max) {
        buckets.set(key, timestamps);

        return false;
      }

      timestamps.push(now);
      buckets.set(key, timestamps);

      return true;
    },

    reset(key) {
      buckets.delete(key);
    },
  };
}

/** Limitador por defecto para el endpoint de login. */
export const loginRateLimiter = createRateLimiter({ max: 5, windowMs: 60_000 });