import { beforeEach, describe, expect, it } from 'vitest';

import type { Voucher } from '@/types';

import type { Db } from '../db';
import { catchDomainError, createTestDb } from '../testing';
import { type CreateInput } from './base.repository';
import { RouterRepository } from './router.repository';
import { UserRepository } from './user.repository';
import { VoucherRepository } from './voucher.repository';

function voucherInput(
  routerId: string,
  overrides: Partial<CreateInput<Voucher>> = {},
): CreateInput<Voucher> {
  return {
    code: 'AAAA1111',
    password: 'BBBB2222',
    routerId,
    profileName: '1 dia',
    validity: '1d',
    limitUptime: '1d',
    limitBytesIn: 0,
    limitBytesOut: 0,
    price: 5,
    currency: 'PEN',
    status: 'available',
    batchId: null,
    resellerId: null,
    soldAt: null,
    activatedAt: null,
    expiresAt: null,
    comment: null,
    ...overrides,
  };
}

/** `vouchers.batch_id` es una clave foranea real: hay que crear el lote. */
function insertBatch(db: Db, id: string, routerId: string): void {
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO voucher_batches
       (id, router_id, profile_name, mode, quantity, price, request_json, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, routerId, '7 dias', 'username-password', 1, 5, '{}', null, now, now);
}

function createReseller(db: Db, username: string): string {
  return new UserRepository(db).create({
    username,
    email: null,
    passwordHash: '$2b$12$hash',
    role: 'reseller',
    status: 'active',
    resellerProfileId: null,
    routerIds: [],
    lastLoginAt: null,
    mustChangePassword: false,
  }).id;
}

