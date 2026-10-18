import { describe, expect, it } from 'vitest';

import {
  asBoolean,
  asInteger,
  asJson,
  asNullableString,
  asNumber,
  asString,
  buildWhere,
  cond,
  NO_WHERE,
} from './base.repository';

describe('buildWhere', () => {
  it('devuelve NO_WHERE sin condiciones utiles', () => {
    expect(buildWhere([])).toEqual(NO_WHERE);
    expect(buildWhere([false, undefined, null])).toEqual(NO_WHERE);
  });

  it('une condiciones con AND y concatena los parametros en orden', () => {
    const where = buildWhere([
      cond('deleted_at IS NULL'),
      cond('status = ?', 'online'),
      false,
      cond('name LIKE ?', '%rb%'),
    ]);

    expect(where.sql).toBe('WHERE deleted_at IS NULL AND status = ? AND name LIKE ?');
    expect(where.params).toEqual(['online', '%rb%']);
  });
});

describe('decodificadores', () => {
  it('asString normaliza NULL/undefined a cadena vacia', () => {
    expect(asString('hola')).toBe('hola');
    expect(asString(42)).toBe('42');
    expect(asString(null)).toBe('');
    expect(asString(undefined)).toBe('');
  });

  it('asNullableString conserva el NULL logico', () => {
    expect(asNullableString(null)).toBeNull();
    expect(asNullableString(undefined)).toBeNull();
    expect(asNullableString('x')).toBe('x');
  });

  it('asNumber/asInteger convierten y caen a 0 ante basura', () => {
    expect(asNumber(12.5)).toBe(12.5);
    expect(asNumber('12.5')).toBe(12.5);
    expect(asInteger('12.9')).toBe(12);
    expect(asNumber(null)).toBe(0);
    expect(asNumber('no-es-numero')).toBe(0);
  });

  it('asBoolean interpreta el 0/1 de SQLite', () => {
    expect(asBoolean(1)).toBe(true);
    expect(asBoolean('1')).toBe(true);
    expect(asBoolean(0)).toBe(false);
    expect(asBoolean(null)).toBe(false);
  });

  it('asJson deserializa y cae al fallback si el contenido es invalido', () => {
    expect(asJson<string[]>('["a","b"]', [])).toEqual(['a', 'b']);
    expect(asJson<number[]>('{ roto', [])).toEqual([]);
    expect(asJson<string[]>('', ['x'])).toEqual(['x']);
    expect(asJson<string[]>(null, ['x'])).toEqual(['x']);
  });
});
