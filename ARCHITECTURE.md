# MikroTik Web Manager — Arquitectura

Panel web de gestión de **Hotspot MikroTik** inspirado en **Mikhmon v3**, sobre
Next.js (App Router) + TypeScript + SQLite + un wrapper propio de la API RouterOS.

> Estado: **Fase 1 — persistencia real**. Estructura, contratos (tipos), capa de
> datos completa (migraciones versionadas + 4 repositorios) con **75 tests en
> verde**. RouterOS, servicios y UI siguen siendo esqueletos con `TODO`.

---

## 1. Stack y decisiones

| Capa | Tecnología | Versión | Nota |
|---|---|---|---|
| Framework | Next.js App Router | 16.4.x | Route Handlers + Server Components |
| UI | React | 19.3.x | — |
| Estilos | Tailwind CSS | 4.3.x | Tema en `@theme` (CSS), sin `tailwind.config` |
| Base de datos | SQLite (`better-sqlite3`) | 13.x | Driver **sincrónico** |
| Migraciones | runner propio (`_migrations`) | — | Sin dependencias extra |
| Tests | Vitest | 5.x | Entorno `node`, DB en memoria |
| Scripts TS | `tsx` | 4.x | Ejecuta CLI con los alias de `tsconfig` |
| RouterOS | `@fibercom/routeros-api` | 2.0.x | Fork mantenido y tipado; se envuelve tras un puerto |
| Auth | `jose` (JWT) + `bcryptjs` | 6.x / 3.x | Cookie httpOnly |
| Validación | `zod` | 4.x | Borde HTTP y `.env` |
| Iconos | `lucide-react` | 1.59.x | — |
| Lenguaje | TypeScript | 5.9.x | (TS 7 nativo existe; se evita el churn) |

**Decisiones relevantes**

- **`@fibercom/routeros-api` en vez de `node-routeros` / `routeros-client`**:
  `node-routeros` está **discontinuado** (deprecado en npm) y `routeros-client`
  no se actualiza desde 2021. `@fibercom/routeros-api` es un fork mantenido
  (MIT, 2026) **con declaraciones TypeScript propias**, compatible con la API
  clásica (`MikrotikAPI`, `connect()`, `write()`) y con soporte de TCP/TLS,
  comandos etiquetados y streams. Todo el proyecto lo consume a través del
  puerto `MikrotikClient`, así que cambiar de librería afecta a **un solo
  archivo** (`core/mikrotik/client.ts`).
- **`better-sqlite3` (síncrono)**: los repositorios son sincrónicos y la
  asincronía se concentra en los servicios (que sí esperan a la red/RouterOS).
- **Runner de migraciones propio en vez de ORM**: SQL explícito, cero
  dependencias, y las tablas ya están derivadas de `@/types`. Un ORM habría
  añadido un segundo vocabulario de modelos.
- **Tailwind v4**: tokens de diseño en `src/app/globals.css` (`@theme`).

---

## 2. Estructura de carpetas

