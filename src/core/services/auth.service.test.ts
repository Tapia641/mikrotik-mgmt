import { beforeEach, describe, expect, it } from 'vitest';

import type { PanelUser, PanelUserInput } from '@/types';

import { SessionDenylist } from '@/core/auth/denylist';
import { hashPassword } from '@/core/auth/password';
import { BCRYPT_ROUNDS } from '@/core/constants';
import { UserRepository } from '@/database/repositories';
import type { Db } from '@/database/db';
import { createTestDb } from '@/database/testing';

import { createAuthService, type AuthService, type AuthServiceDeps } from './auth.service';

/** Coste minimo: los tests no necesitan 12 rondas de bcrypt. */
const ROUNDS = 4;
const SECRET = 's'.repeat(48);
const NOW = 1_700_000_000;

/** Segmento de coste de un hash bcrypt: `$2b$04$...` → `04`. */
function bcryptCost(hash: string): string {
  return hash.split('$')[2] ?? '';
}

/** Coste con el relleno a dos digitos que usa bcrypt. */
function costLabel(rounds: number): string {
  return String(rounds).padStart(2, '0');
}

interface Harness {
  readonly service: AuthService;
  readonly users: UserRepository;
  readonly denylist: SessionDenylist;
  create(input?: Partial<PanelUserInput>): Promise<PanelUser>;
}

async function harness(overrides: AuthServiceDeps = {}): Promise<Harness> {
  const db: Db = createTestDb();
  const users = new UserRepository(db);
  const denylist = new SessionDenylist({ now: () => NOW });

  const service = createAuthService({
    users,
    denylist,
    secret: SECRET,
    ttlSeconds: 3_600,
    passwordRounds: ROUNDS,
    now: () => NOW,
    ...overrides,
  });

  async function create(input: Partial<PanelUserInput> = {}): Promise<PanelUser> {
    const passwordHash = await service.hashPassword(input.password ?? 's3cret-password');

    return users.create({
      username: input.username ?? 'ana',
      email: input.email ?? null,
      passwordHash,
      role: input.role ?? 'admin',
      status: 'active',
      resellerProfileId: input.resellerProfileId ?? null,
      routerIds: [...(input.routerIds ?? [])],
      lastLoginAt: null,
      mustChangePassword: false,
    });
  }

  return { service, users, denylist, create };
}

