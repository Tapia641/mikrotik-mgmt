import { describe, expect, it } from 'vitest';

import type { PublicRouter } from '@/types';

import {
  EMPTY_ROUTER_FORM,
  toCreatePayload,
  toFormValues,
  toUpdatePayload,
  type RouterFormValues,
} from './router-payload';

const ROUTER: PublicRouter = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Oficina',
  description: 'Sede central',
  host: '192.168.88.1',
  port: 8728,
  protocol: 'api',
  username: 'admin',
  tlsInsecure: false,
  timeoutMs: 5_000,
  timezone: 'America/Lima',
  currency: 'PEN',
  isActive: true,
  status: 'online',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
  lastError: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
};

function values(patch: Partial<RouterFormValues> = {}): RouterFormValues {
  return { ...EMPTY_ROUTER_FORM, name: 'Nuevo', host: '10.0.0.1', password: 'secreta', ...patch };
}

describe('toFormValues', () => {
  it('precarga el router sin traer la contrasena', () => {
    const result = toFormValues(ROUTER);

    expect(result.name).toBe('Oficina');
    expect(result.host).toBe('192.168.88.1');
    expect(result.port).toBe('8728');
    expect(result.protocol).toBe('api');
    expect(result.currency).toBe('PEN');
    expect(result.description).toBe('Sede central');
    // La contrasena nunca viaja al navegador: el campo arranca vacio.
    expect(result.password).toBe('');
  });

  it('normaliza una descripcion ausente a cadena vacia', () => {
    expect(toFormValues({ ...ROUTER, description: null }).description).toBe('');
  });

  it('fuerza api-ssl para cualquier protocolo cifrado', () => {
    expect(toFormValues({ ...ROUTER, protocol: 'api-ssl' }).protocol).toBe('api-ssl');
  });
});

describe('toCreatePayload', () => {
  it('convierte los strings del formulario en el payload tipado', () => {
    const result = toCreatePayload(
      values({ description: '  Sede  ', currency: 'pen ', timeoutMs: '3000', port: '8729' }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toEqual({
      name: 'Nuevo',
      host: '10.0.0.1',
      port: 8729,
      protocol: 'api',
      username: 'admin',
      description: 'Sede',
      timezone: 'UTC',
      currency: 'PEN',
      timeoutMs: 3000,
      tlsInsecure: false,
      isActive: true,
      password: 'secreta',
    });
  });

  it('omite timeoutMs cuando el campo esta vacio (no envia null)', () => {
    const result = toCreatePayload(values({ timeoutMs: '' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).not.toHaveProperty('timeoutMs');
  });

  it('normaliza una descripcion vacia a null', () => {
    const result = toCreatePayload(values({ description: '   ' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.description).toBeNull();
  });

  it('exige contrasena en el alta', () => {
    const result = toCreatePayload(values({ password: '' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.message).toContain('obligatoria');
  });

  it('rechaza un puerto no numerico sin producir NaN', () => {
    const result = toCreatePayload(values({ port: 'ochenta' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.message).toContain('entero');
  });

  it('rechaza un puerto decimal', () => {
    expect(toCreatePayload(values({ port: '8728.5' })).ok).toBe(false);
  });
});

describe('toUpdatePayload', () => {
  it('omite la contrasena cuando el campo queda vacio', () => {
    const result = toUpdatePayload(values({ password: '', name: ' Renombrado ' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).not.toHaveProperty('password');
    expect(result.value.name).toBe('Renombrado');
  });

  it('incluye la contrasena cuando el usuario escribe una nueva', () => {
    const result = toUpdatePayload(values({ password: 'nueva-clave' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.password).toBe('nueva-clave');
  });

  it('aplica la misma validacion compartida que el alta', () => {
    expect(toUpdatePayload(values({ port: '' })).ok).toBe(false);
    expect(toUpdatePayload(values({ timeoutMs: 'dos' })).ok).toBe(true);
  });
});
