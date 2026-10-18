import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { ApiError, ApiResponse } from '@/types';

import { conflict, notFound } from '@/core/errors';
import { MikrotikError } from '@/core/mikrotik';

import { handleRoute, readIntParam, readJson, readSortDirection, toApiFailure } from './http';

const schema = z.object({
  username: z.string().min(3, 'Minimo 3 caracteres.'),
});

function jsonRequest(body: string): Request {
  return new Request('http://localhost/api/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

async function bodyOf<T>(response: Response): Promise<ApiResponse<T>> {
  return (await response.json()) as ApiResponse<T>;
}

describe('toApiFailure', () => {
  it('traduce un DomainError con su estado', () => {
    const failure = toApiFailure(conflict('Ya existe.'));

    expect(failure).toMatchObject({ code: 'CONFLICT', status: 409, message: 'Ya existe.' });
  });

  it('traduce un error de validacion de zod a fieldErrors', () => {
    const parsed = schema.safeParse({ username: 'ab' });
    if (parsed.success) throw new Error('el esquema debio fallar');

    const failure = toApiFailure(parsed.error);

    expect(failure.code).toBe('VALIDATION_ERROR');
    expect(failure.status).toBe(422);
    expect(failure.fieldErrors).toEqual({ username: ['Minimo 3 caracteres.'] });
  });

  it('agrupa varios errores del mismo campo', () => {
    const wide = z.object({ a: z.string().min(5), b: z.number() });
    const parsed = wide.safeParse({ a: 'x', b: 'no' });
    if (parsed.success) throw new Error('el esquema debio fallar');

    const failure = toApiFailure(parsed.error);

    expect(Object.keys(failure.fieldErrors ?? {})).toEqual(['a', 'b']);
  });

  it('traduce un fallo de RouterOS a 502 con el codigo de origen', () => {
    const failure = toApiFailure(
      new MikrotikError({ code: 'CONNECTION_REFUSED', message: 'sin router', command: '/ip/route/print' }),
    );

    expect(failure).toMatchObject({
      code: 'ROUTER_UNREACHABLE',
      status: 502,
      message: 'sin router',
    });
    expect(failure.details).toEqual({
      mikrotikCode: 'CONNECTION_REFUSED',
      command: '/ip/route/print',
    });
  });

  it('usa 504 para el timeout del router', () => {
    const failure = toApiFailure(new MikrotikError({ code: 'CONNECTION_TIMEOUT', message: 'lento' }));

    expect(failure).toMatchObject({ code: 'ROUTER_TIMEOUT', status: 504 });
  });

  it('no filtra el detalle de un error inesperado', () => {
    const failure = toApiFailure(new Error('password=secreto en la traza'));

    expect(failure.code).toBe('INTERNAL_ERROR');
    expect(failure.status).toBe(500);
    expect(failure.message).toBe('Error interno del servidor.');
  });

  it('incluye el requestId cuando se pasa', () => {
    const failure = toApiFailure(notFound('Router', 'id-1'), 'req-1');

    expect(failure.requestId).toBe('req-1');
  });
});

describe('handleRoute', () => {
  it('envuelve el dato exitoso con meta.requestId', async () => {
    const response = await handleRoute(() => ({ hola: 'mundo' }));
    const body = await bodyOf<{ hola: string }>(response);

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    if (!body.ok) return;
    expect(body.data).toEqual({ hola: 'mundo' });
    expect(body.meta?.requestId).toBeTypeOf('string');
  });

  it('respeta el estado de creacion', async () => {
    const response = await handleRoute(() => ({ id: '1' }), { status: 201 });

    expect(response.status).toBe(201);
  });

  it('convierte una excepcion de dominio en respuesta de error', async () => {
    const response = await handleRoute(() => {
      throw notFound('Router', 'id-9');
    });
    const body = await bodyOf<never>(response);

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
    if (body.ok) return;
    expect(body.error).toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('convierte un error inesperado en 500 generico', async () => {
    const response = await handleRoute(() => {
      throw new TypeError('boom interno');
    });
    const body = await bodyOf<never>(response);

    expect(response.status).toBe(500);
    if (body.ok) return;
    expect((body.error as ApiError).message).toBe('Error interno del servidor.');
  });

  it('ejecuta onResponse tanto en exito como en fallo', async () => {
    const touched: number[] = [];

    await handleRoute(() => 1, { onResponse: (response) => touched.push(response.status) });
    await handleRoute(() => {
      throw conflict('dup');
    }, { onResponse: (response) => touched.push(response.status) });

    expect(touched).toEqual([200, 409]);
  });
});

describe('readJson', () => {
  it('devuelve el cuerpo validado y tipado', async () => {
    const result = await readJson(jsonRequest(JSON.stringify({ username: 'ana' })), schema);

    expect(result).toEqual({ username: 'ana' });
  });

  it('lanza BAD_REQUEST si el cuerpo no es JSON', async () => {
    await expect(readJson(jsonRequest('{no-json'), schema)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('propaga el error de zod si no cumple el esquema', async () => {
    const parsed = await readJson(jsonRequest(JSON.stringify({ username: 'a' })), schema).catch(
      (cause: unknown) => cause,
    );

    expect(parsed).toBeInstanceOf(Error);
    expect(toApiFailure(parsed).code).toBe('VALIDATION_ERROR');
  });

  it('descarta claves desconocidas (zod por defecto)', async () => {
    const result = await readJson(
      jsonRequest(JSON.stringify({ username: 'ana', role: 'owner' })),
      schema,
    );

    expect(result).toEqual({ username: 'ana' });
  });
});

describe('readIntParam / readSortDirection', () => {
  it('usa el valor por defecto si falta o no es numerico', () => {
    const query = new URLSearchParams();

    expect(readIntParam(query, 'page', 1, { min: 1, max: 100 })).toBe(1);

    query.set('page', 'abc');
    expect(readIntParam(query, 'page', 1, { min: 1, max: 100 })).toBe(1);

    query.set('page', '');
    expect(readIntParam(query, 'page', 1, { min: 1, max: 100 })).toBe(1);
  });

  it('acota al rango permitido', () => {
    const query = new URLSearchParams({ page: '0', pageSize: '99999' });

    expect(readIntParam(query, 'page', 1, { min: 1, max: 100 })).toBe(1);
    expect(readIntParam(query, 'pageSize', 20, { min: 1, max: 200 })).toBe(200);
  });

  it('lee la direccion de orden', () => {
    expect(readSortDirection(new URLSearchParams())).toBe('desc');
    expect(readSortDirection(new URLSearchParams({ sortDirection: 'asc' }))).toBe('asc');
    expect(readSortDirection(new URLSearchParams({ sortDirection: 'asc' }), 'asc')).toBe('asc');
    expect(readSortDirection(new URLSearchParams({ sortDirection: 'raro' }))).toBe('desc');
  });

  it('respeta desc explicito aunque el valor por defecto sea asc', () => {
    expect(readSortDirection(new URLSearchParams({ sortDirection: 'desc' }), 'asc')).toBe('desc');
    expect(readSortDirection(new URLSearchParams({ sortDirection: 'asc' }), 'asc')).toBe('asc');
    expect(readSortDirection(new URLSearchParams(), 'asc')).toBe('asc');
  });
});