describe('authService.login', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await harness();
  });

  it('devuelve usuario, sesion y token con credenciales validas', async () => {
    const user = await h.create({ username: 'ana' });

    const result = await h.service.login({ username: 'ana', password: 's3cret-password' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.user.id).toBe(user.id);
    expect(result.value.user).not.toHaveProperty('passwordHash');
    expect(result.value.token.split('.')).toHaveLength(3);
    expect(result.value.session.user.role).toBe('admin');
    expect(result.value.session.expiresAt).toBe(NOW + 3_600);
  });

  it('acepta el usuario con espacios alrededor', async () => {
    await h.create({ username: 'ana' });

    const result = await h.service.login({ username: '  ana  ', password: 's3cret-password' });

    expect(result.ok).toBe(true);
  });

  it('registra el ultimo acceso', async () => {
    const user = await h.create();

    await h.service.login({ username: 'ana', password: 's3cret-password' });

    expect(h.users.findById(user.id)?.lastLoginAt).not.toBeNull();
  });

  it('guarda la IP y el user-agent de la peticion', async () => {
    await h.create();

    const result = await h.service.login(
      { username: 'ana', password: 's3cret-password' },
      { ip: '10.0.0.9', userAgent: 'vitest' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.session.ip).toBe('10.0.0.9');
    expect(result.value.session.userAgent).toBe('vitest');
  });

  it('rechaza una contrasena incorrecta sin revelar si el usuario existe', async () => {
    await h.create();

    const wrongPassword = await h.service.login({ username: 'ana', password: 'otra' });
    const unknownUser = await h.service.login({ username: 'nadie', password: 'otra' });

    expect(wrongPassword.ok).toBe(false);
    expect(unknownUser.ok).toBe(false);

    for (const result of [wrongPassword, unknownUser]) {
      if (result.ok) continue;
      expect(result.error.code).toBe('UNAUTHORIZED');
      expect(result.error.message).toBe('Usuario o contrasena incorrectos.');
    }
  });

  it('rechaza una cuenta suspendida', async () => {
    const user = await h.create();

    h.users.update(user.id, { status: 'suspended' });

    const result = await h.service.login({ username: 'ana', password: 's3cret-password' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('FORBIDDEN');
  });

  it('rechaza una cuenta pendiente', async () => {
    const user = await h.create();

    h.users.update(user.id, { status: 'pending' });

    const result = await h.service.login({ username: 'ana', password: 's3cret-password' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('FORBIDDEN');
  });

  it('ignora un usuario borrado logicamente', async () => {
    const user = await h.create();

    h.users.delete(user.id);

    const result = await h.service.login({ username: 'ana', password: 's3cret-password' });

    expect(result.ok).toBe(false);
  });

  it('rehasha la contrasena cuando el coste guardado ya no coincide', async () => {
    const h = await harness();
    // Hash "heredado" de una configuracion con otro coste: debe migrarse.
    const legacyHash = await hashPassword('s3cret-password', ROUNDS + 1);
    h.users.create({
      username: 'ana',
      email: null,
      passwordHash: legacyHash,
      role: 'admin',
      status: 'active',
      resellerProfileId: null,
      routerIds: [],
      lastLoginAt: null,
      mustChangePassword: false,
    });

    const result = await h.service.login({ username: 'ana', password: 's3cret-password' });
    const after = h.users.findByUsername('ana')?.passwordHash ?? '';

    expect(result.ok).toBe(true);
    expect(after).not.toBe(legacyHash);
    expect(bcryptCost(after)).toBe(costLabel(ROUNDS));
  });

  it('no reescribe el hash cuando el coste ya coincide', async () => {
    const h = await harness();
    await h.create();
    const before = h.users.findByUsername('ana')?.passwordHash ?? '';

    await h.service.login({ username: 'ana', password: 's3cret-password' });

    expect(h.users.findByUsername('ana')?.passwordHash).toBe(before);
  });

  it('el servicio por defecto usa BCRYPT_ROUNDS de la configuracion', async () => {
    const h = await harness({ passwordRounds: undefined });

    expect(bcryptCost(await h.service.hashPassword('contrasena-larga'))).toBe(costLabel(BCRYPT_ROUNDS));
  });
});

describe('authService.resolveSession', () => {
  it('devuelve el usuario de un token valido', async () => {
    const h = await harness();
    const user = await h.create();

    const login = await h.service.login({ username: 'ana', password: 's3cret-password' });
    if (!login.ok) throw new Error('login fallo');

    const resolved = await h.service.resolveSession(login.value.token);

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.id).toBe(user.id);
  });

  it('rechaza un token basura', async () => {
    const h = await harness();

    const result = await h.service.resolveSession('no-es-un-jwt');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('UNAUTHORIZED');
  });

  it('rechaza un token vencido', async () => {
    const h = await harness({ now: () => NOW + 7_200 });
    await h.create();

    const login = await createLoginAt(h, NOW);
    if (!login.ok) throw new Error('login fallo');

    const result = await h.service.resolveSession(login.value.token);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('expiro');
  });

  it('rechaza la sesion de un usuario borrado despues de entrar', async () => {
    const h = await harness();
    const user = await h.create();

    const login = await h.service.login({ username: 'ana', password: 's3cret-password' });
    if (!login.ok) throw new Error('login fallo');

    h.users.delete(user.id);

    const result = await h.service.resolveSession(login.value.token);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('UNAUTHORIZED');
  });

  it('rechaza la sesion si la cuenta se suspende despues de entrar', async () => {
    const h = await harness();
    const user = await h.create();

    const login = await h.service.login({ username: 'ana', password: 's3cret-password' });
    if (!login.ok) throw new Error('login fallo');

    h.users.update(user.id, { status: 'suspended' });

    const result = await h.service.resolveSession(login.value.token);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('FORBIDDEN');
  });

  it('usa los routers actuales de la base, no los del token', async () => {
    const h = await harness();
    const user = await h.create();

    const login = await h.service.login({ username: 'ana', password: 's3cret-password' });
    if (!login.ok) throw new Error('login fallo');

    h.users.update(user.id, { routerIds: ['router-nuevo'] });

    const result = await h.service.resolveSession(login.value.token);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.routerIds).toEqual(['router-nuevo']);
  });
});

describe('authService.logout', () => {
  it('revoca el token emitido', async () => {
    const h = await harness();
    await h.create();

    const login = await h.service.login({ username: 'ana', password: 's3cret-password' });
    if (!login.ok) throw new Error('login fallo');

    const closed = await h.service.logout(login.value.token);
    const resolved = await h.service.resolveSession(login.value.token);

    expect(closed.ok).toBe(true);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.error.message).toContain('cerrada');
    expect(h.denylist.size).toBe(1);
  });

  it('es idempotente con un token invalido o vacio', async () => {
    const h = await harness();

    await expect(h.service.logout('')).resolves.toEqual({ ok: true, value: undefined });
    await expect(h.service.logout('basura')).resolves.toEqual({ ok: true, value: undefined });
    expect(h.denylist.size).toBe(0);
  });

  it('no revoca la sesion de otro usuario', async () => {
    const h = await harness();
    await h.create({ username: 'ana' });
    await h.create({ username: 'luis' });

    const ana = await h.service.login({ username: 'ana', password: 's3cret-password' });
    const luis = await h.service.login({ username: 'luis', password: 's3cret-password' });
    if (!ana.ok || !luis.ok) throw new Error('login fallo');

    await h.service.logout(ana.value.token);

    await expect(h.service.resolveSession(luis.value.token)).resolves.toMatchObject({ ok: true });
  });
});

describe('authService.createUser', () => {
  it('crea el usuario con la contrasena hasheada', async () => {
    const h = await harness();

    const result = await h.service.createUser({
      username: 'nuevo',
      password: 'contrasena-larga',
      role: 'operator',
      routerIds: ['router-a'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toHaveProperty('passwordHash');

    const stored = h.users.findByUsername('nuevo');
    expect(stored?.passwordHash).not.toBe('contrasena-larga');
    expect(stored?.routerIds).toEqual(['router-a']);
  });

  it('rechaza un usuario duplicado', async () => {
    const h = await harness();
    await h.create({ username: 'ana' });

    const result = await h.service.createUser({
      username: 'ana',
      password: 'contrasena-larga',
      role: 'viewer',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONFLICT');
  });

  it('rechaza un usuario demasiado corto o con caracteres invalidos', async () => {
    const h = await harness();

    const short = await h.service.createUser({ username: 'ab', password: 'contrasena-larga', role: 'viewer' });
    const invalid = await h.service.createUser({ username: 'a b', password: 'contrasena-larga', role: 'viewer' });

    expect(short.ok).toBe(false);
    expect(invalid.ok).toBe(false);
    if (short.ok || invalid.ok) return;
    expect(short.error.code).toBe('VALIDATION_ERROR');
    expect(invalid.error.code).toBe('VALIDATION_ERROR');
  });

  it('rechaza una contrasena que no cumple la politica', async () => {
    const h = await harness();

    const result = await h.service.createUser({ username: 'nuevo', password: 'corta', role: 'viewer' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('authService.changePassword', () => {
  it('cambia la contrasena cuando la actual coincide', async () => {
    const h = await harness();
    const user = await h.create();

    const result = await h.service.changePassword(user.id, 's3cret-password', 'nueva-contrasena');

    expect(result.ok).toBe(true);
    await expect(
      h.service.login({ username: 'ana', password: 'nueva-contrasena' }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      h.service.login({ username: 'ana', password: 's3cret-password' }),
    ).resolves.toMatchObject({ ok: false });
  });

  it('rechaza la contrasena actual incorrecta', async () => {
    const h = await harness();
    const user = await h.create();

    const result = await h.service.changePassword(user.id, 'incorrecta', 'nueva-contrasena');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('UNAUTHORIZED');
  });

  it('rechaza repetir la misma contrasena', async () => {
    const h = await harness();
    const user = await h.create();

    const result = await h.service.changePassword(user.id, 's3cret-password', 's3cret-password');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('devuelve NOT_FOUND si el usuario no existe', async () => {
    const h = await harness();

    const result = await h.service.changePassword('user-fantasma-uuid', 'x'.repeat(10), 'nueva-contrasena');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });
});

describe('authService (utilidades expuestas)', () => {
  it('hashPassword/verifyPassword delegan en bcrypt', async () => {
    const h = await harness();

    const hash = await h.service.hashPassword('contrasena-larga');

    await expect(h.service.verifyPassword('contrasena-larga', hash)).resolves.toBe(true);
    await expect(h.service.verifyPassword('otra', hash)).resolves.toBe(false);
  });
});

/** Login firmado en un instante concreto (para probar la expiracion). */
async function createLoginAt(
  h: Harness,
  issuedAt: number,
): Promise<Awaited<ReturnType<AuthService['login']>>> {
  const issuer = createAuthService({
    users: h.users,
    denylist: h.denylist,
    secret: SECRET,
    ttlSeconds: 60,
    passwordRounds: ROUNDS,
    now: () => issuedAt,
  });

  return issuer.login({ username: 'ana', password: 's3cret-password' });
}
