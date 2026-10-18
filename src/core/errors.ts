import type { ApiErrorCode, AppError } from '@/types';

import { API_ERROR_STATUS } from './constants';

/**
 * Error de dominio materializado (`AppError` de `@/types`).
 *
 * Es parte del *shared kernel*: lo usan tanto `core/services` como
 * `database/repositories`, sin que ninguno dependa del otro.
 * El borde HTTP lo traduce a `ApiError` (ver `AppError.toApiError` en la fase de API).
 */
export class DomainError extends Error implements AppError {
  public override readonly name = 'DomainError';

  public readonly code: ApiErrorCode;
  public readonly status: number;
  public readonly details: Readonly<Record<string, unknown>> | undefined;

  public constructor(shape: {
    readonly code: ApiErrorCode;
    readonly message: string;
    readonly status?: number;
    readonly details?: Readonly<Record<string, unknown>>;
    readonly cause?: unknown;
  }) {
    super(shape.message, { cause: shape.cause });
    this.code = shape.code;
    this.status = shape.status ?? API_ERROR_STATUS[shape.code];
    this.details = shape.details;
  }

  /** `true` cuando el problema es del cliente (4xx), no del servidor. */
  public get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}

/* ── Constructores semanticos (los usan repositorios y servicios) ───────── */

export function notFound(entity: string, id: string): DomainError {
  return new DomainError({
    code: 'NOT_FOUND',
    message: `${entity} no encontrado: ${id}`,
    details: { entity, id },
  });
}

export function conflict(message: string, details?: Readonly<Record<string, unknown>>): DomainError {
  return new DomainError({ code: 'CONFLICT', message, details });
}

export function invalidInput(
  message: string,
  details?: Readonly<Record<string, unknown>>,
): DomainError {
  return new DomainError({ code: 'VALIDATION_ERROR', message, details });
}

export function unauthorized(message = 'No autenticado'): DomainError {
  return new DomainError({ code: 'UNAUTHORIZED', message });
}

export function forbidden(message = 'Acceso denegado'): DomainError {
  return new DomainError({ code: 'FORBIDDEN', message });
}

/** `badRequest` y el resto de codigos que no tienen factory propia. */
export function badRequest(message: string, details?: Readonly<Record<string, unknown>>): DomainError {
  return new DomainError({ code: 'BAD_REQUEST', message, details });
}

export function rateLimited(
  message = 'Demasiadas peticiones. Intenta de nuevo en unos segundos.',
): DomainError {
  return new DomainError({ code: 'RATE_LIMITED', message });
}

export function internalError(message = 'Error interno del servidor'): DomainError {
  return new DomainError({ code: 'INTERNAL_ERROR', message });
}

/**
 * Garantiza un `Error` real: los servicios propagan `AppError` por el canal
 * `Result` y el borde HTTP necesita lanzar algo que lleve traza.
 */
export function toDomainError(error: AppError): DomainError {
  if (isDomainError(error)) return error;

  return new DomainError({
    code: error.code,
    message: error.message,
    status: error.status,
    details: error.details,
  });
}
