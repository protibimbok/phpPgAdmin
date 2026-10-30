import { api } from '@/api/request'

export interface DesignerColumn {
  name: string
  type: string
  not_null: boolean
  pk: boolean
  /** pg_type.typcategory: N numeric, S string, D date/time… */
  category: string
}

export interface DesignerForeignKey {
  name: string
  columns: string[]
  ref_oid: number
  ref_columns: string[]
  on_delete: string
  on_update: string
}

export interface DesignerTable {
  oid: number
  schema: string
  name: string
  /** pg_class.relkind: r, p, v, m or f */
  kind: string
  comment: string | null
  columns: DesignerColumn[]
  foreign_keys: DesignerForeignKey[]
}

/** The canvas's pan (where its origin is on screen) and zoom. */
export interface View {
  x: number
  y: number
  zoom: number
}

/** Where a table sits, whether it is folded; the diagram's settings, and the view it was saved with. */
export interface Layout {
  /** Each table's place; "note" is pgAdmin ERD's note on the table, kept with the page. */
  tables: Record<string, { x: number; y: number; small: boolean; note?: string }>
  angular: boolean
  grid: boolean
  lines: boolean
  view?: View
}

export interface DesignerPage {
  id: number
  name: string
  layout: Layout
  updated_at: string
}

const base = (db: string) => `/api/databases/${encodeURIComponent(db)}/designer`

export const diagram = (db: string) => api.get<{ tables: DesignerTable[]; schemas: string[] }>(base(db))
export const listPages = (db: string) => api.get<{ pages: DesignerPage[] }>(`${base(db)}/pages`).then((r) => r.pages)
export const savePage = (db: string, name: string, layout: Layout) => api.post<{ page: DesignerPage }>(`${base(db)}/pages`, { name, layout }).then((r) => r.page)
export const deletePage = (db: string, id: number) => api.delete<{ ok: true }>(`${base(db)}/pages/${id}`)

export interface NewRelation {
  schema: string
  table: string
  column: string
  ref_schema: string
  ref_table: string
  ref_column: string
  on_delete: string
  on_update: string
}

export const relationSql = (db: string, relation: NewRelation) => api.post<{ sql: string }>(`${base(db)}/relations`, { ...relation, preview: true }).then((r) => r.sql)
export const createRelation = (db: string, relation: NewRelation) => api.post<{ sql: string }>(`${base(db)}/relations`, relation)
export const dropRelation = (db: string, relation: { schema: string; table: string; name: string }) => api.post<{ sql: string }>(`${base(db)}/relations/drop`, relation)
export const tablesSql = (db: string, tables: number[]) => api.post<{ sql: string }>(`${base(db)}/sql`, { tables }).then((r) => r.sql)
/** phpMyAdmin's Build Query: SELECT the tables, joined on their foreign keys. */
export const buildQuery = (db: string, tables: number[]) => api.post<{ sql: string }>(`${base(db)}/query`, { tables }).then((r) => r.sql)

/** pgAdmin ERD's many-to-many link: a table holding both tables' primary keys. */
export interface Junction {
  schema: string
  name: string
  left: { schema: string; table: string }
  right: { schema: string; table: string }
}
export const junctionSql = (db: string, junction: Junction) => api.post<{ sql: string }>(`${base(db)}/junction`, { ...junction, preview: true }).then((r) => r.sql)
export const createJunction = (db: string, junction: Junction) => api.post<{ sql: string }>(`${base(db)}/junction`, junction)
