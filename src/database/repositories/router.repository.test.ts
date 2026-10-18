import { beforeEach, describe, expect, it } from 'vitest';

import type { Router } from '@/types';

import type { Db } from '../db';
import { catchDomainError, createTestDb } from '../testing';
import { type CreateInput } from './base.repository';
import { RouterRepository } from './router.repository';

function routerInput(overrides: Partial<CreateInput<Router>> = {}): CreateInput<Router> {
  return {
    name: 'RB-01',
    description: null,
    host: '192.168.88.1',
    port: 8728,
    protocol: 'api',
    username: 'admin',
    passwordEncrypted: 'v1:aXY=:dGFn:ZGF0YQ==',
    tlsInsecure: false,
    timeoutMs: 8000,
    timezone: 'America/Lima',
    currency: 'PEN',
    isActive: true,
    status: 'unknown',
    lastSeenAt: null,
    lastError: null,
    ...overrides,
  };
}

function countRows(db: Db): number {
  return db.prepare<[], { total: number }>('SELECT COUNT(*) AS total FROM routers').get()?.total ?? 0;
}

describe('RouterRepository', () => {
  let db: Db;
  let routers: RouterRepository;

  beforeEach(() => {
    db = createTestDb();
    routers = new RouterRepository(db);
  });

  describe('create / findById', () => {
    it('genera id y timestamps y persiste el registro completo', () => {
      const created = routers.create(routerInput());

      expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(created.createdAt).toBe(created.updatedAt);

      const found = routers.findById(created.id);

      expect(found).toEqual(created);
      expect(found?.tlsInsecure).toBe(false);
      expect(found?.isActive).toBe(true);
      expect(found?.lastSeenAt).toBeNull();
      expect(found?.deletedAt).toBeNull();
    });

    it('devuelve null para un id inexistente', () => {
      expect(routers.findById('00000000-0000-0000-0000-000000000000')).toBeNull();
    });

    it('traduce el nombre duplicado a un DomainError CONFLICT', () => {
      routers.create(routerInput({ name: 'RB-01' }));

      const error = catchDomainError(() =>
        routers.create(routerInput({ name: 'RB-01', host: '10.0.0.1' })),
      );

      expect(error.code).toBe('CONFLICT');
      expect(error.status).toBe(409);
    });
  });

  describe('update', () => {
    it('fusiona el patch y preserva id/createdAt', () => {
      const created = routers.create(routerInput());

      const updated = routers.update(created.id, { host: '10.0.0.2', isActive: false });

      expect(updated.id).toBe(created.id);
      expect(updated.createdAt).toBe(created.createdAt);
      expect(updated.updatedAt >= created.updatedAt).toBe(true);
      expect(updated.host).toBe('10.0.0.2');
      expect(updated.isActive).toBe(false);
      expect(routers.findById(created.id)?.host).toBe('10.0.0.2');
    });

    it('lanza NOT_FOUND al actualizar un id inexistente', () => {
      const error = catchDomainError(() => routers.update('no-existe', { host: '10.0.0.9' }));

      expect(error.code).toBe('NOT_FOUND');
    });
  });

  describe('delete (borrado logico)', () => {
    it('oculta el registro sin borrar la fila', () => {
      const created = routers.create(routerInput());

      routers.delete(created.id);

      expect(routers.findById(created.id)).toBeNull();
      expect(routers.findActive()).toEqual([]);
      expect(countRows(db)).toBe(1);
    });
  });

  describe('paginacion', () => {
    beforeEach(() => {
      routers.create(routerInput({ name: 'a', host: '10.0.0.1' }));
      routers.create(routerInput({ name: 'b', host: '10.0.0.2' }));
      routers.create(routerInput({ name: 'c', host: '10.0.0.3' }));
    });

    it('reparte los resultados en paginas', () => {
      const first = routers.findAll({ page: 1, pageSize: 2 });

      expect(first.total).toBe(3);
      expect(first.totalPages).toBe(2);
      expect(first.items).toHaveLength(2);
      expect(first.hasNext).toBe(true);
      expect(first.hasPrev).toBe(false);

      const second = routers.findAll({ page: 2, pageSize: 2 });

      expect(second.items).toHaveLength(1);
      expect(second.hasNext).toBe(false);
      expect(second.hasPrev).toBe(true);

      const ids = [...first.items, ...second.items].map((router) => router.id);
      expect(new Set(ids).size).toBe(3);
    });

    it('acota pageSize al maximo permitido', () => {
      expect(routers.findAll({ pageSize: 9999 }).pageSize).toBe(200);
    });

    it('ordena por una columna real y por direccion', () => {
      const asc = routers.findAll({ sortBy: 'name', sortDirection: 'asc' });

      expect(asc.items.map((router) => router.name)).toEqual(['a', 'b', 'c']);

      const desc = routers.findAll({ sortBy: 'name', sortDirection: 'desc' });

      expect(desc.items.map((router) => router.name)).toEqual(['c', 'b', 'a']);
    });

    it('ignora un sortBy que no es columna (anti inyeccion)', () => {
      const result = routers.findAll({ sortBy: 'name; DROP TABLE routers' });

      expect(result.total).toBe(3);
      expect(countRows(db)).toBe(3);
    });
  });

  describe('search', () => {
    beforeEach(() => {
      routers.create(routerInput({ name: 'Sucursal Norte', host: '10.1.0.1', status: 'online' }));
      routers.create(routerInput({ name: 'Sucursal Sur', host: '10.2.0.1', status: 'offline' }));
      routers.create(routerInput({ name: 'Casa', host: '10.3.0.1', isActive: false }));
    });

    it('filtra por estado', () => {
      expect(routers.search({ status: 'online' }).items.map((router) => router.name)).toEqual([
        'Sucursal Norte',
      ]);
    });

    it('filtra por isActive', () => {
      expect(routers.search({ isActive: false }).items.map((router) => router.name)).toEqual(['Casa']);
    });

    it('busca por nombre o host', () => {
      expect(routers.search({ search: 'Sucursal' }).total).toBe(2);
      expect(routers.search({ search: '10.3.0' }).total).toBe(1);
      expect(routers.search({ search: 'nada-que-ver' }).total).toBe(0);
    });

    it('excluye los borrados', () => {
      const [first] = routers.findAll().items;
      if (first) routers.delete(first.id);

      expect(routers.search().total).toBe(2);
    });
  });

  describe('findActive', () => {
    it('devuelve solo habilitados y vivos, ordenados por nombre', () => {
      routers.create(routerInput({ name: 'zeta', host: '10.0.0.1' }));
      routers.create(routerInput({ name: 'alfa', host: '10.0.0.2' }));
      const inactive = routers.create(routerInput({ name: 'beta', host: '10.0.0.3', isActive: false }));
      const deleted = routers.create(routerInput({ name: 'gama', host: '10.0.0.4' }));

      routers.delete(deleted.id);

      expect(routers.findActive().map((router) => router.name)).toEqual(['alfa', 'zeta']);
      expect(routers.findActive().map((router) => router.id)).not.toContain(inactive.id);
    });
  });

  describe('updateStatus', () => {
    it('marca online, limpia el error y sella last_seen_at', () => {
      const created = routers.create(routerInput({ status: 'offline', lastError: 'viejo' }));

      routers.updateStatus(created.id, 'online');

      const online = routers.findById(created.id);

      expect(online?.status).toBe('online');
      expect(online?.lastError).toBeNull();
      expect(online?.lastSeenAt).not.toBeNull();
    });

    it('marca offline con el error y conserva el ultimo contacto', () => {
      const created = routers.create(routerInput());
      routers.updateStatus(created.id, 'online');
      const seenAt = routers.findById(created.id)?.lastSeenAt;

      routers.updateStatus(created.id, 'offline', 'connect ECONNREFUSED 192.168.88.1:8728');

      const offline = routers.findById(created.id);

      expect(offline?.status).toBe('offline');
      expect(offline?.lastError).toBe('connect ECONNREFUSED 192.168.88.1:8728');
      expect(offline?.lastSeenAt).toBe(seenAt);
    });
  });

  describe('findByHost', () => {
    it('encuentra por host e ignora los borrados', () => {
      const created = routers.create(routerInput({ host: '192.168.88.9' }));

      expect(routers.findByHost('192.168.88.9')?.id).toBe(created.id);

      routers.delete(created.id);

      expect(routers.findByHost('192.168.88.9')).toBeNull();
    });
  });
});
