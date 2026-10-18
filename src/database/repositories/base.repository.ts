import { randomUUID } from 'node:crypto';

import type { Entity, Paginated, PaginationParams, SortDirection, UUID } from '@/types';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@/core/constants';
import { conflict, notFound } from '@/core/errors';

import { getDb, type Db } from '../db';

/**
 * Base de los repositorios SQLite.
 *
 * `better-sqlite3` es SINCRONO: estos metodos NO devuelven Promise
 * (ver ARCHITECTURE.md §4). La asincronia vive en `core/services`.
 *
 * Cada subclase declara su `table` y sus dos mapeos (`toRow` / `mapRow`); el
 * resto (insert/update/delete/paginacion/orden) es generico y esta cubierto por
 * tests una sola vez.
 *
 * Inyeccion de dependencias: el constructor acepta un `Db` opcional para tests
 * (`new RouterRepository(createTestDb())`). Sin argumento usa el singleton
 * `getDb()`, y lo hace de forma perezosa (no abre la BD al importar el modulo).
 */

/** Valores que `better-sqlite3` acepta como parametro ligado. */
export type SqliteValue = string | number | bigint | null;

/** Una fila cruda de SQLite ya decodificada por el driver. */
export type SqlRow = Readonly<Record<string, SqliteValue>>;

export interface WhereCondition {
  readonly sql: string;
  readonly params: readonly SqliteValue[];
}

export interface WhereClause {
  readonly sql: string;
  readonly params: readonly SqliteValue[];
}

export const NO_WHERE: WhereClause = { sql: '', params: [] };

/** Condicion SQL suelta; composable con `&&` y `false` para filtros opcionales. */
export function cond(sql: string, ...params: SqliteValue[]): WhereCondition {
  return { sql, params };
}

/** Une condiciones con `AND` (los `false`/`null` se descartan). */
export function buildWhere(
  conditions: readonly (WhereCondition | undefined | null | false)[],
): WhereClause {
  const active = conditions.filter((value): value is WhereCondition => Boolean(value));
  if (active.length === 0) return NO_WHERE;

  return {
    sql: `WHERE ${active.map((value) => value.sql).join(' AND ')}`,
    params: active.flatMap((value) => [...value.params]),
  };
}

/* ── Decodificadores (SQLite no tiene booleanos ni JSON) ─────────────────── */

export function asString(value: SqliteValue | undefined): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : String(value);
}

export function asNullableString(value: SqliteValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : String(value);
}

