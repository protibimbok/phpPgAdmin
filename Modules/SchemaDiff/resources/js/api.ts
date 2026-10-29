import { api } from '@/api/request'

export interface Side {
  database: string
  schema: string
}

export interface DiffOptions {
  ignore_owner: boolean
  ignore_grants: boolean
  ignore_tablespace: boolean
  ignore_whitespace: boolean
}

export type DiffStatus = 'identical' | 'different' | 'source_only' | 'target_only'

export interface DiffResult {
  type: string
  /** The node type's label, "Tables". */
  label: string
  name: string
  status: DiffStatus
  source_oid: number | null
  target_oid: number | null
}

type Request = { source: Side; target: Side } & DiffOptions

export const diffOptions = (database = '') => api.get<{ databases: string[]; schemas: string[] | null }>(`/api/schema-diff/options?${new URLSearchParams({ database })}`)

export const compareSchemas = (request: Request) => api.post<{ results: DiffResult[] }>('/api/schema-diff/compare', request).then((r) => r.results)

export const objectDdl = (request: Request, item: Pick<DiffResult, 'type' | 'source_oid' | 'target_oid'>) => api.post<{ source_ddl: string; target_ddl: string; diff_ddl: string }>('/api/schema-diff/ddl', { ...request, ...item })

export const diffScript = (request: Request, items: Pick<DiffResult, 'type' | 'source_oid' | 'target_oid'>[]) => api.post<{ script: string }>('/api/schema-diff/script', { ...request, items }).then((r) => r.script)
