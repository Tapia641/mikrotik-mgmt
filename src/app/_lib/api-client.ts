import type { ApiResponse } from '@/types';

/**
 * Cliente HTTP del panel.
 *
 * Envuelve `fetch` para que la UI trabaje con el dato o con un
 * `ApiClientError` ya legible, en lugar de manejar `unknown` en cada componente:
 * el borde de la API garantiza la forma `ApiResponse<T>`.
 */

export class ApiClientError extends Error {
  public override readonly name = 'ApiClientError';

  public readonly code: string;
  public readonly status: number;
  public readonly fieldErrors: Readonly<Record<string, readonly string[]>> | undefined;

  public constructor(shape: {
    readonly code: string;
    readonly message: string;
    readonly status: number;
    readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
  }) {
    super(shape.message);
    this.code = shape.code;
    this.status = shape.status;
    this.fieldErrors = shape.fieldErrors;
  }
}

/** Mensaje mostrable de cualquier fallo capturado en la UI. */
export function messageOf(cause: unknown): string {
  if (cause instanceof ApiClientError) return cause.message;
  if (cause instanceof Error) return cause.message;

  return 'Ocurrio un error inesperado.';
}

/**
 * Lanza la peticion y devuelve el dato, o lanza `ApiClientError`.
 * Un cuerpo no-JSON (proxy caido, 502 de un gateway) tambien es un error claro.
 */
export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiClientError({
      code: 'NETWORK_ERROR',
      message: 'No se pudo contactar con el servidor.',
      status: 0,
    });
  }

  let payload: ApiResponse<T>;
  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new ApiClientError({
      code: 'INTERNAL_ERROR',
      message: `Respuesta no valida del servidor (HTTP ${response.status}).`,
      status: response.status,
    });
  }

  if (!payload.ok) {
    throw new ApiClientError({
      code: payload.error.code,
      message: payload.error.message,
      status: payload.error.status,
      ...(payload.error.fieldErrors === undefined ? {} : { fieldErrors: payload.error.fieldErrors }),
    });
  }

  return payload.data;
}

/** Errores de campo de un `ApiClientError` (o un objeto vacio). */
export function fieldErrorsOf(cause: unknown): Readonly<Record<string, readonly string[]>> {
  return cause instanceof ApiClientError ? (cause.fieldErrors ?? {}) : {};
}