```
src/
├─ app/                        # Capa de presentación + borde HTTP
│  ├─ (auth)/                  # Grupo de rutas SIN segmento de URL
│  │  ├─ layout.tsx            #   shell centrado
│  │  └─ login/page.tsx        #   → /login
│  ├─ dashboard/
│  │  ├─ layout.tsx            # shell autenticado (sidebar/topbar: TODO)
│  │  ├─ page.tsx              # KPIs
│  │  ├─ routers/page.tsx      # CRUD de dispositivos
│  │  ├─ monitoring/page.tsx   # recursos/interfaces/salud
│  │  └─ reports/page.tsx      # ventas
│  ├─ hotspot/
│  │  ├─ users/page.tsx        # usuarios del router
│  │  ├─ profiles/page.tsx     # perfiles (rate-limit, timeouts)
│  │  ├─ active/page.tsx       # sesiones abiertas
│  │  └─ vouchers/page.tsx     # generación/impresión/venta
│  ├─ api/                     # Route Handlers (runtime = 'nodejs')
│  │  ├─ health/route.ts
│  │  ├─ auth/login/route.ts
│  │  ├─ routers/route.ts
│  │  └─ hotspot/{users,profiles,active,vouchers}/route.ts
│  ├─ layout.tsx               # <html>/<body>
│  ├─ page.tsx                 # / → redirige a /dashboard
│  └─ globals.css              # Tailwind + tokens @theme
│
├─ core/                       # Lógica de dominio (sin React, sin HTTP)
│  ├─ constants.ts             # Constantes runtime derivadas de @/types ★
│  ├─ errors.ts                # DomainError + factories (notFound, conflict…) ★
│  ├─ mikrotik/                # Adaptador RouterOS (Ports & Adapters)
│  │  ├─ client.ts             #   RouterOsClient (ÚNICO conoce la lib RouterOS)
│  │  ├─ errors.ts             #   MikrotikError / toMikrotikError
│  │  ├─ commands/
│  │  │  ├─ hotspot.ts         #   builders /ip/hotspot/*
│  │  │  └─ system.ts          #   builders /system, /interface, /ip
│  │  └─ index.ts
│  └─ services/                # Casos de uso (ÚNICA entrada para src/app)
│     ├─ auth.service.ts
│     ├─ router.service.ts
│     ├─ hotspot.service.ts
│     ├─ voucher.service.ts
│     ├─ report.service.ts
│     └─ index.ts
│
├─ database/                   # Persistencia (ÚNICA capa que escribe SQL)
│  ├─ db.ts                    # createDb()/getDb()/closeDb() + PRAGMA
│  ├─ migrate.ts               # runner de migraciones (tabla _migrations)
│  ├─ migrations/              # NNNN_nombre.sql — inmutables una vez aplicadas
│  │  └─ 0001_init.sql
│  ├─ seed.ts                  # Datos de desarrollo (idempotente)
│  ├─ testing.ts               # createTestDb() + helpers de aserción
│  └─ repositories/
│     ├─ base.repository.ts    # CRUD genérico + mapeo + paginación
│     ├─ user.repository.ts
│     ├─ router.repository.ts
│     ├─ voucher.repository.ts
│     ├─ profile.repository.ts
│     └─ index.ts
│
├─ lib/                        # Capa hoja: utilidades, env y cripto
│  ├─ env.ts                   # process.env tipado (AppEnv)
│  ├─ crypto.ts                # AES-256-GCM para secretos en reposo
│  └─ utils.ts                 # cn, formatBytes, parseRosDuration/RateLimit
│
└─ types/
   └─ index.ts                 # ⭐ Contratos globales (100% type-only)

scripts/                       # CLI ejecutables con tsx (no se compilan a la app)
├─ db-migrate.ts               # npm run db:migrate
└─ db-seed.ts                  # npm run db:seed
```

★ = *shared kernel* (ver §3).

---

## 3. Regla de dependencias (unidireccional)

```
        ┌──────────────────────────────────────────────┐
        │  app/  (pages · route handlers · UI)         │
        └───────────────┬──────────────────────────────┘
                        │  solo via @core/services
        ┌───────────────▼──────────────────────────────┐
        │  core/services  (casos de uso, async)        │
        └───────┬───────────────────────────────┬──────┘
                │                               │
   ┌────────────▼─────────────┐      ┌──────────▼─────────────┐
   │ core/mikrotik            │      │ database/repositories  │
   │ (puerto MikrotikClient)  │      │ (SQL sincrónico)       │
   └──────────────┬───────────┘      └──────────┬─────────────┘
                  │                             │
        ┌─────────▼─────────────────────────────▼──────┐
        │  SHARED KERNEL                               │
        │  types/ · lib/ · core/constants.ts ·         │
        │  core/errors.ts                              │
        └──────────────────────────────────────────────┘
```

**Invariantes que se deben respetar en cada PR:**

1. `types/` no importa **nada**; es puro contrato (sin runtime).
2. `lib/` no importa `core`, `database` ni `app`.
3. **Solo** `core/mikrotik/client.ts` conoce `@fibercom/routeros-api`.
4. **Solo** `database/repositories/*` escribe SQL.
5. `app/` **nunca** importa `@fibercom/routeros-api`, `better-sqlite3` ni
   repositorios: pasa siempre por `@core/services`.
6. Ninguna respuesta HTTP sale del `app/` sin envolverse en `ApiResponse<T>`.

