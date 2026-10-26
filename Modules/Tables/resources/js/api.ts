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
