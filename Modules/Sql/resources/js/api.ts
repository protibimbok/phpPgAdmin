import { api } from '@/api/request'

/** One column of a result set, as the query endpoint describes it. */
export interface ResultColumn {
  name: string
  type_oid: number
  type_name: string
  /** The table the column is read from; null for an expression. */
  table_oid: number | null
  /** The column's number in that table when it is the table's own column, selected under its own name. */
  attnum: number | null
  pk: boolean
  nullable: boolean
  has_default: boolean
  is_generated: boolean
  /** Whether a value in this column may be changed in place. */
  editable: boolean
}

/** The one table a row-returning statement reads from, when it reads from exactly one. */
export interface Source {
  oid: number
  schema: string
  table: string
  relkind: string
  primary_keys: string[]
  /** Whether rows may be edited: a table with a primary key whose columns are all selected. */
  editable: boolean
}

export interface QueryError {
  message: string
  sqlstate?: string
  detail?: string
  hint?: string
  /** 1-based character offset into the statement. */
  position?: number
}

interface StatementBase {
  sql: string
  /** 1-based line of the batch the statement starts on. */
  line: number
  duration_ms: number
  notices: string[]
}

export interface RowsResult extends StatementBase {
  kind: 'rows'
  columns: ResultColumn[]
  /** The server's text for each value; null for NULL. */
  rows: (string | null)[][]
  row_count: number
  /** Rows in all, when known. */
  total_rows: number | null
  offset: number
  /** The page size the rows were cut to; null when every row came. */
  limit: number | null
  has_more: boolean
  /** Whether the statement may be paged and ordered by the server. */
  pageable: boolean
  command_tag: string
}

export interface CommandResult extends StatementBase {
  kind: 'command'
  affected_rows: number
  command_tag: string
}

export interface ErrorResult extends StatementBase {
  kind: 'error'
  error: QueryError
}

export type StatementResult = RowsResult | CommandResult | ErrorResult

export interface QueryResponse {
  results: StatementResult[]
  source: Source | null
  backend_pid: number
  rolled_back: boolean
}

/** A column to order the rows by, applied by the server to a pageable statement. */
export interface Order {
  name: string
  desc?: boolean
}

export interface QueryRequest {
  sql: string
  delimiter?: string
  /** An id of the client's choosing, to cancel the request by. */
  request_id?: string
  /** Rows per page; null for every row. */
  limit?: number | null
  offset?: number
  /** Whether to count the rows in all when a page is cut (the default). */
  count?: boolean
  order?: Order[]
  /** Run the batch inside one transaction. */
  transaction?: boolean
  /** Run the batch inside a transaction that is rolled back at the end. */
  rollback?: boolean
  statement_timeout_ms?: number
}

const encode = encodeURIComponent

/** Run a batch against a database, or (null) against the database the session landed in. */
export function runQuery(db: string | null, request: QueryRequest): Promise<QueryResponse> {
  return api.post<QueryResponse>(db === null ? '/api/query' : `/api/databases/${encode(db)}/query`, request)
}

/** Ask the server to cancel the request with that id. */
export function cancelQuery(requestId: string): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>('/api/query/cancel', { request_id: requestId })
}

/** A column of a relation, for the column list and the insert form. */
export interface RelationColumn {
  name: string
  attnum: number
  /** The type with its modifiers, "character varying(255)". */
  type: string
  type_name: string
  nullable: boolean
  has_default: boolean
  is_generated: boolean
  pk: boolean
  comment: string | null
  /** The column's collation, "default" or a named one; null for a type that has none. */
  collation: string | null
}

export function relationColumns(db: string, schema: string, name: string): Promise<RelationInfo> {
  const query = new URLSearchParams({ schema, name })

  return api.get(`/api/databases/${encode(db)}/query/columns?${query}`)
}

/**
 * A value the row editor writes: text, NULL, the column's default, or one of the functions
 * phpMyAdmin's form offers (ROW_FUNCTIONS) around a text value.
 */
