import { describe, expect, it } from 'vitest';

import { CryptoError, decryptSecret } from '@/lib/crypto';

import { ResellerProfileRepository } from './repositories/profile.repository';
import { RouterRepository } from './repositories/router.repository';
import { UserRepository } from './repositories/user.repository';
import { seed } from './seed';
import { createTestDb } from './testing';

const KEY = Buffer.alloc(32, 9).toString('base64');

/** bcrypt con 4 rondas: mismo camino, sin pagar el coste real en tests. */
const FAST = { encryptionKey: KEY, passwordRounds: 4 } as const;

describe('seed', () => {
  it('crea owner, router de ejemplo y los tres paquetes', () => {
    const db = createTestDb();

    const result = seed(db, FAST);

    expect(result.created).toHaveLength(5);
    expect(result.skipped).toEqual([]);

    const users = new UserRepository(db);
    const routers = new RouterRepository(db);
    const profiles = new ResellerProfileRepository(db);

    const owner = users.findByUsername('owner');
    expect(owner?.role).toBe('owner');
    expect(owner?.passwordHash.startsWith('$2')).toBe(true);

    const [router] = routers.findActive();
    expect(router).toBeDefined();
    expect(router?.currency).toBe('PEN');

    expect(profiles.findByRouter(router?.id ?? '')).toHaveLength(3);
    expect(profiles.countActiveByRouter(router?.id ?? '')).toBe(3);
  });

  it('deja la contrasena del router cifrada con ENCRYPTION_KEY', () => {
    const db = createTestDb();

    seed(db, FAST);

    const [router] = new RouterRepository(db).findActive();

    expect(router?.passwordEncrypted).not.toContain('admin');
    expect(decryptSecret(router?.passwordEncrypted ?? '', KEY)).toBe('admin');
  });

  it('es idempotente: la segunda ejecucion no crea nada', () => {
    const db = createTestDb();
    seed(db, FAST);

    const second = seed(db, FAST);

    expect(second.created).toEqual([]);
    expect(second.skipped).toHaveLength(5);
    expect(new RouterRepository(db).findActive()).toHaveLength(1);
  });

  it('falla en claro cuando falta la clave de cifrado', () => {
    const db = createTestDb();

    expect(() => seed(db, { encryptionKey: '', passwordRounds: 4 })).toThrow(CryptoError);
  });
});