describe('VoucherRepository', () => {
  let db: Db;
  let vouchers: VoucherRepository;
  let routerId: string;

  beforeEach(() => {
    db = createTestDb();
    vouchers = new VoucherRepository(db);
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

  describe('insertMany', () => {
    it('inserta el lote completo y devuelve las entidades creadas', () => {
      const created = vouchers.insertMany([
        voucherInput(routerId, { code: 'AAA' }),
        voucherInput(routerId, { code: 'BBB' }),
        voucherInput(routerId, { code: 'CCC' }),
      ]);

      expect(created).toHaveLength(3);
      expect(created.every((voucher) => voucher.id.length === 36)).toBe(true);
      expect(vouchers.count()).toBe(3);
      expect(vouchers.search({ code: 'BBB' }).total).toBe(1);
    });

    it('es atomico: si un codigo duplica, el lote entero revierte', () => {
      vouchers.insertMany([voucherInput(routerId, { code: 'AAA' })]);

      const error = catchDomainError(() =>
        vouchers.insertMany([
          voucherInput(routerId, { code: 'BBB' }),
          voucherInput(routerId, { code: 'AAA' }),
          voucherInput(routerId, { code: 'CCC' }),
        ]),
      );

      expect(error.code).toBe('CONFLICT');
      expect(vouchers.count()).toBe(1);
      expect(vouchers.findByCode(routerId, 'BBB')).toBeNull();
      expect(vouchers.findByCode(routerId, 'CCC')).toBeNull();
    });

    it('acepta el mismo codigo en routers distintos (UNIQUE compuesta)', () => {
      const otherRouterId = new RouterRepository(db).create({
        name: 'RB-02',
        description: null,
        host: '192.168.88.2',
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

      vouchers.insertMany([voucherInput(routerId, { code: 'MISMO' })]);
      vouchers.insertMany([voucherInput(otherRouterId, { code: 'MISMO' })]);

      expect(vouchers.count()).toBe(2);
    });

    it('rechaza un router inexistente (clave foranea)', () => {
      const error = catchDomainError(() =>
        vouchers.insertMany([voucherInput('router-fantasma')]),
      );

      expect(error.code).toBe('CONFLICT');
    });
  });

  describe('findByCode', () => {
    it('busca por router + codigo', () => {
      vouchers.insertMany([voucherInput(routerId, { code: 'XYZ' })]);

      expect(vouchers.findByCode(routerId, 'XYZ')?.code).toBe('XYZ');
      expect(vouchers.findByCode(routerId, 'NO-EXISTE')).toBeNull();
    });
  });

  describe('search', () => {
    it('filtra por estado, lote, perfil y codigo', () => {
      insertBatch(db, 'lote-1', routerId);

      vouchers.insertMany([
        voucherInput(routerId, { code: 'AAA', status: 'available', profileName: '1 hora' }),
        voucherInput(routerId, { code: 'AAB', status: 'sold', profileName: '1 dia' }),
        voucherInput(routerId, { code: 'ZZZ', status: 'sold', profileName: '7 dias', batchId: 'lote-1' }),
      ]);

      expect(vouchers.search({ status: 'sold' }).total).toBe(2);
      expect(vouchers.search({ profileName: '1 dia' }).total).toBe(1);
      expect(vouchers.search({ code: 'AA' }).total).toBe(2);
      expect(vouchers.search({ batchId: 'lote-1' }).total).toBe(1);
      expect(vouchers.search({ routerId }).total).toBe(3);
      expect(vouchers.search({ status: 'sold', profileName: '7 dias' }).total).toBe(1);
    });

    it('filtra por rango de creacion', () => {
      const from = new Date(Date.now() - 1000).toISOString();
      vouchers.insertMany([voucherInput(routerId, { code: 'AAA' })]);
      const to = new Date(Date.now() + 1000).toISOString();

      expect(vouchers.search({ createdRange: { from, to } }).total).toBe(1);
      expect(
        vouchers.search({
          createdRange: { from: '2000-01-01T00:00:00.000Z', to: '2000-01-02T00:00:00.000Z' },
        }).total,
      ).toBe(0);
    });
  });

  describe('markSold', () => {
    it('marca vendido, asigna reseller y fecha', () => {
      const resellerId = createReseller(db, 'revendedor-1');
      const [created] = vouchers.insertMany([voucherInput(routerId, { code: 'AAA' })]);
      if (!created) throw new Error('el lote no devolvio vouchers');

      vouchers.markSold(created.id, resellerId, '2026-05-01T12:00:00.000Z');

      const sold = vouchers.findById(created.id);

      expect(sold?.status).toBe('sold');
      expect(sold?.resellerId).toBe(resellerId);
      expect(sold?.soldAt).toBe('2026-05-01T12:00:00.000Z');
    });
  });

  describe('summarize', () => {
    it('cuenta por estado y suma el valor', () => {
      vouchers.insertMany([
        voucherInput(routerId, { code: 'A1', status: 'available', price: 5 }),
        voucherInput(routerId, { code: 'A2', status: 'available', price: 5 }),
        voucherInput(routerId, { code: 'S1', status: 'sold', price: 20 }),
      ]);

      const summary = vouchers.summarize({ routerId });

      expect(summary.total).toBe(3);
      expect(summary.byStatus.available).toBe(2);
      expect(summary.byStatus.sold).toBe(1);
      expect(summary.byStatus.revoked).toBe(0);
      expect(summary.totalValue).toBe(30);
      expect(summary.currency).toBe('PEN');
    });

    it('devuelve un resumen vacio coherente', () => {
      const summary = vouchers.summarize({ routerId: 'router-vacio' });

      expect(summary.total).toBe(0);
      expect(summary.totalValue).toBe(0);
      expect(summary.currency).toBe('USD');
      expect(Object.values(summary.byStatus).every((count) => count === 0)).toBe(true);
    });

    it('marca MIXED cuando el filtro abarca varias monedas', () => {
      vouchers.insertMany([
        voucherInput(routerId, { code: 'P1', currency: 'PEN' }),
        voucherInput(routerId, { code: 'U1', currency: 'USD' }),
      ]);

      expect(vouchers.summarize({ routerId }).currency).toBe('MIXED');
    });

    it('respeta los filtros de la busqueda', () => {
      vouchers.insertMany([
        voucherInput(routerId, { code: 'A1', status: 'available', price: 5 }),
        voucherInput(routerId, { code: 'S1', status: 'sold', price: 20 }),
      ]);

      const summary = vouchers.summarize({ routerId, status: 'sold' });

      expect(summary.total).toBe(1);
      expect(summary.totalValue).toBe(20);
    });
  });
});
