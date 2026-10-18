/**
 * Repositorios (capa de acceso a datos). Son la UNICA capa que escribe SQL.
 * Los servicios consumen estos objetos; la UI nunca los importa.
 *
 * Todos aceptan un `Db` opcional en el constructor (inyeccion de dependencias):
 * sin argumento usan el singleton `getDb()`; en tests, `createTestDb()`.
 */
export {
  asBoolean,
  asInteger,
  asJson,
  asNullableString,
  asNumber,
  asString,
  BaseRepository,
  buildWhere,
  cond,
  NO_WHERE,
  type CreateInput,
  type Repository,
  type SqliteValue,
  type SqlRow,
  type TableName,
  type UpdateInput,
  type WhereClause,
  type WhereCondition,
} from './base.repository';
export { AuditRepository, auditRepository } from './audit.repository';
export { ResellerProfileRepository, resellerProfileRepository } from './profile.repository';
export { RouterRepository, routerRepository } from './router.repository';
export { UserRepository, userRepository } from './user.repository';
export { VoucherRepository, voucherRepository } from './voucher.repository';
