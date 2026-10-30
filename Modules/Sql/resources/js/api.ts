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
  /** The type with its modifiers, "timestamp(3) without time zone", when the column is a table's own. */
  type: string | null
  /** The column's default expression, when it is a table's own column and has one. */
  default: string | null
  /** The labels of an enum type, in their declared order. */
  enum_values: string[] | null
  /** The column a foreign key on this column points at. */
  foreign_key: ForeignKey | null
  /** The column's comment, when it is a table's own column and has one. */
  comment?: string | null
}

/** The column a foreign key points at. */
export interface ForeignKey {
  schema: string
  table: string
  column: string
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
  /** Where the statement starts in the batch that was sent, in UTF-16 code units. */
  start: number
}

export type StatementResult = RowsResult | CommandResult | ErrorResult

export interface QueryResponse {
  results: StatementResult[]
  source: Source | null
  backend_pid: number
  rolled_back: boolean
  /** Where the connection stands after the run (libpq's transaction status). */
  transaction?: TransactionStatus
}

/** libpq's PQtransactionStatus: outside a transaction, inside one, inside a failed one. */
export type TransactionStatus = 'idle' | 'active' | 'intrans' | 'inerror' | 'unknown'

/** A query tool session: one connection the SQL page keeps between its runs. */
export interface QuerySession {
  id: string
  database: string
  transaction: TransactionStatus
  backend_pid: number
}

/** Start a query tool session on a database, or (null) on the one the login landed in. */
export function startQuerySession(db: string | null): Promise<QuerySession> {
  return api.post<QuerySession>('/api/query/sessions', db === null ? {} : { database: db })
}

/** Run a batch in a session; "autocommit" false leaves the transaction it opens open. */
export function runInSession(id: string, request: QueryRequest & { autocommit?: boolean }): Promise<QueryResponse> {
  return api.post<QueryResponse>(`/api/query/sessions/${encodeURIComponent(id)}/run`, request)
}

/** COMMIT or ROLLBACK the session's open transaction; the tag says which happened. */
export function endSessionTransaction(id: string, command: 'commit' | 'rollback'): Promise<{ command_tag: string; was: TransactionStatus; transaction: TransactionStatus }> {
  return api.post(`/api/query/sessions/${encodeURIComponent(id)}/${command}`)
}

/** The session's status; the request also keeps it alive. */
export function querySessionStatus(id: string): Promise<{ transaction: TransactionStatus; backend_pid: number }> {
  return api.get(`/api/query/sessions/${encodeURIComponent(id)}`)
}

