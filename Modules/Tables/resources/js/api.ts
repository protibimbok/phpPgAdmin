import { api } from '@/api/request'
import { collection, collectionUrl, resolve } from '@/nodes/client'

/** A table as pgAdmin's properties.sql describes it (the columns the pages read), plus the size. */
export interface Table {
  oid: number
  name: string
  schema: string
  relowner: string
  relkind: string
  is_partitioned: boolean
  relhassubclass: boolean
  /** The planner's estimate (pg_class.reltuples); -1 when the table was never analysed. */
  reltuples: number
  description: string | null
  triggercount: number
  spcname: string | null
  is_sys_table: boolean
  size: number
}

/** A view or materialized view, as their properties.sql describe them. */
export interface View {
  oid: number
  name: string
  schema: string
  owner: string
  comment: string | null
  definition: string
  size: number
}

export function tables(db: string, scid: number) {
  return collection<Table>(collectionUrl(db, 'schemas', scid, 'tables'))
}

export function views(db: string, scid: number) {
  return collection<View>(collectionUrl(db, 'schemas', scid, 'views'))
}

export function materializedViews(db: string, scid: number) {
  return collection<View>(collectionUrl(db, 'schemas', scid, 'mviews'))
}

/** The schema's OID, which the relation collections are addressed by. */
export function resolveSchema(db: string, schema: string): Promise<number> {
  return resolve(db, 'schema', { name: schema }).then((ids) => ids.scid)
}

/** The exact row count, counted now. */
export function countRows(db: string, scid: number, tid: number): Promise<number> {
  return api.get<{ count: number }>(`${collectionUrl(db, 'schemas', scid, 'tables')}/${tid}/count`).then((r) => r.count)
}

/** A column as pgAdmin's columns/properties.sql describes it (the fields the structure page reads). */
export interface Column {
  name: string
  attnum: number
  typname: string
  /** The type with its modifiers, "character varying(20)". */
  displaytypname: string
  cltype: string
  attnotnull: boolean
  defval: string | null
  description: string | null
  collspcname: string
  /** 'i' identity, 'g' generated, 'n' neither. */
  colconstype: 'i' | 'g' | 'n'
  attidentity: string
  genexpr: string | null
  is_fk: boolean
  is_sys_column: boolean
  inheritedfrom: string | null
  attstorage: string
  attcompression: string | null
  /** The primary key's column numbers, as "1 2", when the table has one. */
  indkey: string | null
}

export interface Index {
  oid: number
  name: string
  amname: string
  indisunique: boolean
  indisprimary: boolean
  indisclustered: boolean
  indisvalid: boolean
  indkey: string
  indnatts: number
  conname: string | null
  contype: string | null
  description: string | null
  indconstraint: string | null
  definition: string
  spcname: string
}

export interface Constraint {
  oid: number
  name: string
  comment: string | null
  definition: string
  condeferrable?: boolean
  condeferred?: boolean
  convalidated?: boolean
  consrc?: string
}

export type ConstraintType = 'primary_key' | 'unique_constraint' | 'foreign_key' | 'check_constraint' | 'exclusion_constraint'

export const CONSTRAINT_COLLECTIONS: Record<ConstraintType, string> = {
  primary_key: 'primary-keys',
  unique_constraint: 'unique-constraints',
  foreign_key: 'foreign-keys',
  check_constraint: 'check-constraints',
  exclusion_constraint: 'exclusion-constraints',
}

export function columns(db: string, scid: number, tid: number) {
  return collection<Column>(collectionUrl(db, 'schemas', scid, 'tables', tid, 'columns'))
}

export function indexes(db: string, scid: number, tid: number) {
  return collection<Index>(collectionUrl(db, 'schemas', scid, 'tables', tid, 'indexes'))
}

export function constraints(db: string, scid: number, tid: number, type: ConstraintType) {
  return collection<Constraint>(collectionUrl(db, 'schemas', scid, 'tables', tid, CONSTRAINT_COLLECTIONS[type]))
}

/** The table's OIDs: resolve by schema and name → { scid, tid }. */
export function resolveTable(db: string, schema: string, name: string): Promise<{ scid: number; tid: number }> {
  return resolve(db, 'table', { schema, name }).then((ids) => ({ scid: ids.scid, tid: ids.tid }))
}
