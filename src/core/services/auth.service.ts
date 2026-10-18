import type {
  AppError,
  Credentials,
  LoginResult,
  PanelUserInput,
  PublicUser,
  Result,
  Session,
  SessionUser,
  UUID,
} from '@/types';

import { needsRehash, hashPassword, verifyPassword as verifyPasswordHash } from '@/core/auth/password';
import { toPublicUser, toSessionUser } from '@/core/auth/authz';
import { getSessionDenylist, type SessionDenylist } from '@/core/auth/denylist';
import { SessionTokenError, signSessionToken, verifySessionToken } from '@/core/auth/token';
import { BCRYPT_ROUNDS } from '@/core/constants';
import { conflict, forbidden, invalidInput, isDomainError, notFound, unauthorized } from '@/core/errors';
import { userRepository, type UserRepository } from '@/database/repositories';
import { env } from '@/lib/env';

/**
 * Casos de uso de autenticacion del panel.
 *
 * `passwordHash` (bcrypt) y el JWT (`jose`) NUNCA salen de esta capa; hacia
 * arriba solo viajan `PublicUser`, `SessionUser` y el token (que el Route
 * Handler deposita en una cookie httpOnly).
 *
 * Errores *esperados* (credenciales malas, cuenta suspendida) viajan por el
 * canal `Result`; solo los bugs escapan como excepcion.
 */

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const MIN_USERNAME_LENGTH = 3;

export interface LoginContext {
  readonly userAgent?: string;
  readonly ip?: string;
}

export interface AuthService {
  login(credentials: Credentials, context?: LoginContext): Promise<Result<LoginResult>>;
  /** Idempotente: revoca el `jti` del token; un token ya invalido no es error. */
  logout(token: string): Promise<Result<void>>;
  createUser(input: PanelUserInput): Promise<Result<PublicUser>>;
  resolveSession(token: string): Promise<Result<SessionUser>>;
  changePassword(userId: UUID, currentPassword: string, newPassword: string): Promise<Result<void>>;
  hashPassword(plain: string): Promise<string>;
  verifyPassword(plain: string, hash: string): Promise<boolean>;
}

export interface AuthServiceDeps {
  readonly users?: UserRepository;
  readonly denylist?: SessionDenylist;
  readonly secret?: string;
  readonly ttlSeconds?: number;
  readonly passwordRounds?: number;
  /** Epoch en segundos (tests deterministas). */
  readonly now?: () => number;
}

/* ── Utilidades del canal `Result` ───────────────────────────────────────── */

function success<T>(value: T): Result<T> {
  return { ok: true, value };
}

function fail<T>(error: AppError): Result<T> {
  return { ok: false, error };
}

/** Convierte un `DomainError` de los repositorios en el canal `Result`. */
async function guard<T>(run: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await run();
  } catch (cause) {
    if (isDomainError(cause)) return fail(cause);
    throw cause;
  }
}

function matchesUsername(value: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(value);
}

