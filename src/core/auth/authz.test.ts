import { describe, expect, it } from 'vitest';

import type { PanelUser, Permission, UserRole } from '@/types';

import {
  PERMISSIONS,
  PERMISSION_NAMES,
  ROLE_RANK,
  can,
  canAccessRouter,
  hasRoleAtLeast,
  permissionsOf,
  scopeRouterIds,
  toPublicUser,
  toSessionUser,
} from './authz';

const USER: PanelUser = {
  id: 'user-1',
  username: 'ana',
  email: 'ana@example.com',
  passwordHash: '$2b$04$hash-que-nunca-debe-salir',
  role: 'operator',
  status: 'active',
  resellerProfileId: null,
  routerIds: ['router-a'],
  lastLoginAt: '2026-01-01T00:00:00.000Z',
  mustChangePassword: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
};

describe('ROLE_RANK / hasRoleAtLeast', () => {
  it('ordena los roles de mayor a menor privilegio', () => {
    expect(ROLE_RANK.owner).toBeGreaterThan(ROLE_RANK.admin);
    expect(ROLE_RANK.admin).toBeGreaterThan(ROLE_RANK.operator);
    expect(ROLE_RANK.operator).toBeGreaterThan(ROLE_RANK.reseller);
    expect(ROLE_RANK.reseller).toBeGreaterThan(ROLE_RANK.viewer);
  });

  it('compara por rango', () => {
    expect(hasRoleAtLeast('owner', 'viewer')).toBe(true);
    expect(hasRoleAtLeast('viewer', 'viewer')).toBe(true);
    expect(hasRoleAtLeast('viewer', 'operator')).toBe(false);
    expect(hasRoleAtLeast('reseller', 'operator')).toBe(false);
  });
});

describe('PERMISSIONS', () => {
  it('cubre todos los permisos declarados en el contrato', () => {
    const declared: readonly Permission[] = [
      'routers:read',
      'routers:write',
      'hotspot:read',
      'hotspot:write',
      'vouchers:read',
      'vouchers:write',
      'vouchers:sell',
      'reports:read',
      'users:manage',
      'settings:manage',
    ];

    expect(PERMISSION_NAMES.slice().sort()).toEqual(declared.slice().sort());
  });

  it('el viewer solo lee', () => {
    expect(can('viewer', 'routers:read')).toBe(true);
    expect(can('viewer', 'hotspot:read')).toBe(true);
    expect(can('viewer', 'routers:write')).toBe(false);
    expect(can('viewer', 'hotspot:write')).toBe(false);
    expect(can('viewer', 'vouchers:sell')).toBe(false);
  });

  it('el operador gestiona hotspot y vouchers pero no routers', () => {
    expect(can('operator', 'hotspot:write')).toBe(true);
    expect(can('operator', 'vouchers:write')).toBe(true);
    expect(can('operator', 'vouchers:sell')).toBe(true);
    expect(can('operator', 'routers:write')).toBe(false);
    expect(can('operator', 'users:manage')).toBe(false);
  });

  it('el revendedor vende vouchers y ve reportes', () => {
    expect(can('reseller', 'vouchers:sell')).toBe(true);
    expect(can('reseller', 'reports:read')).toBe(true);
    expect(can('reseller', 'vouchers:write')).toBe(false);
    expect(can('reseller', 'hotspot:write')).toBe(false);
  });

  it('solo el owner cambia ajustes y el admin gestiona usuarios', () => {
    expect(can('admin', 'settings:manage')).toBe(false);
    expect(can('owner', 'settings:manage')).toBe(true);
    expect(can('admin', 'users:manage')).toBe(true);
    expect(can('owner', 'users:manage')).toBe(true);
  });

  it('permissionsOf devuelve los permisos efectivos del rol', () => {
    const viewer = permissionsOf('viewer');

    expect(viewer).toContain('routers:read');
    expect(viewer).not.toContain('routers:write');
    expect(permissionsOf('owner')).toHaveLength(PERMISSION_NAMES.length);
  });
});

describe('alcance de routers', () => {
  const unrestricted: Pick<PanelUser, 'role' | 'routerIds'> = { role: 'admin', routerIds: [] };
  const scoped: Pick<PanelUser, 'role' | 'routerIds'> = {
    role: 'reseller',
    routerIds: ['router-a'],
  };

  it('una lista vacia significa "todos"', () => {
    expect(canAccessRouter(unrestricted, 'router-z')).toBe(true);
  });

  it('con lista, solo los asignados', () => {
    expect(canAccessRouter(scoped, 'router-a')).toBe(true);
    expect(canAccessRouter(scoped, 'router-b')).toBe(false);
  });

  it('scopeRouterIds filtra sin ampliar el alcance', () => {
    expect(scopeRouterIds(unrestricted, ['a', 'b'])).toEqual(['a', 'b']);
    expect(scopeRouterIds(scoped, ['router-a', 'router-b'])).toEqual(['router-a']);
  });
});

describe('proyecciones', () => {
  it('toPublicUser nunca expone el hash de la contrasena', () => {
    const publicUser = toPublicUser(USER);

    expect(publicUser).not.toHaveProperty('passwordHash');
    expect(publicUser.username).toBe('ana');
    expect(publicUser.role).toBe('operator');
    expect(Object.keys(publicUser)).toHaveLength(Object.keys(USER).length - 1);
  });

  it('toSessionUser expone solo lo necesario para autorizar', () => {
    expect(toSessionUser(USER)).toEqual({
      id: 'user-1',
      username: 'ana',
      role: 'operator',
      routerIds: ['router-a'],
    });
  });

  it('ROLE_RANK cubre los cinco roles del contrato', () => {
    const roles: readonly UserRole[] = ['owner', 'admin', 'operator', 'reseller', 'viewer'];

    for (const role of roles) {
      expect(ROLE_RANK[role]).toBeTypeOf('number');
    }
  });
});