**Shared kernel**: `core/constants.ts` y `core/errors.ts` son hojas (no importan
`database` ni `core/services`). Por eso **ambos** lados pueden depender de ellas:
`database/repositories/*` usa `DomainError` para traducir violaciones de
constraint, y `core/services` usa el mismo tipo como canal de error de `Result`.

---

## 4. Persistencia

### 4.1 Migraciones

- Viven en `src/database/migrations/NNNN_nombre.sql` (4 dígitos, orden
  lexicográfico).
- El runner (`src/database/migrate.ts`) las aplica **una vez**, en orden, dentro
  de **una transacción**, y registra `id`, `name`, `checksum` (SHA-256) y
  `applied_at` en la tabla `_migrations`.
- **Idempotente**: re-ejecutar no re-aplica nada.
- **Atómica**: si el SQL falla, la transacción revierte y no queda registrada.
- **Inmutable**: si el contenido de una migración ya aplicada cambia, lanza
  `MigrationError`. Para corregir el esquema se crea una migración **nueva**.
- **Orden estricto**: una migración pendiente con id menor a la última aplicada
  se rechaza (evita esquemas que dependen del orden de llegada).

Reglas para los archivos `.sql`: sin `BEGIN`/`COMMIT` y sin `PRAGMA` (no son
transaccionales; los PRAGMA base los aplica `createDb()`).

`getDb()` **no migra**. Las migraciones se aplican explícitamente con
`npm run db:migrate` o desde los tests con `createTestDb()`.

### 4.2 Repositorios

`BaseRepository<T>` concentra todo el SQL genérico; cada repositorio concreto
solo declara **tabla + mapeo**:

```ts
export class RouterRepository extends BaseRepository<Router> {
  protected override readonly table = 'routers';
  protected override readonly usesSoftDelete = true;   // filtra deleted_at

  protected override toRow(router: Router): SqlRow;    // camelCase → snake_case
  protected override mapRow(row: SqlRow): Router;      // snake_case → camelCase
}
```

Lo que ya viene resuelto y probado en la base:

| Grupo | API |
|---|---|
| Lectura | `findById`, `findAll(opts)`, `count(where)`, `selectOne(where)`, `selectAll(where, orderBy)`, `paginate(where, opts)` |
| Escritura | `create(input)`, `update(id, patch)`, `delete(id)` (lógico si `usesSoftDelete`), `insertRow`, `touch(id, values)` |
| Helpers | `scope(...conds)` (aplica la visibilidad), `cond()`, `buildWhere()`, `json/bool/nowIso/newId` |

- **Inyección de dependencias**: `constructor(db?: Db)`. Sin argumento usa el
  singleton `getDb()` (de forma perezosa). En tests se inyecta `createTestDb()`.
- **Borrado lógico en un solo lugar**: `usesSoftDelete` + `scope()` garantizan
  que ninguna lectura devuelva filas borradas. Un servicio nunca escribe
  `deleted_at IS NULL` a mano.
- **Anti-inyección en `sortBy`**: el valor se contrasta contra las columnas
  reales de la tabla (`PRAGMA table_info`); si no coincide, se ignora y se ordena
  por `created_at`. Todos los valores van como *prepared statement*.
- **Errores**: `SQLITE_CONSTRAINT*` se traduce a `DomainError` (`CONFLICT`), así
  que los servicios reciben un error de dominio y no un `SqliteError` con texto
  en inglés. `update()` inexistente → `NOT_FOUND`.
- **Codificación**: SQLite no tiene booleanos ni arrays: `0/1` y JSON
  (`router_ids`, `request_json`, `metadata`), con los decodificadores
  `asString/asNullableString/asNumber/asInteger/asBoolean/asJson`.

---

## 5. Sincronía vs. asincronía

| Capa | Firma | Motivo |
|---|---|---|
| Repositorios | `findById(id): T \| null` (sync) | `better-sqlite3` es sincrónico |
| Servicios | `async` → `Result<T>` | Esperan red (RouterOS) + orquestan SQL |
| Route Handlers | `async` → `ApiResponse<T>` | Traducen `Result` → HTTP |

Errores **esperados** viajan como `Result<T, AppError>` (materializado por
`DomainError`); las excepciones se reservan para bugs. `MikrotikError` es el
error tipado del adaptador RouterOS.

---

## 6. Modelo de dominio (resumen de `src/types/index.ts`)

