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
