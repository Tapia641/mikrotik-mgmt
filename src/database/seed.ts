import { hashSync } from 'bcryptjs';

import { BCRYPT_ROUNDS } from '@/core/constants';
import { encryptSecret } from '@/lib/crypto';
import { env } from '@/lib/env';
import type { VoucherValidityUnit } from '@/types';

import { getDb, type Db } from './db';
import { runMigrations } from './migrate';
import { ResellerProfileRepository } from './repositories/profile.repository';
import { RouterRepository } from './repositories/router.repository';
import { UserRepository } from './repositories/user.repository';

/**
 * Seed de desarrollo. IDEMPOTENTE: se puede ejecutar tantas veces como se
 * quiera; solo crea lo que falta (se busca por clave natural, no por id).
 *
 * Aplica las migraciones pendientes antes de insertar nada.
 *
 * Crea:
 *   - 1 usuario `owner` (contrasena de SEED_OWNER_PASSWORD).
 *   - 1 router de ejemplo (contrasena cifrada con ENCRYPTION_KEY).
 *   - 3 paquetes comerciales (1 hora / 1 dia / 7 dias).
 *
 * NUNCA se ejecuta desde la app: es un script (`npm run db:seed`).
 */

export interface SeedResult {
  readonly created: readonly string[];
  readonly skipped: readonly string[];
}

export interface SeedOptions {
  /** Clave de cifrado; por defecto `env.ENCRYPTION_KEY`. */
  readonly encryptionKey?: string;
  /** Coste de bcrypt; los tests lo bajan para no pagar el coste real. */
  readonly passwordRounds?: number;
}

interface DemoProfile {
  readonly name: string;
  readonly validity: string;
  readonly validityUnit: VoucherValidityUnit;
  readonly price: number;
  readonly sellingPrice: number;
}

const DEMO_PROFILES: readonly DemoProfile[] = [
  { name: '1 hora', validity: '1h', validityUnit: 'hours', price: 2, sellingPrice: 3 },
  { name: '1 dia', validity: '1d', validityUnit: 'days', price: 5, sellingPrice: 7 },
  { name: '7 dias', validity: '7d', validityUnit: 'days', price: 20, sellingPrice: 25 },
];

function readSeedEnv(key: string, fallback: string): string {
  const value = process.env[key];
  return value !== undefined && value.trim() !== '' ? value.trim() : fallback;
}

export function seed(db: Db = getDb(), options: SeedOptions = {}): SeedResult {
  runMigrations(db);

  const passwordRounds = options.passwordRounds ?? BCRYPT_ROUNDS;

  const users = new UserRepository(db);
  const routers = new RouterRepository(db);
  const profiles = new ResellerProfileRepository(db);

  const created: string[] = [];
  const skipped: string[] = [];

  /* ── Usuario owner ──────────────────────────────────────────────────── */
  const ownerUsername = readSeedEnv('SEED_OWNER_USERNAME', 'owner');
  const ownerPassword = readSeedEnv('SEED_OWNER_PASSWORD', 'admin12345');

  if (users.findByUsername(ownerUsername)) {
    skipped.push(`usuario ${ownerUsername}`);
  } else {
    users.create({
      username: ownerUsername,
      email: readSeedEnv('SEED_OWNER_EMAIL', 'owner@localhost'),
      passwordHash: hashSync(ownerPassword, passwordRounds),
      role: 'owner',
      status: 'active',
      resellerProfileId: null,
      routerIds: [],
      lastLoginAt: null,
      mustChangePassword: false,
    });
    created.push(`usuario ${ownerUsername}`);
  }

  /* ── Router de ejemplo ──────────────────────────────────────────────── */
  const routerName = readSeedEnv('SEED_ROUTER_NAME', 'Router Demo');
  const host = readSeedEnv('SEED_ROUTER_HOST', '192.168.88.1');
  const currency = readSeedEnv('SEED_CURRENCY', 'PEN');

  let router = routers.findByHost(host);
  if (router) {
    skipped.push(`router ${router.name} (${host})`);
  } else {
    // Falla rapido y con mensaje accionable si falta ENCRYPTION_KEY.
    const passwordEncrypted = encryptSecret(
      readSeedEnv('SEED_ROUTER_PASSWORD', 'admin'),
      options.encryptionKey ?? env.ENCRYPTION_KEY,
    );

    router = routers.create({
      name: routerName,
      description: 'Router de ejemplo creado por el seed',
      host,
      port: 8728,
      protocol: 'api',
      username: readSeedEnv('SEED_ROUTER_USERNAME', 'admin'),
      passwordEncrypted,
      tlsInsecure: false,
      timeoutMs: 8000,
      timezone: readSeedEnv('SEED_TIMEZONE', 'America/Lima'),
      currency,
      isActive: true,
      status: 'unknown',
      lastSeenAt: null,
      lastError: null,
    });
    created.push(`router ${router.name} (${host})`);
  }

  /* ── Paquetes comerciales ───────────────────────────────────────────── */
  const hotspotProfileName = readSeedEnv('SEED_HOTSPOT_PROFILE', 'default');

  for (const demo of DEMO_PROFILES) {
    if (profiles.findByName(router.id, demo.name).length > 0) {
      skipped.push(`perfil ${demo.name}`);
      continue;
    }

    profiles.create({
      name: demo.name,
      routerId: router.id,
      price: demo.price,
      sellingPrice: demo.sellingPrice,
      currency,
      validity: demo.validity,
      validityUnit: demo.validityUnit,
      hotspotProfileName,
      limitUptime: demo.validity,
      limitBytesIn: 0,
      limitBytesOut: 0,
      mode: 'username-password',
      sharedUsers: 1,
      isActive: true,
    });
    created.push(`perfil ${demo.name}`);
  }

  return { created, skipped };
}