| Sección | Tipos clave |
|---|---|
| Primitivos | `UUID`, `ISODateString`, `RosDuration`, `RosRateLimit`, `Result`, `Paginated` |
| RouterOS crudo | `RosItem`, `RosSentence`, `RosTrap`, `RosReply`, **`MikrotikClient`** |
| Router | `Router`, `PublicRouter`, `RouterInput`, `RouterStatus` |
| Telemetría | `RouterIdentity`, `RouterResource`, `InterfaceStat`, `RouterSnapshot` |
| Auth panel | `PanelUser`, `PublicUser`, `SessionUser`, `SessionClaims`, `UserRole` |
| Hotspot | `HotspotServer`, `HotspotProfile`, `HotspotUser`, `HotspotActiveSession` |
| Vouchers | `Voucher`, `VoucherBatch`, `VoucherBatchRequest`, `VoucherMode`, `VoucherStatus` |
| Comercial | `ResellerProfile`, `Transaction`, `SalesSummary`, `DashboardMetrics` |
| Borde HTTP | `ApiResponse<T>`, `ApiError`, `ApiErrorCode`, `ApiHandlerContext` |
| Monitoreo | `MonitoringTopic`, `TrafficSample`, `StreamEvent<T>` |
| Auditoría | `AuditAction`, `AuditLogEntry`, `LogEntry` |

Los **valores** runtime (arrays `as const`, mapa `API_ERROR_STATUS`, `ROS_PATHS`,
`BCRYPT_ROUNDS`) viven en `src/core/constants.ts`, para poder usar `import type`
en todo el código.

**Tablas** (una por agregado, salvo `_migrations`):

| Tabla | Entidad | Borrado |
|---|---|---|
| `users` | `PanelUser` | lógico |
| `routers` | `Router` | lógico |
| `reseller_profiles` | `ResellerProfile` | lógico |
| `voucher_batches` | `VoucherBatch` | físico |
| `vouchers` | `Voucher` | — (se revoca) |
| `transactions` | `Transaction` | — |
| `audit_log` | `AuditLogEntry` | — (append-only) |

---

## 7. Flujo de una petición (ejemplo: crear lote de vouchers)

```
POST /api/hotspot/vouchers
  │
  ├─ 1. app/api/.../route.ts   valida sesión + body con zod
  ├─ 2. voucherService.generateBatch(req, userId)      [core/services]
  │        ├─ routerRepository.findById()               [database]
  │        ├─ descifra password (AES-256-GCM)           [lib/crypto]
  │        ├─ RouterOsClient.exec(hotspotCommands.addUser(...))  [core/mikrotik]
  │        ├─ voucherRepository.insertMany()  (transacción SQLite)
  │        └─ audit_log (acción 'voucher.generate')
  └─ 3. responde ApiResponse<VoucherBatchResult>
```

### 7.1 Superficie de routers (paso 5)

| Método y ruta | Permiso | Notas |
|---|---|---|
| `GET /api/routers` | `routers:read` | Paginado; `search`, `status`, `sortBy` (whitelist) y `pageSize` acotado |
| `POST /api/routers` | `routers:write` | 201; cifra la contraseña; nombre único |
| `GET /api/routers/[id]` | `routers:read` | 404 si no existe o está borrado |
| `PATCH /api/routers/[id]` | `routers:write` | Parcial; `password` vacío → 422 (no borra la actual sin querer) |
| `DELETE /api/routers/[id]` | `routers:write` | Borrado lógico |
| `POST /api/routers/[id]/test` | `routers:read` | Persiste `status`/`lastError`; 502/504 si el equipo no responde |
| `GET /api/routers/[id]/snapshot` | `routers:read` | Identidad, recursos, salud y contadores |
| `GET /api/routers/[id]/interfaces` | `routers:read` | Tasas por interfaz ya calculadas por el servicio |

**Dos desenlaces, dos canales** (convención de todos los servicios):

- Lo **esperado** —no encontrado, nombre duplicado, validación— viaja por
  `Result`: `fail(notFound(...))` → 404, `VALIDATION_ERROR`/`CONFLICT` → 422.
- Lo **excepcional de infraestructura** —router inalcanzable, trap, TLS— se
  **lanza** como `MikrotikError` y `handleRoute` lo traduce a 502/504 con
  `details.mikrotikCode` y `details.command`. Un equipo caído nunca produce un
  500 genérico.

