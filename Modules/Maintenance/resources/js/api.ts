import { api } from '@/api/request'
import type { BackgroundProcess } from '@import/js/api'

export type MaintenanceOperation = 'VACUUM' | 'ANALYZE' | 'REINDEX' | 'CLUSTER'

/** Where maintenance runs: a database, or a schema of it. */
export interface MaintenanceTarget {
  database: string
  schema?: string
}

export interface MaintenanceOptions {
  /** server_version_num, which the options shown depend on */
  version: number
  tablespaces: string[]
  tools: { directory: string; psql: boolean } | null
}

/** pgAdmin's maintenance options; those that do not apply to the operation are ignored. */
export interface MaintenanceSettings {
  verbose: boolean
  full: boolean
  freeze: boolean
  analyze: boolean
  disable_page_skipping: boolean
  skip_locked: boolean
  truncate: boolean
  process_toast: boolean
  process_main: boolean
  skip_database_stats: boolean
  only_database_stats: boolean
  index_cleanup: 'auto' | 'on' | 'off'
  parallel: string
  buffer_usage_limit: string
  system: boolean
  concurrently: boolean
  tablespace: string
}

const query = (target: MaintenanceTarget) => new URLSearchParams({ database: target.database, schema: target.schema ?? '' }).toString()

export function maintenanceOptions(target: MaintenanceTarget): Promise<MaintenanceOptions> {
  return api.get<MaintenanceOptions>(`/api/maintenance/options?${query(target)}`)
}

export function runMaintenance(target: MaintenanceTarget, operation: MaintenanceOperation, options: Partial<MaintenanceSettings>): Promise<BackgroundProcess> {
  return api.post<{ process: BackgroundProcess }>('/api/maintenance', { ...target, operation, options }).then((r) => r.process)
}

export function maintenanceSql(target: MaintenanceTarget, operation: MaintenanceOperation, options: Partial<MaintenanceSettings>): Promise<string> {
  return api.post<{ sql: string }>('/api/maintenance', { ...target, operation, options, preview: true }).then((r) => r.sql)
}
