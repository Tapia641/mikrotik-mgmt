import { describe, expect, it } from 'vitest';

import { SessionDenylist } from './denylist';

function harness(options: { readonly maxEntries?: number } = {}) {
  let clock = 1_000;
  const denylist = new SessionDenylist({
    now: () => clock,
    ...(options.maxEntries === undefined ? {} : { maxEntries: options.maxEntries }),
  });

  return {
    denylist,
    advance: (seconds: number): void => {
      clock += seconds;
    },
  };
}

describe('SessionDenylist', () => {
  it('empieza vacia', () => {
    expect(harness().denylist.isRevoked('jti-1')).toBe(false);
  });

  it('recuerda la revocacion hasta que el token expira', () => {
    const { denylist, advance } = harness();

    denylist.revoke('jti-1', 1_600);

    expect(denylist.isRevoked('jti-1')).toBe(true);
    expect(denylist.size).toBe(1);

    advance(600); // 1_600 exactos: el token ya expiro por si solo
    expect(denylist.isRevoked('jti-1')).toBe(false);
    expect(denylist.size).toBe(0);
  });

  it('no revoca otros tokens', () => {
    const { denylist } = harness();

    denylist.revoke('jti-1', 2_000);

    expect(denylist.isRevoked('jti-2')).toBe(false);
  });

  it('ignora un id vacio', () => {
    const { denylist } = harness();

    denylist.revoke('', 2_000);

    expect(denylist.size).toBe(0);
  });

  it('descarta las revocaciones vencidas al insertar', () => {
    const { denylist, advance } = harness();

    denylist.revoke('viejo', 1_100);
    advance(200);
    denylist.revoke('nuevo', 2_000);

    expect(denylist.size).toBe(1);
    expect(denylist.isRevoked('viejo')).toBe(false);
    expect(denylist.isRevoked('nuevo')).toBe(true);
  });

  it('respeta la cota de memoria sacrificando lo que expira antes', () => {
    const { denylist } = harness({ maxEntries: 2 });

    denylist.revoke('corto', 1_100);
    denylist.revoke('medio', 1_200);
    denylist.revoke('largo', 1_300);

    expect(denylist.size).toBe(2);
    expect(denylist.isRevoked('corto')).toBe(false);
    expect(denylist.isRevoked('medio')).toBe(true);
    expect(denylist.isRevoked('largo')).toBe(true);
  });

  it('clear vacia la lista', () => {
    const { denylist } = harness();

    denylist.revoke('jti-1', 2_000);
    denylist.clear();

    expect(denylist.size).toBe(0);
  });
});
