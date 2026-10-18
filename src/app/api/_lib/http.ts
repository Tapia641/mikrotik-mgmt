import { NextResponse } from 'next/server';
import type { ZodType } from 'zod';

import type { ApiError, ApiMeta, ApiResponse, AppError, SortDirection } from '@/types';

import { isDomainError, badRequest } from '@/core/errors';
import { isMikrotikError, toApiErrorCode } from '@/core/mikrotik';

/**
 * Borde HTTP: traduce el mundo de dominio (Result, DomainError, MikrotikError,
 * ZodError) al contrato `ApiResponse` que consume la UI.
 *
 * Todo Route Handler pasa por `handleRoute`, de modo que ningun fallo se escapa
 * sin envolver ni sin codigo de estado.
 */

export interface HandleRouteOptions<T = unknown> {
  /** Codigo HTTP de exito (201 en creaciones, 200 por defecto). */
  readonly status?: number;
  /**
   * Ajusta la respuesta antes de devolverla (p. ej. depositar la cookie de
   * sesion). No puede cambiar el cuerpo ni el estado.
   */
  readonly onResponse?: (response: NextResponse<ApiResponse<T>>) => void;
}

/** Errores de zod detectados estructuralmente (estable entre versiones). */
interface ZodIssueLike {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

function readZodIssues(cause: unknown): readonly ZodIssueLike[] | null {
  if (!(cause instanceof Error)) return null;

  const issues = (cause as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return null;

  return issues as readonly ZodIssueLike[];
}

function toFieldErrors(issues: readonly ZodIssueLike[]): Readonly<Record<string, readonly string[]>> {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of issues) {
    const key = issue.path.map((segment) => String(segment)).join('.') || '_root';
    (fieldErrors[key] ??= []).push(issue.message);
  }

  return fieldErrors;
}

/** `ApiError` a partir de un error ya materializado del dominio. */
export function toApiError(error: AppError, requestId?: string): ApiError {
  return {
    code: error.code,
    message: error.message,
    status: error.status,
    ...(error.details === undefined ? {} : { details: error.details }),
    ...(requestId === undefined ? {} : { requestId }),
  };
}

/**
 * Traduce CUALQUIER fallo al contrato `ApiError`.
 * Orden: validacion (zod) → dominio → RouterOS → inesperado.
 */
export function toApiFailure(cause: unknown, requestId?: string): ApiError {
  const issues = readZodIssues(cause);
  if (issues) {
    return {
      code: 'VALIDATION_ERROR',
      message: 'La peticion no supero la validacion.',
      status: 422,
      fieldErrors: toFieldErrors(issues),
      ...(requestId === undefined ? {} : { requestId }),
    };
  }

  if (isDomainError(cause)) return toApiError(cause, requestId);

  if (isMikrotikError(cause)) {
    return {
      code: toApiErrorCode(cause.code),
      message: cause.message,
      status: cause.apiErrorCode === 'ROUTER_TIMEOUT' ? 504 : 502,
      details: { mikrotikCode: cause.code, command: cause.command ?? null },
      ...(requestId === undefined ? {} : { requestId }),
    };
  }

  return {
    // Un bug NO se filtra al cliente: el mensaje generico va al usuario y el
    // detalle real queda en el `cause` de la traza del servidor.
    code: 'INTERNAL_ERROR',
    message: 'Error interno del servidor.',
    status: 500,
    ...(requestId === undefined ? {} : { requestId }),
  };
}

/** Envuelve un payload de exito en `ApiResponse`. */
export function jsonOk<T>(
  data: T,
  options: HandleRouteOptions<T> & { readonly meta?: Omit<ApiMeta, 'requestId'> } = {},
): NextResponse<ApiResponse<T>> {
  const requestId = globalThis.crypto.randomUUID();

  return NextResponse.json<ApiResponse<T>>(
    {
      ok: true,
      data,
      meta: { requestId, ...(options.meta ?? {}) },
    },
    { status: options.status ?? 200 },
  );
}

/**
 * Ejecuta el handler y garantiza la forma de la respuesta.
 * El valor devuelto se marca como dato exitoso; cualquier error se traduce.
 */
export async function handleRoute<T>(
  handler: () => Promise<T> | T,
  options: HandleRouteOptions<T> = {},
): Promise<NextResponse<ApiResponse<T>>> {
  const requestId = globalThis.crypto.randomUUID();

  try {
    const data = await handler();
    const response = NextResponse.json<ApiResponse<T>>(
      { ok: true, data, meta: { requestId } },
      { status: options.status ?? 200 },
    );

    options.onResponse?.(response);

    return response;
  } catch (cause) {
    const error = toApiFailure(cause, requestId);
    const response = NextResponse.json<ApiResponse<T>>({ ok: false, error }, { status: error.status });

    options.onResponse?.(response);

    return response;
  }
}

/** Lee y valida el cuerpo JSON. Lanza `DomainError`/`ZodError` si no es valido. */
export async function readJson<TOutput>(request: Request, schema: ZodType<TOutput>): Promise<TOutput> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    throw badRequest('El cuerpo de la peticion debe ser JSON valido.');
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw parsed.error;

  return parsed.data;
}

/** Query param entero con tope, usado por los listados paginados. */
export function readIntParam(
  query: URLSearchParams,
  key: string,
  fallback: number,
  bounds: { readonly min: number; readonly max: number },
): number {
  const raw = query.get(key);
  if (raw === null || raw.trim() === '') return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;

  return Math.min(bounds.max, Math.max(bounds.min, parsed));
}

/**
 * Direccion de orden valida; cualquiera otra (o ausente) cae al valor por
 * defecto. Se aceptan ambos valores explicitos para que un listado pueda fijar
 * su direccion natural (`desc` para fechas, `asc` para nombres).
 */
export function readSortDirection(
  query: URLSearchParams,
  fallback: 'asc' | 'desc' = 'desc',
): SortDirection {
  const raw = query.get('sortDirection');

  return raw === 'asc' || raw === 'desc' ? raw : fallback;
}
