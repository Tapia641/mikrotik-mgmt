# MikroTik Web Manager

Panel web para la gestión de **Hotspot MikroTik** (routers, usuarios, perfiles,
vouchers, sesiones y reportes), inspirado en **Mikhmon v3**.

- **Stack:** Next.js (App Router) · TypeScript · Tailwind CSS · SQLite
  (`better-sqlite3`) · wrapper propio de la API RouterOS
  (`@fibercom/routeros-api`).
- **Estado:** Fase 1 — **persistencia real**. Migraciones versionadas + 4
  repositorios con 75 tests en verde. RouterOS, servicios y UI siguen como
  esqueletos con `TODO`.

📐 El diseño completo está en **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

## Requisitos

- Node.js **≥ 22** (probado con v24)
- Un router MikroTik con **API habilitada** (`/ip service enable api`), puerto
  8728 (o 8729 con `api-ssl`).

## Puesta en marcha

```bash
npm install
cp .env.example .env.local   # y completar SESSION_SECRET / ENCRYPTION_KEY
npm run db:migrate           # crea el esquema en data/
npm run db:seed              # datos de ejemplo (owner / admin12345)
npm run dev                  # http://localhost:3000 → /login
```

> `db:migrate` y `db:seed` cargan `.env.local`/`.env` por su cuenta (`scripts/load-env.ts`),
> así que no hace falta exportar las variables en la terminal.

Generar secretos:

```bash
openssl rand -base64 48   # → SESSION_SECRET
openssl rand -base64 32   # → ENCRYPTION_KEY
```

Si no tienes `openssl` (por ejemplo en Windows), con Node:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"   # SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # ENCRYPTION_KEY
```

## Scripts

| Script | Descripción |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción |
| `npm run start` | Servir el build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Tests (Vitest) |
| `npm run test:coverage` | Tests + cobertura v8 |
| `npm run db:migrate` | Aplica migraciones pendientes (idempotente) |
| `npm run db:seed` | Inserta datos de desarrollo (idempotente) |

## Autenticación

- Login en `/login`; el formulario llama a `POST /api/auth/login`, que deposita
  el JWT en una cookie **httpOnly** (`mt_session`). El token nunca viaja en el
  JSON de respuesta ni es legible desde JavaScript.
- `src/proxy.ts` protege `/dashboard` y `/hotspot` y redirige a `/login?next=…`
  sin sesión válida. Es una comprobación **optimista**: la autorización real la
  aplican los Route Handlers.
- Roles y permisos: `viewer` < `reseller` < `operator` < `admin` < `owner`
  (matriz en `src/core/auth/authz.ts`).

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/auth/login` | `{ username, password }` → `{ user, session }` + cookie |
| `POST` | `/api/auth/logout` | Revoca el `jti` y borra la cookie (idempotente) |
| `GET` | `/api/auth/me` | `{ user, permissions }` de la sesión actual |

Credenciales del seed: `owner` / `admin12345` (cámbialas en producción).

## Routers y monitoreo

La contraseña de cada router se guarda **cifrada** (AES-256-GCM) y nunca vuelve
al navegador.

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/routers` | Listado paginado (`search`, `status`, `sortBy`) |
| `POST` | `/api/routers` | Alta (nombre único, `password` obligatoria) |
| `GET` | `/api/routers/[id]` | Detalle |
| `PATCH` | `/api/routers/[id]` | Edición parcial (`password` vacía se ignora) |
| `DELETE` | `/api/routers/[id]` | Baja lógica |
| `POST` | `/api/routers/[id]/test` | Prueba de conexión; guarda `status`/`lastError` |
| `GET` | `/api/routers/[id]/snapshot` | Identidad, recursos y salud |
| `GET` | `/api/routers/[id]/interfaces` | Tasas de tráfico por interfaz |

- Todas exigen `routers:read` (lecturas) o `routers:write` (mutaciones).
- Si el equipo no responde, la respuesta es **502/504** con
  `error.details.mikrotikCode` (p. ej. `CONNECTION_REFUSED`, `CONNECTION_TIMEOUT`,
  `AUTH_FAILED`), no un 500 genérico.
- UI: `/dashboard/routers` (alta, edición, prueba de conexión) y
  `/dashboard/monitoring` (CPU, memoria, uptime y tráfico por interfaz, con
  sondeo cada 4 s y botones de pausa/refresco).

## Estructura

```
src/
├─ app/         # UI (App Router) + API routes — mapa en ARCHITECTURE.md §2
├─ core/        # mikrotik/ (adaptador RouterOS) + services/ (casos de uso)
├─ database/    # db.ts, migrate.ts, migrations/, seed.ts, repositories/
├─ lib/         # env.ts, crypto.ts, utils.ts (capa hoja)
└─ types/       # index.ts — contratos globales
scripts/        # CLI (db-migrate.ts, db-seed.ts)
```

## Base de datos

- Esquema versionado en `src/database/migrations/NNNN_*.sql`. Una migración ya
  aplicada es **inmutable** (el runner verifica su checksum).
- El archivo vive en `data/mikrotik-manager.sqlite` (ignorado por git) y se crea
  al ejecutar `npm run db:migrate`.

## Verificar

```bash
npm run typecheck
npm test
npm run build
# luego:  GET http://localhost:3000/api/health
```