El borde HTTP solo acepta `protocol` `api`|`api-ssl`: `rest` aún no está
soportado y se rechaza con 422 antes de tocar el router.

> **Clasificación de fallos** (`core/mikrotik/errors.ts`). El SDK
> `@fibercom/routeros-api` etiqueta *cualquier* fallo de socket como
> `APIFORBIDDEN` —que en el protocolo significaría credenciales— y esconde el
> código real (`ECONNREFUSED`, `ETIMEDOUT`) dentro del mensaje. El clasificador
> da prioridad al código de socket del texto y deja `APIFORBIDDEN` como último
> recurso; sin esa regla, un puerto cerrado se reportaba como "credenciales
> rechazadas" y el router quedaba `unauthorized` en vez de `offline`.

**UI** (`/dashboard/routers` y `/dashboard/monitoring`). Las páginas son *server
components* que resuelven el primer listado llamando al servicio —sin parpadeo de
"cargando" ni petición extra— y pasan los datos a su componente cliente; solo las
mutaciones pasan por `/api/routers`. El sondeo de monitoreo usa un `setTimeout`
recursivo (nunca solapa lecturas) y el **efecto** es el único dueño de la
escritura de estado: una respuesta que llega tarde, después de cambiar de equipo,
se descarta en lugar de pintar datos del router anterior. La lectura se dispara
al montar, al cambiar de router, al reanudar y con "Actualizar ahora"; en pausa se
hace una sola lectura.

---

## 8. Testing

- **Vitest** en entorno `node`; alias de `tsconfig` replicados en
  `vitest.config.mts`.
- Persistencia: `createTestDb()` abre un SQLite **en memoria** (`:memory:`) y
  aplica las migraciones reales. Cada test tiene su propia conexión → sin estado
  compartido y sin tocar `data/*.sqlite`.
- Los repositorios se instancian con la conexión inyectada
  (`new RouterRepository(createTestDb())`).
- Cobertura de la capa de datos: CRUD, paginación y orden, whitelist de
  `sortBy`, búsqueda, borrado lógico, traducción de constraints, agregados de
  vouchers, atomicidad de `insertMany`, idempotencia del seed y round-trip
  criptográfico.
- **RouterOS sin router**: el `ConnectionPool` se ejercita de verdad
  (reutilización y desalojo) inyectando una **fábrica de clientes falsa** y un
  reloj/`sleep` controlados, de modo que los intervalos de muestreo son
  deterministas. Los parsers RouterOS→dominio y el mapeo formulario→payload
  (`router-payload.ts`, función pura) se prueban sin React ni navegador.
- **Sin mocks del borde**: `http.test.ts` verifica la traducción Zod→422,
  `DomainError`→código y `MikrotikError`→502/504.

```bash
npm test              # vitest run
npm run test:watch    # modo watch
npm run test:coverage # informe v8 (text + html)
```

---

## 9. Seguridad

- Contraseña del router **cifrada en reposo**: AES-256-GCM (`lib/crypto.ts`),
  clave derivada de `ENCRYPTION_KEY` (hex de 64, base64 de 32 bytes o SHA-256
  del texto). Formato versionado `v1:iv:tag:data`; GCM detecta manipulación.
- El tipo `Router` guarda `passwordEncrypted`; el borde nunca ve el claro.
- `PublicRouter = Omit<Router, 'passwordEncrypted'>` para todo lo que sale al cliente.
- `PublicUser = Omit<PanelUser, 'passwordHash'>`; hash con bcrypt (`BCRYPT_ROUNDS`).
- Sesión en cookie **httpOnly** (JWT firmado con `jose`), `SESSION_TTL_SECONDS`.
- **Login sin enumeración de usuarios**: si el usuario no existe se compara la
  contraseña contra un hash señuelo, para igualar el coste de bcrypt.
- **Revocación de sesiones** por `jti` (`core/auth/denylist.ts`): el logout
  invalida el token en el servidor aunque la cookie siga en un cliente.
  ⚠️ La lista vive **en memoria del proceso**: se pierde al reiniciar y no se
  comparte entre instancias. Para varios procesos hay que moverla a SQLite/Redis
  (ver §9.1).
