import { beforeEach, describe, expect, it } from 'vitest';

import type { ResellerProfile } from '@/types';

import type { Db } from '../db';
import { catchDomainError, createTestDb } from '../testing';
import { type CreateInput } from './base.repository';
import { ResellerProfileRepository } from './profile.repository';
import { RouterRepository } from './router.repository';

function profileInput(
  routerId: string,
  overrides: Partial<CreateInput<ResellerProfile>> = {},
): CreateInput<ResellerProfile> {
  return {
    name: '1 dia',
    routerId,
    price: 5,
    sellingPrice: 7,
    currency: 'PEN',
    validity: '1d',
    validityUnit: 'days',
    hotspotProfileName: 'default',
    limitUptime: '1d',
    limitBytesIn: 0,
    limitBytesOut: 0,
    mode: 'username-password',
    sharedUsers: 1,
    isActive: true,
    ...overrides,
  };
}

describe('ResellerProfileRepository', () => {
  let db: Db;
  let profiles: ResellerProfileRepository;
  let routerId: string;

  beforeEach(() => {
    db = createTestDb();
    profiles = new ResellerProfileRepository(db);
    routerId = new RouterRepository(db).create({
      name: 'RB-01',
      description: null,
      host: '192.168.88.1',
      port: 8728,
      protocol: 'api',
      username: 'admin',
      passwordEncrypted: 'v1:aXY=:dGFn:ZGF0YQ==',
      tlsInsecure: false,
      timeoutMs: 8000,
      timezone: 'UTC',
      currency: 'PEN',
      isActive: true,
      status: 'unknown',
      lastSeenAt: null,
      lastError: null,
    }).id;
  });

  it('persiste el paquete con todos sus campos', () => {
    const created = profiles.create(profileInput(routerId, { name: '7 dias', price: 20 }));

    const found = profiles.findById(created.id);

    expect(found).toEqual(created);
    expect(found?.price).toBe(20);
    expect(found?.sellingPrice).toBe(7);
    expect(found?.validityUnit).toBe('days');
    expect(found?.limitBytesIn).toBe(0);
    expect(found?.isActive).toBe(true);
  });

  it('conserva sellingPrice nulo como null (no como 0)', () => {
    const created = profiles.create(profileInput(routerId, { sellingPrice: null }));

    const found = profiles.findById(created.id);

    expect(found?.sellingPrice).toBeNull();
  });

  it('findByRouter devuelve activos primero y ordenados por nombre, sin borrados', () => {
    profiles.create(profileInput(routerId, { name: 'zeta' }));
    profiles.create(profileInput(routerId, { name: 'beta', isActive: false }));
    const borrado = profiles.create(profileInput(routerId, { name: 'alfa' }));
    profiles.delete(borrado.id);

    expect(profiles.findByRouter(routerId).map((profile) => profile.name)).toEqual(['zeta', 'beta']);
  });

  it('countActiveByRouter cuenta solo activos y vivos', () => {
    profiles.create(profileInput(routerId, { name: 'a' }));
    profiles.create(profileInput(routerId, { name: 'b' }));
    profiles.create(profileInput(routerId, { name: 'c', isActive: false }));

    expect(profiles.countActiveByRouter(routerId)).toBe(2);
  });

  it('rechaza un router_id inexistente (clave foranea)', () => {
    const error = catchDomainError(() => profiles.create(profileInput('router-fantasma')));

    expect(error.code).toBe('CONFLICT');
  });

  it('devuelve [] para un router sin paquetes', () => {
    expect(profiles.findByRouter('router-vacio')).toEqual([]);
  });
});
