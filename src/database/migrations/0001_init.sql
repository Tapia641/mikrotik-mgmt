-- ═══════════════════════════════════════════════════════════════════════════
--  0001_init — Esquema inicial
--
--  Aplicada por `src/database/migrate.ts` dentro de una transaccion.
--  Reglas para los archivos de este directorio:
--    * nombre: NNNN_descripcion.sql  (NNNN = 4 digitos, orden lexicografico)
--    * NO incluir BEGIN/COMMIT (el runner ya envuelve en transaccion)
--    * NO incluir PRAGMA (no son transaccionales)
--    * una migracion aplicada es INMUTABLE: el runner verifica su checksum
--
--  SQLite no tiene `enum`: las columnas de estado son TEXT con CHECK y su
--  dominio se valida ademas con zod en la capa de servicios.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Usuarios del panel ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                   TEXT PRIMARY KEY,
  username             TEXT NOT NULL UNIQUE,
  email                TEXT,
  password_hash        TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('owner','admin','operator','reseller','viewer')),
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','pending')),
  reseller_profile_id  TEXT,
  router_ids           TEXT NOT NULL DEFAULT '[]',   -- JSON array de UUID
  last_login_at        TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  deleted_at           TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ── Routers gestionados ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS routers (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL UNIQUE,
  description        TEXT,
  host               TEXT NOT NULL,
  port               INTEGER NOT NULL,
  protocol           TEXT NOT NULL DEFAULT 'api' CHECK (protocol IN ('api','api-ssl','rest')),
  username           TEXT NOT NULL,
  password_encrypted TEXT NOT NULL,               -- AES-256-GCM (base64)
  tls_insecure       INTEGER NOT NULL DEFAULT 0,
  timeout_ms         INTEGER NOT NULL DEFAULT 8000,
  timezone           TEXT NOT NULL DEFAULT 'UTC',
  currency           TEXT NOT NULL DEFAULT 'USD',
  is_active          INTEGER NOT NULL DEFAULT 1,
  status             TEXT NOT NULL DEFAULT 'unknown'
                       CHECK (status IN ('unknown','connecting','online','offline','unauthorized')),
  last_seen_at       TEXT,
  last_error         TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  deleted_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_routers_status ON routers(status);

-- ── Perfiles comerciales / revendedores ───────────────────────────────────
CREATE TABLE IF NOT EXISTS reseller_profiles (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  router_id            TEXT NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
  price                REAL NOT NULL DEFAULT 0,
  selling_price        REAL,
  currency             TEXT NOT NULL DEFAULT 'USD',
  validity             TEXT,
  validity_unit        TEXT NOT NULL DEFAULT 'days'
                         CHECK (validity_unit IN ('minutes','hours','days','months')),
  hotspot_profile_name TEXT NOT NULL,
  limit_uptime         TEXT,
  limit_bytes_in       INTEGER NOT NULL DEFAULT 0,  -- 0 = ilimitado
  limit_bytes_out      INTEGER NOT NULL DEFAULT 0,
  mode                 TEXT NOT NULL DEFAULT 'username-password'
                         CHECK (mode IN ('username-password','username-only','password-only')),
  shared_users         INTEGER NOT NULL DEFAULT 1,
  is_active            INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  deleted_at           TEXT
);
CREATE INDEX IF NOT EXISTS idx_reseller_profiles_router ON reseller_profiles(router_id);

-- ── Lotes de generacion de vouchers ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS voucher_batches (
  id           TEXT PRIMARY KEY,
  router_id    TEXT NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
  profile_name TEXT NOT NULL,
  mode         TEXT NOT NULL,
  quantity     INTEGER NOT NULL,
  price        REAL NOT NULL DEFAULT 0,
  request_json TEXT NOT NULL,                       -- VoucherBatchRequest serializado
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_voucher_batches_router ON voucher_batches(router_id);

-- ── Vouchers ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vouchers (
  id              TEXT PRIMARY KEY,
  code            TEXT NOT NULL,
  password        TEXT,
  router_id       TEXT NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
  profile_name    TEXT NOT NULL,
  validity        TEXT,
  limit_uptime    TEXT,
  limit_bytes_in  INTEGER NOT NULL DEFAULT 0,
  limit_bytes_out INTEGER NOT NULL DEFAULT 0,
  price           REAL NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'USD',
  status          TEXT NOT NULL DEFAULT 'available'
                    CHECK (status IN ('available','sold','active','used','expired','revoked')),
  batch_id        TEXT REFERENCES voucher_batches(id) ON DELETE SET NULL,
  reseller_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  sold_at         TEXT,
  activated_at    TEXT,
  expires_at      TEXT,
  comment         TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (router_id, code)
);
CREATE INDEX IF NOT EXISTS idx_vouchers_status ON vouchers(status);
CREATE INDEX IF NOT EXISTS idx_vouchers_batch ON vouchers(batch_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_reseller ON vouchers(reseller_id);

-- ── Transacciones (ventas) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id             TEXT PRIMARY KEY,
  router_id      TEXT NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
  voucher_id     TEXT REFERENCES vouchers(id) ON DELETE SET NULL,
  voucher_code   TEXT,
  reseller_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  profile_name   TEXT NOT NULL,
  amount         REAL NOT NULL DEFAULT 0,
  currency       TEXT NOT NULL DEFAULT 'USD',
  status         TEXT NOT NULL DEFAULT 'completed'
                   CHECK (status IN ('pending','completed','refunded','void')),
  payment_method TEXT NOT NULL DEFAULT 'cash'
                   CHECK (payment_method IN ('cash','transfer','qris','ewallet','other')),
  sold_at        TEXT NOT NULL,
  note           TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transactions_sold_at ON transactions(sold_at);
CREATE INDEX IF NOT EXISTS idx_transactions_router ON transactions(router_id);

-- ── Auditoria (append-only) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  actor_id   TEXT,
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  TEXT,
  router_id  TEXT,
  ip         TEXT,
  metadata   TEXT NOT NULL DEFAULT '{}',            -- JSON libre
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action, created_at);
