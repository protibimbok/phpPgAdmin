import type { StatRows } from './StatTable'
import { api } from '@/api/request'

/** What phpMyAdmin's Status » Server page reports, from pg_stat_database and pg_stat_activity. */
export interface ServerStatus {
  server: {
    version: string
    /** Seconds since the epoch. */
    start_time: number
    /** Seconds since the postmaster started. */
    uptime: number
    in_recovery: boolean
    max_connections: number
    reserved_connections: number
    /** When the oldest database's counters were last reset, in seconds since the epoch; null when never. */
    stats_reset: number | null
    /** Seconds the counters have been counting for. */
    stats_age: number
  }
  totals: Record<'xact_commit' | 'xact_rollback' | 'tup_returned' | 'tup_fetched' | 'tup_inserted' | 'tup_updated' | 'tup_deleted' | 'blks_read' | 'blks_hit' | 'temp_files' | 'temp_bytes' | 'deadlocks' | 'conflicts', number>
  /** Client sessions by state, and "background" for the other backends. */
  sessions: Record<string, number>
}

export function serverStatus(): Promise<ServerStatus> {
  return api.get<ServerStatus>('/api/server/status')
}

/** pgAdmin's dashboard charts; every one but session_stats plots cumulative counters. */
export type ChartName = 'session_stats' | 'tps_stats' | 'ti_stats' | 'to_stats' | 'bio_stats'

export interface ChartSample {
  /** The server's clock, in seconds since the epoch. */
  time: number
  charts: Partial<Record<ChartName, Record<string, number>>>
}

export function chartSample(names: ChartName[], database?: string): Promise<ChartSample> {
  const query = new URLSearchParams({ names: names.join(',') })
  if (database) query.set('database', database)

  return api.get<ChartSample>(`/api/server/status/charts?${query}`)
}

/** A backend as pgAdmin's activity.sql lists it. */
export interface Session {
  pid: number
  datname: string | null
  usename: string | null
  application_name: string
  client_addr: string | null
  backend_start: string | null
  state: string | null
  wait_event: string | null
  /** The PIDs it waits for, comma-separated. */
  blocking_pids: string
  query: string
  state_change: string | null
  query_start: string | null
  xact_start: string | null
  backend_type: string
  /** Minutes the current statement has been running, 0 unless active. */
  active_since: number
}

export function activity(filter: { database?: string; active?: boolean }): Promise<{ sessions: Session[]; own_pid: number }> {
  const query = new URLSearchParams()
  if (filter.database) query.set('database', filter.database)
  if (filter.active) query.set('active', '1')

  return api.get<{ sessions: Session[]; own_pid: number }>(`/api/server/status/activity?${query}`)
}

/** pg_cancel_backend or pg_terminate_backend; ok is false when the backend was not signalled. */
export function signalSession(pid: number, action: 'cancel' | 'terminate'): Promise<{ ok: boolean; sql: string }> {
  return api.post<{ ok: boolean; sql: string }>(`/api/server/status/activity/${pid}/${action}`, {})
}

/** phpMyAdmin's refresh rates, in seconds. */
export const REFRESH_RATES = [2, 3, 4, 5, 10, 20, 40, 60, 120, 300, 600, 1200]

/** A lock in pg_locks, as pgAdmin's locks.sql lists it. */
export interface Lock {
  pid: number | null
  locktype: string
  datname: string | null
  /** The relation's name, or its OID when it is in another database than the one asked about. */
  relation: string | null
  page: number | null
  tuple: number | null
  virtualxid: string | null
  transactionid: string | null
  classid: string | null
  objid: number | null
  objsubid: number | null
  virtualtransaction: string | null
  mode: string
  granted: boolean
  fastpath: boolean
}

export function locks(filter: { database?: string; waiting?: boolean }): Promise<{ locks: Lock[] }> {
  const query = new URLSearchParams()
  if (filter.database) query.set('database', filter.database)
  if (filter.waiting) query.set('waiting', '1')

  return api.get<{ locks: Lock[] }>(`/api/server/status/locks?${query}`)
}

/** A transaction prepared for two-phase commit, from pg_prepared_xacts. */
export interface PreparedTransaction {
  gid: string
  database: string
  owner: string
  transaction: string
  prepared: string
}

export function prepared(database?: string): Promise<{ transactions: PreparedTransaction[]; max_prepared_transactions: number }> {
  const query = new URLSearchParams()
  if (database) query.set('database', database)

  return api.get<{ transactions: PreparedTransaction[]; max_prepared_transactions: number }>(`/api/server/status/prepared?${query}`)
}

/** COMMIT PREPARED or ROLLBACK PREPARED, run in the transaction's database. */
export function finishPrepared(transaction: PreparedTransaction, action: 'commit' | 'rollback'): Promise<{ sql: string }> {
  return api.post<{ sql: string }>(`/api/server/status/prepared/${action}`, { gid: transaction.gid, database: transaction.database })
}

/** A run-time parameter from pg_settings. */
export interface Variable {
  name: string
  /** As SHOW prints it, with its unit: "128MB". */
  value: string
  setting: string
  unit: string | null
  category: string
  short_desc: string
  extra_desc: string | null
  /** When it can be changed: internal, postmaster, sighup, superuser-backend, backend, superuser, user. */
  context: string
  vartype: 'bool' | 'enum' | 'integer' | 'real' | 'string'
  source: string
  min_val: string | null
  max_val: string | null
  enumvals: string[] | null
  boot_val: string | null
  reset_val: string | null
  /** Changed in the configuration files, but in effect only after a restart. */
  pending_restart: boolean
  /** The value it will have after the restart, when this role may read the files. */
  pending: string | null
  /** This role may ALTER SYSTEM it. */
  editable: boolean
}

