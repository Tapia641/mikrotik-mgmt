import { beforeEach, describe, expect, it } from 'vitest';

import type { PanelUser } from '@/types';

import type { Db } from '../db';
import { catchDomainError, createTestDb } from '../testing';
import { type CreateInput } from './base.repository';
import { UserRepository } from './user.repository';

function userInput(overrides: Partial<CreateInput<PanelUser>> = {}): CreateInput<PanelUser> {
  return {
    username: 'owner',
    email: 'owner@localhost',
    passwordHash: '$2b$12$hash-de-prueba',
    role: 'owner',
    status: 'active',
    resellerProfileId: null,
    routerIds: [],
    lastLoginAt: null,
    mustChangePassword: false,
    ...overrides,
  };
}

describe('UserRepository', () => {
  let db: Db;
  let users: UserRepository;

  beforeEach(() => {
    db = createTestDb();
    users = new UserRepository(db);
  });

  it('persiste el usuario y lo recupera por username', () => {
    const created = users.create(userInput({ username: 'ana', role: 'operator' }));

    const found = users.findByUsername('ana');

    expect(found).toEqual(created);
    expect(found?.role).toBe('operator');
    expect(found?.deletedAt).toBeNull();
  });

  it('hace round-trip del array router_ids serializado en JSON', () => {
    const created = users.create(
      userInput({ username: 'revendedor', routerIds: ['r-1', 'r-2', 'r-3'] }),
    );

    expect(users.findById(created.id)?.routerIds).toEqual(['r-1', 'r-2', 'r-3']);
  });

  it('hace round-trip de los booleanos mustChangePassword', () => {
    const created = users.create(userInput({ username: 'temporal', mustChangePassword: true }));

    expect(users.findById(created.id)?.mustChangePassword).toBe(true);
  });

  it('rechaza usernames duplicados con CONFLICT', () => {
    users.create(userInput({ username: 'repetido' }));

    expect(catchDomainError(() => users.create(userInput({ username: 'repetido' }))).code).toBe(
      'CONFLICT',
    );
  });

  it('findByUsername ignora los usuarios borrados', () => {
    const created = users.create(userInput({ username: 'fantasma' }));

    users.delete(created.id);

    expect(users.findByUsername('fantasma')).toBeNull();
    expect(db.prepare<[], { total: number }>('SELECT COUNT(*) AS total FROM users').get()?.total).toBe(
      1,
    );
  });

  it('markLogin sella last_login_at y actualiza updated_at', () => {
    const created = users.create(userInput({ username: 'login' }));

    users.markLogin(created.id, '2026-03-01T10:00:00.000Z');

    const found = users.findById(created.id);
    const updatedAt = found?.updatedAt ?? '';

    expect(found?.lastLoginAt).toBe('2026-03-01T10:00:00.000Z');
    expect(updatedAt >= created.updatedAt).toBe(true);
    expect(found?.id).toBe(created.id);
  });

  it('updatePassword cambia el hash y limpia el flag de cambio obligatorio', () => {
    const created = users.create(userInput({ username: 'clave', mustChangePassword: true }));

    users.updatePassword(created.id, '$2b$12$nuevo-hash', false);

    const found = users.findById(created.id);

    expect(found?.passwordHash).toBe('$2b$12$nuevo-hash');
    expect(found?.mustChangePassword).toBe(false);
  });

  it('findByRole filtra por rol, excluye suspendidos y borrados', () => {
    users.create(userInput({ username: 'admin-1', role: 'admin' }));
    users.create(userInput({ username: 'admin-2', role: 'admin', status: 'suspended' }));
    const borrado = users.create(userInput({ username: 'admin-3', role: 'admin' }));
    users.create(userInput({ username: 'op-1', role: 'operator' }));

    users.delete(borrado.id);

    expect(users.findByRole('admin').map((user) => user.username)).toEqual(['admin-1']);
  });
});