/** `DomainError` si la contrasena no cumple la politica; `null` si es valida. */
function validatePassword(password: string): AppError | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return invalidInput(`La contrasena debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return invalidInput(`La contrasena no puede superar ${MAX_PASSWORD_LENGTH} caracteres.`);
  }
  return null;
}

/**
 * Hash señuelo: iguala el coste de bcrypt aunque el usuario no exista, para no
 * filtrar por tiempo de respuesta si el usuario esta registrado.
 *
 * Se cachea POR COSTE: un `??=` global devolveria el primer coste calculado y
 * el señuelo dejaria de igualar el coste real si `BCRYPT_ROUNDS` cambia.
 */
const decoyHashes = new Map<number, Promise<string>>();
function getDecoyHash(rounds: number): Promise<string> {
  const cached = decoyHashes.get(rounds);
  if (cached !== undefined) return cached;

  const created = hashPassword('decoy-password-that-never-matches', rounds);
  decoyHashes.set(rounds, created);
  return created;
}

function fromTokenError(error: SessionTokenError): AppError {
  return unauthorized(
    error.reason === 'expired' ? 'La sesion expiro. Inicia sesion de nuevo.' : 'Sesion invalida.',
  );
}

/* ── Implementacion ─────────────────────────────────────────────────────── */

export function createAuthService(deps: AuthServiceDeps = {}): AuthService {
  const users = deps.users ?? userRepository;
  const denylist = deps.denylist ?? getSessionDenylist();
  const secret = deps.secret ?? env.SESSION_SECRET;
  const ttlSeconds = deps.ttlSeconds ?? env.SESSION_TTL_SECONDS;
  const rounds = deps.passwordRounds ?? BCRYPT_ROUNDS;
  const now = deps.now;

  async function hashUserPassword(plain: string): Promise<string> {
    return hashPassword(plain, rounds);
  }

  /**
   * Opciones de verificacion ancladas al MISMO reloj que la firma. Si no se
   * inyecta reloj se usa el del sistema (`Date.now`), que es el caso real.
   */
  function verifyOptions(): { readonly secret: string; readonly now?: number } {
    return { secret, ...(now === undefined ? {} : { now: now() }) };
  }

  return {
    async login(credentials, context) {
      return guard(async () => {
        const username = credentials.username.trim();
        const user = username.length === 0 ? null : users.findByUsername(username);

        if (!user) {
          // Coste equivalente al de un usuario real: no se filtra su existencia.
          await verifyPasswordHash(credentials.password, await getDecoyHash(rounds));
          return fail(unauthorized('Usuario o contrasena incorrectos.'));
        }

        if (user.status === 'suspended') {
          return fail(forbidden('La cuenta esta suspendida. Contacta al administrador.'));
        }
        if (user.status === 'pending') {
          return fail(forbidden('La cuenta todavia no fue activada.'));
        }

        const valid = await verifyPasswordHash(credentials.password, user.passwordHash);
        if (!valid) {
          return fail(unauthorized('Usuario o contrasena incorrectos.'));
        }

        const { token, claims } = await signSessionToken({
          subject: user.id,
          role: user.role,
          routerIds: user.routerIds,
          secret,
          ttlSeconds,
          ...(now === undefined ? {} : { now: now() }),
        });

        // Rehash transparente si el coste configurado cambio.
        if (needsRehash(user.passwordHash, rounds)) {
          users.updatePassword(user.id, await hashUserPassword(credentials.password));
        }

        users.markLogin(user.id);
        const current = users.findById(user.id) ?? user;

        const session: Session = {
          id: claims.jti,
          userId: current.id,
          user: toSessionUser(current),
          issuedAt: claims.iat,
          expiresAt: claims.exp,
          ...(context?.userAgent === undefined ? {} : { userAgent: context.userAgent }),
          ...(context?.ip === undefined ? {} : { ip: context.ip }),
        };

        return success({ user: toPublicUser(current), session, token });
      });
    },

    async logout(token) {
      if (token.trim().length === 0) return success(undefined);

      try {
        const claims = await verifySessionToken(token, verifyOptions());
        denylist.revoke(claims.jti, claims.exp);
      } catch {
        // Token ilegible o ya expirado: no hay nada que revocar.
      }

      return success(undefined);
    },

    async resolveSession(token) {
      let userId: UUID;
      let tokenId: string;

      try {
        const claims = await verifySessionToken(token, verifyOptions());
        userId = claims.sub;
        tokenId = claims.jti;
      } catch (cause) {
        if (cause instanceof SessionTokenError) return fail(fromTokenError(cause));
        throw cause;
      }

      if (denylist.isRevoked(tokenId)) {
        return fail(unauthorized('La sesion fue cerrada. Inicia sesion de nuevo.'));
      }

      const user = users.findById(userId);
      if (!user) return fail(unauthorized('La cuenta ya no existe.'));
      if (user.status !== 'active') return fail(forbidden('La cuenta esta inactiva.'));

      // El token puede llevar datos viejos: manda la base de datos.
      return success(toSessionUser(user));
    },

    async createUser(input) {
      return guard(async () => {
        const username = input.username.trim();

        if (username.length < MIN_USERNAME_LENGTH) {
          return fail(invalidInput(`El usuario debe tener al menos ${MIN_USERNAME_LENGTH} caracteres.`));
        }
        if (!matchesUsername(username)) {
          return fail(invalidInput('El usuario solo admite letras, numeros, punto, guion y guion bajo.'));
        }

        const passwordError = validatePassword(input.password);
        if (passwordError) return fail(passwordError);

        if (users.findByUsername(username)) {
          return fail(conflict(`El usuario "${username}" ya existe.`));
        }

        const created = users.create({
          username,
          email: input.email ?? null,
          passwordHash: await hashUserPassword(input.password),
          role: input.role,
          status: 'active',
          resellerProfileId: input.resellerProfileId ?? null,
          routerIds: [...(input.routerIds ?? [])],
          lastLoginAt: null,
          mustChangePassword: false,
        });

        return success(toPublicUser(created));
      });
    },

    async changePassword(userId, currentPassword, newPassword) {
      return guard(async () => {
        const user = users.findById(userId);
        if (!user) return fail(notFound('Usuario', userId));

        if (!(await verifyPasswordHash(currentPassword, user.passwordHash))) {
          return fail(unauthorized('La contrasena actual no coincide.'));
        }

        const passwordError = validatePassword(newPassword);
        if (passwordError) return fail(passwordError);

        if (newPassword === currentPassword) {
          return fail(invalidInput('La nueva contrasena debe ser distinta de la actual.'));
        }

        users.updatePassword(user.id, await hashUserPassword(newPassword));
        return success(undefined);
      });
    },

    async hashPassword(plain) {
      return hashUserPassword(plain);
    },

    async verifyPassword(plain, hash) {
      return verifyPasswordHash(plain, hash);
    },
  };
}

/** Instancia por defecto (singleton de la app) con los secretos del entorno. */
export const authService: AuthService = createAuthService();