export function variables(): Promise<{ variables: Variable[]; superuser: boolean }> {
  return api.get<{ variables: Variable[]; superuser: boolean }>('/api/server/variables')
}

export function variable(name: string): Promise<{ variable: Variable }> {
  return api.get<{ variable: Variable }>(`/api/server/variables/${encodeURIComponent(name)}`)
}

/** ALTER SYSTEM SET (or RESET), then pg_reload_conf(). */
export function setVariable(name: string, change: { value: string } | { reset: true }): Promise<{ sql: string; variable: Variable; restart: boolean }> {
  return api.put<{ sql: string; variable: Variable; restart: boolean }>(`/api/server/variables/${encodeURIComponent(name)}`, change)
}

/** A file of the server's log directory; its format follows from the extension. */
export interface LogFile {
  name: string
  size: number
  /** Seconds since the epoch. */
  modification: number
  format: 'stderr' | 'csvlog' | 'jsonlog'
  /** The server is writing to it. */
  current: boolean
}

export interface LogFiles {
  /** logging_collector: without it nothing is written to the log directory. */
  collector: boolean
  destination: string
  directory: string
  /** Newest first. */
  files: LogFile[]
}

export function logFiles(): Promise<LogFiles> {
  return api.get<LogFiles>('/api/server/logs')
}

/** An entry of a log file; the stderr format has only time (its whole log_line_prefix), severity and message. */
export interface LogEntry {
  time: string | null
  severity: string | null
  message: string | null
  detail: string | null
  hint: string | null
  context: string | null
  statement: string | null
  sqlstate: string | null
  pid: number | null
  user: string | null
  database: string | null
  application: string | null
  backend_type: string | null
}

/** The page starting at offset, or the one ending at before (the file's size for the last page). */
export type LogPosition = { offset: number } | { before: number }

/** A page of a log file: the bytes from start to end, as entries or, with plain, as text. */
export interface LogPage {
  name: string
  format: LogFile['format']
  size: number
  start: number
  end: number
  entries?: LogEntry[]
  text?: string
}

export function logPage(name: string, position: LogPosition, plain: boolean): Promise<LogPage> {
  const query = new URLSearchParams('offset' in position ? { offset: String(position.offset) } : { before: String(position.before) })
  if (plain) query.set('plain', '1')

  return api.get<LogPage>(`/api/server/logs/${encodeURIComponent(name)}?${query}`)
}

/** The whole file, as an attachment. */
export const logDownloadUrl = (name: string) => `/api/server/logs/${encodeURIComponent(name)}/download`

/** A statement of pg_stat_statements; times in milliseconds. */
export interface Statement {
  queryid: string | null
  datname: string | null
  rolname: string | null
  query: string
  calls: number
  total_exec_time: number
  mean_exec_time: number
  rows: number
  shared_blks_hit: number
  shared_blks_read: number
}

export type StatementSort = 'calls' | 'total_exec_time' | 'mean_exec_time' | 'rows' | 'shared_blks_hit' | 'shared_blks_read'

/** Query statistics: pg_stat_statements in a database, or why there are none. */
export interface QueryStatistics {
  /** The database read, the maintenance one when none was asked for. */
  database: string
  /** No database was asked for: the statements of every database. */
  all: boolean
  installed: boolean
  /** The extension's files are on the server (pg_available_extensions). */
  available: boolean
  /** pg_stat_statements is in shared_preload_libraries. */
  loaded: boolean
  version: string | null
  /** The schema the extension is installed in. */
  schema: string | null
  sort: StatementSort
  order: 'asc' | 'desc'
  /** The server's refusal to read the view. */
  error?: string
  limit?: number
  totals?: { statements: number; calls: number; total_exec_time: number; rows: number; stats_reset: number | null; start_time: number; now: number }
  statements?: Statement[]
}

export function queryStatistics(filter: { database?: string; sort: StatementSort; order: 'asc' | 'desc' }): Promise<QueryStatistics> {
  const query = new URLSearchParams({ sort: filter.sort, order: filter.order })
  if (filter.database) query.set('database', filter.database)

  return api.get<QueryStatistics>(`/api/server/status/queries?${query}`)
}

/** pg_stat_statements_reset() in the database the extension is in. */
export function resetQueryStatistics(database?: string): Promise<{ sql: string }> {
  return api.post<{ sql: string }>('/api/server/status/queries/reset', { database: database ?? '' })
}

/** A cumulative counter, as text: a number, a timestamp or null. */
export interface Counter {
  name: string
  value: string | null
  numeric: boolean
}

export interface CounterGroup {
  id: 'database' | 'bgwriter' | 'checkpointer' | 'wal'
  view: string
  rows: Counter[]
}

/** pg_stat_io (PostgreSQL 16 and later; null before) and what pg_stat_reset_shared() may reset. */
export interface IoStatistics {
  io: StatRows | null
  resettable: string[]
}

export function ioStatistics(): Promise<IoStatistics> {
  return api.get<IoStatistics>('/api/server/status/io')
}

/** pg_stat_reset_shared(target); the statement run comes back. */
export function resetSharedStatistics(target: string): Promise<string> {
  return api.post<{ sql: string }>('/api/server/status/counters/reset', { target }).then((r) => r.sql)
}

/** The pg_stat_progress_* views with rows: the VACUUM, ANALYZE, CREATE INDEX, CLUSTER, COPY and base backups running now. */
export function progress(): Promise<{ views: StatRows[] }> {
  return api.get<{ views: StatRows[] }>('/api/server/status/progress')
}

export function counters(database?: string): Promise<{ groups: CounterGroup[] }> {
  const query = new URLSearchParams()
  if (database) query.set('database', database)

  return api.get<{ groups: CounterGroup[] }>(`/api/server/status/counters?${query}`)
}
