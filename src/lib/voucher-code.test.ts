import { describe, expect, it } from 'vitest';

import { generateCode, generateVoucherPairs, resolveAlphabet } from '@/lib/voucher-code';

describe('voucher-code: alfabetos', () => {
  it('resolveAlphabet devuelve el preset', () => {
    expect(resolveAlphabet({ length: 4, charset: 'numeric' })).toBe('0123456789');
  });

  it('custom elimina duplicados', () => {
    expect(resolveAlphabet({ length: 4, charset: 'custom', custom: 'aabb' })).toBe('ab');
  });

  it('custom vacio lanza', () => {
    expect(() => resolveAlphabet({ length: 4, charset: 'custom' })).toThrow();
  });
});

describe('voucher-code: generateCode', () => {
  it('respeta la longitud', () => {
    const code = generateCode({ length: 8, charset: 'numeric' }, () => 0.5);

    expect(code).toHaveLength(8);
    expect(code).toMatch(/^[0-9]+$/);
  });

  it('longitud invalida lanza', () => {
    expect(() => generateCode({ length: 0, charset: 'numeric' })).toThrow();
  });
});

describe('voucher-code: generateVoucherPairs', () => {
  it('username-password genera pares distintos', () => {
    let n = 0;
    const rng = () => (n++ % 997) / 997;
    const pairs = generateVoucherPairs(
      { mode: 'username-password', quantity: 3, codeLength: 4, charset: 'numeric' },
      rng,
    );

    expect(pairs).toHaveLength(3);
    for (const pair of pairs) {
      expect(pair.code).toHaveLength(4);
      expect(pair.password).not.toBeNull();
    }
  });

  it('username-only deja password null', () => {
    let n = 0;
    const rng = () => (n++ % 997) / 997;
    const pairs = generateVoucherPairs(
      { mode: 'username-only', quantity: 2, codeLength: 4, charset: 'numeric' },
      rng,
    );

    for (const pair of pairs) expect(pair.password).toBeNull();
  });

  it('password-only deja password null (el codigo ES la contrasena)', () => {
    let n = 0;
    const rng = () => (n++ % 997) / 997;
    const pairs = generateVoucherPairs(
      { mode: 'password-only', quantity: 2, codeLength: 4, charset: 'numeric', sharedUsername: 'voucher' },
      rng,
    );

    for (const pair of pairs) expect(pair.password).toBeNull();
  });

  it('aplica el prefijo', () => {
    const pairs = generateVoucherPairs(
      { mode: 'username-only', quantity: 1, codeLength: 2, charset: 'numeric', prefix: 'V-' },
      () => 0.4,
    );

    expect(pairs[0]?.code.startsWith('V-')).toBe(true);
  });

  it('cantidad invalida lanza', () => {
    expect(() =>
      generateVoucherPairs({ mode: 'username-only', quantity: 0, codeLength: 4, charset: 'numeric' }),
    ).toThrow();
  });
});