/** End the session; "keepalive" lets the request outlive a closing page. */
export function stopQuerySession(id: string, keepalive = false): Promise<unknown> {
  return fetch(`/api/query/sessions/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin', keepalive }).catch(() => undefined)
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
  /** An identity column: the server numbers it, as it does a serial. */
  is_identity: boolean
  is_generated: boolean
  pk: boolean
  comment: string | null
  /** The column's collation, "default" or a named one; null for a type that has none. */
  collation: string | null
  /** The default expression as pg_get_expr prints it: "'ok'::mood", "now()", "nextval(...)". */
  default: string | null
  /** The labels of an enum type, in their declared order. */
  enum_values: string[] | null
  /** The column a foreign key on this column points at. */
  foreign_key: ForeignKey | null
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

/**
 * The functions the form may wrap a value in, as phpMyAdmin's Function column lists them (every
 * one, sorted); the server's RowEditor::FUNCTIONS maps each name to its SQL.
 */
export const ROW_FUNCTIONS = [
  'ABS',
  'ACOS',
  'ASCII',
  'ASIN',
  'ATAN',
  'BIT_LENGTH',
  'CEIL',
  'CHAR_LENGTH',
  'CLOCK_TIMESTAMP',
  'COS',
  'CURRENT_DATABASE',
  'CURRENT_DATE',
  'CURRENT_SCHEMA',
  'CURRENT_TIME',
  'CURRENT_TIMESTAMP',
  'CURRENT_USER',
  'DATE',
  'DEGREES',
  'EXP',
  'FLOOR',
  'GEN_RANDOM_UUID',
  'INITCAP',
  'LENGTH',
  'LN',
  'LOCALTIME',
  'LOCALTIMESTAMP',
  'LOG',
  'LOWER',
  'LTRIM',
  'MD5',
  'NOW',
  'OCTET_LENGTH',
  'PI',
  'QUOTE_LITERAL',
  'RADIANS',
  'RANDOM',
  'REVERSE',
  'ROUND',
  'RTRIM',
  'SESSION_USER',
  'SHA256',
  'SHA512',
  'SIGN',
  'SIN',
  'SQRT',
  'STATEMENT_TIMESTAMP',
  'TAN',
  'TIME',
  'TO_HEX',
  'TO_TIMESTAMP',
  'TRANSACTION_TIMESTAMP',
  'TRIM',
  'TRUNC',
  'UPPER',
  'VERSION',
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
  /** The largest file the server accepts into a bytea column. */
  max_upload_bytes: number
}

/** The values a foreign key column may take, for the dropdown in place of a text field. */
export interface ForeignValues {
  column: string
  /** The first text column of the referenced table, shown next to each key; null when it has none. */
  display_column: string | null
  values: { key: string | null; display: string | null }[]
  /** More values exist than the limit; the form then shows a text field instead. */
  truncated: boolean
}

/** phpMyAdmin's ForeignKeyMaxLimit: more values than this and the dropdown gives way to a text field. */
export const FOREIGN_KEY_MAX_LIMIT = 100

export function foreignValues(db: string, key: ForeignKey): Promise<ForeignValues> {
  const query = new URLSearchParams({ schema: key.schema, name: key.table, column: key.column, limit: String(FOREIGN_KEY_MAX_LIMIT) })

  return api.get(`/api/databases/${encode(db)}/query/foreign-values?${query}`)
}

export interface ForeignPageRequest {
  /** Keep the values whose key or description contains this. */
  search: string
  offset: number
  /** Rows per page; ignored when "all" is set. */
  limit: number
  all: boolean
}

/** One page of a foreign key's values for the "Browse foreign values" window, sorted by description, with the count of matches. */
export function browseForeignValues(db: string, key: ForeignKey, page: ForeignPageRequest): Promise<ForeignValues & { total: number }> {
  const query = new URLSearchParams({ schema: key.schema, name: key.table, column: key.column, limit: String(page.limit), offset: String(page.offset), order: 'display', total: '1' })
  if (page.search !== '') query.set('search', page.search)
  if (page.all) query.set('all', '1')

  return api.get(`/api/databases/${encode(db)}/query/foreign-values?${query}`)
}

/** What the Find and replace form asks for. */
export interface FindReplaceRequest {
  schema: string
  table: string
  column: string
  find: string
  replace_with: string
  use_regex: boolean
}

/** The values Find and replace would change, with their replacements and row counts, and the UPDATE it would run. */
export interface FindReplacePreview {
  rows: { original: string | null; replaced: string | null; count: number }[]
  sql: string
}

export function findReplacePreview(db: string, request: FindReplaceRequest): Promise<FindReplacePreview> {
  return api.post<FindReplacePreview>(`/api/databases/${encode(db)}/query/find-replace/preview`, request)
}

/** Run the replacement; the answer reads as a statement of the SQL page. */
export function findReplace(db: string, request: FindReplaceRequest): Promise<CommandResult> {
  return api.post<CommandResult>(`/api/databases/${encode(db)}/query/find-replace`, request)
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

/** A query macro (pgAdmin's user macro): a named statement, bound to a shortcut key or not. */
export interface Macro {
  id: number
  /** "Ctrl+1" … "Ctrl+0", "Alt+F1" … "Alt+F12", or null. */
  key: string | null
  name: string
  sql: string
}

export interface MacroInput {
  name: string
  sql: string
  key?: string | null
}

/** The role's macros on this server and the keys a macro may be bound to. */
export function listMacros(): Promise<{ macros: Macro[]; keys: string[] }> {
  return api.get<{ macros: Macro[]; keys: string[] }>('/api/query/macros')
}

export function createMacro(input: MacroInput): Promise<Macro> {
  return api.post<{ macro: Macro }>('/api/query/macros', input).then((r) => r.macro)
}

export function updateMacro(id: number, input: Partial<MacroInput>): Promise<Macro> {
  return api.put<{ macro: Macro }>(`/api/query/macros/${id}`, input).then((r) => r.macro)
}

export function deleteMacro(id: number): Promise<void> {
  return api.delete<{ ok: true }>(`/api/query/macros/${id}`).then(() => undefined)
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

/** The relations of a database by schema, with their column names, for the editor's completions. */
export interface Catalog {
  schemas: { name: string; relations: { name: string; columns: string[] }[] }[]
}

export function fetchCatalog(db: string): Promise<Catalog> {
  return api.get<Catalog>(`/api/databases/${encode(db)}/query/catalog`)
}