export function asNumber(value: SqliteValue | undefined): number {
  if (typeof value === 'number') return value;
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function asInteger(value: SqliteValue | undefined): number {
  return Math.trunc(asNumber(value));
}

export function asBoolean(value: SqliteValue | undefined): boolean {
  return value === 1 || value === '1';
}

export function asJson<TValue>(value: SqliteValue | undefined, fallback: TValue): TValue {
  if (typeof value !== 'string' || value === '') return fallback;
  try {
    return JSON.parse(value) as TValue;
  } catch {
    return fallback;
  }
}

/** Entrada de creacion: la entidad sin los campos que genera el repositorio. */
export type CreateInput<T extends Entity> = Omit<T, keyof Entity | 'deletedAt'>;

/** Entrada de actualizacion: cualquier subconjunto mutable de la entidad. */
export type UpdateInput<T extends Entity> = Partial<CreateInput<T>>;

export interface Repository<T extends Entity> {
  findById(id: UUID): T | null;
  findAll(params?: PaginationParams): Paginated<T>;
  count(where?: WhereClause): number;
  create(input: CreateInput<T>): T;
  update(id: UUID, patch: UpdateInput<T>): T;
  delete(id: UUID): void;
}

/** Subconjunto de `better-sqlite3` que usamos; facilita dobles de prueba. */
interface SqliteFailure {
  readonly code?: string;
  readonly message?: string;
}

/** Traduce violaciones de constraint a errores de dominio legibles. */
function translateSqliteError(error: unknown): unknown {
  if (!(error instanceof Error)) return error;

  const { code, message } = error as SqliteFailure;

  if (typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT')) {
    if (code.includes('UNIQUE')) {
      return conflict('El registro ya existe o duplica un valor unico.', { sqliteCode: code });
    }
    if (code.includes('FOREIGNKEY')) {
      return conflict('El registro referencia una entidad inexistente.', { sqliteCode: code });
    }
    return conflict('El registro viola una restriccion de la base de datos.', { sqliteCode: code });
  }

  return error instanceof Error ? error : new Error(message ?? 'Error de SQLite');
}

export abstract class BaseRepository<T extends Entity> implements Repository<T> {
  private readonly injectedDb: Db | undefined;
  private cachedColumns: ReadonlySet<string> | undefined;

  protected abstract readonly table: TableName;

  /** `true` en tablas con columna `deleted_at` (borrado logico). */
  protected readonly usesSoftDelete: boolean = false;

  protected constructor(db?: Db) {
    this.injectedDb = db;
  }

  /** Conexion a usar: la inyectada o el singleton de la app. */
  protected get db(): Db {
    return this.injectedDb ?? getDb();
  }

  /** Columnas reales de la tabla (whitelist para `sortBy`). Se cachea. */
  protected get columns(): ReadonlySet<string> {
    if (this.cachedColumns) return this.cachedColumns;

    const info = this.db.pragma(`table_info(${this.table})`) as { name: string }[];
    this.cachedColumns = new Set(info.map((column) => column.name));
    return this.cachedColumns;
  }

  /* ── Visibilidad (borrado logico) ─────────────────────────────────────── */

  /**
   * Condicion que oculta las filas borradas logicamente. Es el UNICO lugar
   * donde se aplica esa regla: toda lectura pasa por `scope()`.
   */
  protected visibility(): WhereCondition | false {
    return this.usesSoftDelete ? cond('deleted_at IS NULL') : false;
  }

  /** `WhereClause` con la visibilidad del repositorio ya antepuesta. */
  protected scope(
    ...conditions: readonly (WhereCondition | false | undefined | null)[]
  ): WhereClause {
    return buildWhere([this.visibility(), ...conditions]);
  }

  /* ── Mapeo (lo implementa cada repositorio concreto) ───────────────────── */

  /** Entidad → mapa columna/valor (claves en `snake_case`). */
  protected abstract toRow(entity: T): SqlRow;

  /** Fila cruda → entidad de dominio. */
  protected abstract mapRow(row: SqlRow): T;

  /* ── Lectura ──────────────────────────────────────────────────────────── */

  public findById(id: UUID): T | null {
    return this.selectOne(this.scope(cond('id = ?', id)));
  }

  public findAll(params: PaginationParams = {}): Paginated<T> {
    return this.paginate(this.scope(), params);
  }

  public count(where: WhereClause = NO_WHERE): number {
    const bind = [...where.params];
    const row = this.db
      .prepare<SqliteValue[], { total: number }>(
        `SELECT COUNT(*) AS total FROM ${this.table} ${where.sql}`,
      )
      .get(...bind);

    return row?.total ?? 0;
  }

  /* ── Escritura ────────────────────────────────────────────────────────── */

  public create(input: CreateInput<T>): T {
    const now = new Date().toISOString();

    // El cast es inevitable y esta contenido: `deletedAt` (excluido de la
    // entrada) se materializa como `NULL` en el `toRow` de cada repositorio.
    const fields = {
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };

    // Las tablas con borrado logico nacen visibles; las demas no tienen columna.
    const entity = (this.usesSoftDelete ? { ...fields, deletedAt: null } : fields) as unknown as T;

    this.insertRow(entity);
    return entity;
  }

  public update(id: UUID, patch: UpdateInput<T>): T {
    const current = this.findById(id);
    if (!current) throw notFound(this.table, id);

    const merged = {
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    } as T;

    this.runUpdate(this.toRow(merged), id);
    return merged;
  }

  public delete(id: UUID): void {
    if (!this.usesSoftDelete) {
      this.run(`DELETE FROM ${this.table} WHERE id = ?`, id);
      return;
    }

    const now = new Date().toISOString();
    this.run(`UPDATE ${this.table} SET deleted_at = ?, updated_at = ? WHERE id = ?`, now, now, id);
  }

  /* ── Utilidades para las subclases ────────────────────────────────────── */

  protected selectOne(where: WhereClause): T | null {
    const bind = [...where.params];
    const row = this.db
      .prepare<SqliteValue[], SqlRow>(`SELECT * FROM ${this.table} ${where.sql} LIMIT 1`)
      .get(...bind);

    return row === undefined ? null : this.mapRow(row);
  }

  protected selectAll(where: WhereClause = NO_WHERE, orderBy?: string): T[] {
    const bind = [...where.params];
    const order = orderBy ?? this.orderByClause();

    return this.db
      .prepare<SqliteValue[], SqlRow>(`SELECT * FROM ${this.table} ${where.sql} ${order}`)
      .all(...bind)
      .map((row) => this.mapRow(row));
  }

  protected paginate(where: WhereClause = NO_WHERE, params: PaginationParams = {}): Paginated<T> {
    const page = Math.max(1, Math.trunc(params.page ?? 1));
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(params.pageSize ?? DEFAULT_PAGE_SIZE)));

    const total = this.count(where);
    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
    const offset = (page - 1) * pageSize;
    const bind = [...where.params, pageSize, offset];

    const rows = this.db
      .prepare<SqliteValue[], SqlRow>(
        `SELECT * FROM ${this.table} ${where.sql} ${this.orderByClause(params.sortBy, params.sortDirection)} LIMIT ? OFFSET ?`,
      )
      .all(...bind);

    return {
      items: rows.map((row) => this.mapRow(row)),
      total,
      page,
      pageSize,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };
  }

  /** `sortBy` viene del cliente: SOLO se acepta si es una columna real. */
  protected orderByClause(sortBy?: string, direction?: SortDirection): string {
    const fallback = this.columns.has('created_at') ? 'created_at' : 'id';
    const column = sortBy !== undefined && this.columns.has(sortBy) ? sortBy : fallback;
    const dir = direction === 'asc' ? 'ASC' : 'DESC';
    return `ORDER BY ${column} ${dir}`;
  }

  protected insertRow(entity: T): void {
    const row = this.toRow(entity);
    const columns = Object.keys(row);
    const placeholders = columns.map(() => '?').join(', ');
    const bind = columns.map((column) => row[column] ?? null);

    this.run(
      `INSERT INTO ${this.table} (${columns.join(', ')}) VALUES (${placeholders})`,
      ...bind,
    );
  }

  private runUpdate(row: SqlRow, id: UUID): void {
    const columns = Object.keys(row);
    const assignments = columns.map((column) => `${column} = ?`).join(', ');
    const bind = columns.map((column) => row[column] ?? null);

    this.run(`UPDATE ${this.table} SET ${assignments} WHERE id = ?`, ...bind, id);
  }

  /** `run` con traduccion de errores de constraint a `DomainError`. */
  protected run(sql: string, ...params: SqliteValue[]): void {
    try {
      this.db.prepare<SqliteValue[], unknown>(sql).run(...params);
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  protected nowIso(): string {
    return new Date().toISOString();
  }

  protected newId(): UUID {
    return randomUUID();
  }

  protected json(value: unknown): string {
    return JSON.stringify(value ?? null);
  }

  protected bool(value: boolean): 0 | 1 {
    return value ? 1 : 0;
  }

  /** Aplica `updated_at` de un `UPDATE` parcial sin reconstruir la entidad. */
  protected touch(id: UUID, values: Readonly<Record<string, SqliteValue>>): void {
    const columns = Object.keys(values);
    const now = new Date().toISOString();
    const assignments = [...columns.map((column) => `${column} = ?`), 'updated_at = ?'].join(', ');
    const bind = [...columns.map((column) => values[column] ?? null), now, id];

    this.run(`UPDATE ${this.table} SET ${assignments} WHERE id = ?`, ...bind);
  }
}

/** Tablas persistidas conocidas por los repositorios. */
export type TableName =
  | 'users'
  | 'routers'
  | 'reseller_profiles'
  | 'voucher_batches'
  | 'vouchers'
  | 'transactions'
  | 'audit_log';