export type CellValue = string | null | { default: true } | { func: string; value?: string | null }

/** The functions the form may wrap a value in, as the server knows them; the ones ending in "()" take no value. */
export const ROW_FUNCTIONS = [
  'now()',
  'clock_timestamp()',
  'current_date',
  'current_time',
  'current_timestamp',
  'localtimestamp',
  'gen_random_uuid()',
  'random()',
  'upper',
  'lower',
  'initcap',
  'trim',
  'reverse',
  'length',
  'md5',
  'sha256',
  'abs',
  'round',
] as const

export type RowKeys = Record<string, string | null>

export interface RowChanges {
  added?: { values: Record<string, CellValue> }[]
  updated?: { keys: RowKeys; values: Record<string, CellValue> }[]
  deleted?: { keys: RowKeys }[]
  /** Add rows with ON CONFLICT DO NOTHING: phpMyAdmin's "Insert as new row and ignore errors". */
  ignore?: boolean
}

export interface SaveOutcome {
  ok: true
  added: Record<string, unknown>[]
  updated: Record<string, unknown>[]
  deleted: number
  sql: string[]
}

export function saveRows(db: string, schema: string, table: string, changes: RowChanges): Promise<SaveOutcome> {
  return api.post<SaveOutcome>(`/api/databases/${encode(db)}/query/save`, { schema, table, changes })
}

/** The statements saveRows() would run, for the preview modal. */
export function previewRows(db: string, schema: string, table: string, changes: RowChanges): Promise<string[]> {
  return api.post<{ sql: string[] }>(`/api/databases/${encode(db)}/query/save`, { schema, table, changes, preview: true }).then((r) => r.sql)
}

export interface RelationInfo {
  relkind: string
  primary_keys: string[]
  columns: RelationColumn[]
}

/** One row of a table by primary key, as text, with the table's columns: what the edit form starts from. */
export function fetchRow(db: string, schema: string, name: string, keys: RowKeys): Promise<RelationInfo & { row: Record<string, string | null> }> {
  const query = new URLSearchParams({ schema, name, keys: JSON.stringify(keys) })

  return api.get(`/api/databases/${encode(db)}/query/row?${query}`)
}

/** A saved query (phpMyAdmin's bookmark): the role's own, or shared with everyone on the server. */
export interface Bookmark {
  id: number
  database: string
  label: string
  sql: string
  shared: boolean
}

export function listBookmarks(database?: string): Promise<Bookmark[]> {
  const query = database ? `?${new URLSearchParams({ database })}` : ''

  return api.get<{ bookmarks: Bookmark[] }>(`/api/query/bookmarks${query}`).then((r) => r.bookmarks)
}

export function createBookmark(input: { database: string; label: string; sql: string; shared?: boolean; replace?: boolean }): Promise<Bookmark> {
  return api.post<{ bookmark: Bookmark }>('/api/query/bookmarks', input).then((r) => r.bookmark)
}

export function deleteBookmark(id: number): Promise<void> {
  return api.delete<{ ok: true }>(`/api/query/bookmarks/${id}`).then(() => undefined)
}

/** One statement the role ran, with its outcome. */
export interface HistoryEntry {
  id: number
  database: string
  sql: string
  status: 'success' | 'error'
  affected_rows: number | null
  duration_ms: number | null
  message: string | null
  started_at: string
}

export function listHistory(limit = 100, database?: string): Promise<HistoryEntry[]> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (database) params.set('database', database)

  return api.get<{ history: HistoryEntry[] }>(`/api/query/history?${params}`).then((r) => r.history)
}

export function clearHistory(): Promise<void> {
  return api.delete<{ ok: true }>('/api/query/history').then(() => undefined)
}

/** The relations of a database by schema, with their column names, for the editor's completions. */
export interface Catalog {
  schemas: { name: string; relations: { name: string; columns: string[] }[] }[]
}

export function fetchCatalog(db: string): Promise<Catalog> {
  return api.get<Catalog>(`/api/databases/${encode(db)}/query/catalog`)
}
