import { api } from '@/api/request'
import { collection, collectionUrl, resolve, type TreeNode } from '@/nodes/client'
import type { Column } from '@tables/js/api'

/** The two kinds of view, by the segment their URLs and node collections use. */
export type ViewKind = 'view' | 'mview'

export const COLLECTIONS: Record<ViewKind, string> = { view: 'views', mview: 'mviews' }

/** A privilege entry as the node API hands it over. */
export interface Privilege {
  grantor: string | null
  grantee: string
  privileges: { privilege_type: string; privilege: true; with_grant: boolean }[]
}

/** A view as pgAdmin's views/properties.sql describes it, with what the controller adds. */
export interface View {
  oid: number
  name: string
  schema: string
  owner: string
  comment: string | null
  definition: string
  size: number
  spcname: string
  /** 'local', 'cascaded' or null. */
  check_option: string | null
  security_barrier: boolean | null
  security_invoker: boolean | null
  system_view: boolean
  seclabels: { provider: string; label: string }[]
  datacl: Privilege[]
}

/** A materialized view as mviews/properties.sql describes it, with the storage settings. */
export interface MaterializedView {
  oid: number
  name: string
  schema: string
  owner: string
  comment: string | null
  definition: string
  size: number
  spcname: string
  with_data: boolean
  amname: string | null
  fillfactor: string | null
  toast_tuple_target: string | null
  /** 'x' not set, 't' or 'f'. */
  autovacuum_enabled: 'x' | 't' | 'f'
  autovacuum_custom: boolean
  toast_autovacuum_enabled: 'x' | 't' | 'f'
  toast_autovacuum: boolean
  hastoasttable: boolean
  system_view: boolean
  seclabels: { provider: string; label: string }[]
  datacl: Privilege[]
  dependsonextensions: string[]
}

export type AnyView = View | MaterializedView

export function views(db: string, scid: number) {
  return collection<View>(collectionUrl(db, 'schemas', scid, 'views'))
}

export function materializedViews(db: string, scid: number) {
  return collection<MaterializedView>(collectionUrl(db, 'schemas', scid, 'mviews'))
}

/** The collection of either kind, typed loosely. */
export function viewsOf(db: string, scid: number, kind: ViewKind) {
  return collection<AnyView>(collectionUrl(db, 'schemas', scid, COLLECTIONS[kind]))
}

/** The view's OIDs: resolve by schema and name → { scid, vid }. */
export function resolveView(db: string, schema: string, name: string, kind: ViewKind): Promise<{ scid: number; vid: number }> {
  return resolve(db, kind, { schema, name }).then((ids) => ({ scid: ids.scid, vid: ids.vid }))
}

/** The schema's OID, which the view collections are addressed by. */
export function resolveSchema(db: string, schema: string): Promise<number> {
  return resolve(db, 'schema', { name: schema }).then((ids) => ids.scid)
}

/** The columns of a view, as the column node describes a table's. */
export function viewColumns(db: string, scid: number, vid: number, kind: ViewKind): Promise<Column[]> {
  return api.get<{ rows: Column[] }>(`${collectionUrl(db, 'schemas', scid, COLLECTIONS[kind])}/${vid}/columns`).then((r) => r.rows)
}

/** What the create and alter forms offer (GET …/views/options). */
export interface ViewOptions {
  roles: string[]
  schemas: string[]
  tablespaces: string[]
  access_methods: string[]
}

export function viewOptions(db: string, scid: number): Promise<ViewOptions> {
  return api.get<ViewOptions>(`${collectionUrl(db, 'schemas', scid, 'views')}/options`)
}

/**
 * What CREATE VIEW and ALTER VIEW take, by pgAdmin's field names (views/create.sql, update.sql);
 * an update carries only the fields that change. column_names is phpMyAdmin's comma-separated
 * column list; or_replace adds OR REPLACE to a CREATE.
 */
export interface ViewData {
  name?: string
  schema?: string
  definition?: string
  column_names?: string
  owner?: string
  comment?: string
  /** 'no', 'local' or 'cascaded'. */
  check_option?: string
  security_barrier?: boolean
  security_invoker?: boolean
  or_replace?: boolean
}

/** What CREATE MATERIALIZED VIEW and its ALTERs take (mviews/create.sql, update.sql). */
export interface MaterializedViewData {
  name?: string
  schema?: string
  definition?: string
  column_names?: string
  owner?: string
  comment?: string
  spcname?: string
  with_data?: boolean
  amname?: string
  /** An empty string resets it. */
  fillfactor?: string
  toast_tuple_target?: string
  autovacuum_enabled?: 'x' | 't' | 'f'
  toast_autovacuum_enabled?: 'x' | 't' | 'f'
}

export type AnyViewData = ViewData | MaterializedViewData

export function createView(db: string, scid: number, kind: ViewKind, data: AnyViewData): Promise<TreeNode> {
  return viewsOf(db, scid, kind).create(data)
}

export function updateView(db: string, scid: number, vid: number, kind: ViewKind, data: AnyViewData): Promise<TreeNode> {
  return viewsOf(db, scid, kind).update(vid, data)
}

export function dropView(db: string, scid: number, vid: number, kind: ViewKind, cascade = false): Promise<void> {
  return viewsOf(db, scid, kind).remove(vid, cascade).then(() => undefined)
}

export function viewModifiedSql(db: string, scid: number, kind: ViewKind, data: AnyViewData, vid?: number): Promise<string> {
  return viewsOf(db, scid, kind).modifiedSql(data, vid)
}

/** REFRESH MATERIALIZED VIEW; the statement run comes back. */
export function refreshMaterializedView(db: string, scid: number, vid: number, options: { concurrent?: boolean; with_data?: boolean } = {}): Promise<string> {
  return api.post<{ sql: string }>(`${collectionUrl(db, 'schemas', scid, 'mviews')}/${vid}/refresh`, options).then((r) => r.sql)
}