- El **proxy** (`src/proxy.ts`) solo hace una comprobación optimista de firma
  para redirigir; la autorización real vive en los Route Handlers
  (`requireSession`/`requirePermission`) y reverifica al usuario contra la BD.
- `audit_log` **append-only** para acciones sensibles (`AuditAction`).
- **Alcance por usuario**: `SessionUser.routerIds` limita el acceso a un equipo
  concreto (`requireRouterAccess`), y las rutas de detalle/acciones lo exigen.
  ⚠️ **Los listados aún no filtran por ese alcance**: un `reseller` vería los
  nombres de routers que no puede abrir (recibiría 403 al entrar). Gestionar
  usuarios (`users:manage`) todavía no permite asignar routers, así que hoy solo
  alcanza a datos sembrados a mano; se cierra pasando el alcance al repositorio
  en el paso 10.
- `better-sqlite3` siempre con *prepared statements* (sin SQL por concatenación).

### 9.1 Límite conocido: revocación en memoria

`SessionDenylist` guarda los `jti` revocados hasta su `exp`, con una cota
(`maxEntries`) que sacrifica primero los que expiran antes. Es correcto para un
despliegue de un solo proceso (el objetivo actual) y para las pruebas de
integración; **no** es una solución multi-instancia. Si el panel se escala a
varios nodos, sustituir por una tabla `revoked_sessions(jti PRIMARY KEY, exp)` o
Redis con TTL = `exp`.

---

## 10. Roadmap sugerido (un PR por paso)

| # | Paso | Skills/agentes ECC |
|---|---|---|
| 1 | ✅ **Fase 0**: estructura, `package.json`, tipos, esqueletos | `planner`, `architect` |
| 2 | ✅ **Migraciones + runner (`_migrations`) y repositorios reales con tests** (+ `lib/crypto`, seed) | `tdd-workflow`, `database-migrations` |
| 3 | ✅ **`RouterOsClient`** (`connect`/`exec`/`execute`/`stream`) + `ConnectionPool` sobre una costura de transporte inyectable | `netmiko`-patrones, `tdd-workflow` |
| 4 | ✅ **Auth**: login, JWT + cookie httpOnly, `proxy.ts`, RBAC, revocación por `jti` | `security-review`, `tdd-workflow` |
| 5 | ✅ **CRUD de routers + `testConnection` + monitoreo** (8 endpoints, parsers, UI con sondeo) | `react-patterns`, `api-design` |
| 6 | ✅ **Hotspot: usuarios, perfiles, sesiones activas** (servicio + 7 endpoints + UI) | `api-design` |
| 7 | ? **Vouchers: generaci�n por lote, venta, revocaci�n** (servicio + endpoints + UI) | `tdd-workflow` |
| 8 | ? **Impresi�n** (QR/card/thermal/a4-grid) � buildPrintJob + QR data URLs | `ui-demo` |
| 9 | ? **Reportes + dashboard KPI** (getDashboardMetrics, getSalesSummary) | `dashboard-builder` |
| 10 | ? **Hardening**: rate-limit (login), auditor�a (audit_log), verificaci�n | `verification-loop`, `security-review` |

---

## 11. Comandos

```bash
npm install           # Node >= 22 (usa v24)
npm run dev           # http://localhost:3000
npm run typecheck     # tsc --noEmit
npm run lint          # eslint .
npm test              # vitest run
npm run build

npm run db:migrate    # aplica migraciones pendientes (idempotente)
npm run db:seed       # owner + router demo + 3 paquetes (idempotente)
```

Copiar `.env.example` → `.env.local` y generar secretos:

```bash
openssl rand -base64 48   # SESSION_SECRET
openssl rand -base64 32   # ENCRYPTION_KEY (32 bytes)

# Sin openssl (p. ej. Windows), con Node:
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

El seed requiere `ENCRYPTION_KEY` (cifra la contraseña del router de ejemplo) y
acepta overrides por entorno: `SEED_OWNER_USERNAME`, `SEED_OWNER_PASSWORD`,
`SEED_ROUTER_HOST`, `SEED_ROUTER_PASSWORD`, `SEED_HOTSPOT_PROFILE`,
`SEED_CURRENCY`, `SEED_TIMEZONE`.
