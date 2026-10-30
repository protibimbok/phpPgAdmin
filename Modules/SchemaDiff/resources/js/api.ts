import { api } from '@/api/request'

export interface Side {
  /** A saved server's id; null for the one the session is signed in to. */
  server: number | null
  database: string
  /** Empty to compare the whole database. */
  schema: string
}

export interface DiffServer {
  id: number | null
  name: string
  current: boolean
  connected: boolean
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
  /** The schema the object is in when whole databases are compared; null for a database-level object. */
  schema?: string | null
  status: DiffStatus
  source_oid: number | null
  target_oid: number | null
}

type Request = { source: Side; target: Side } & DiffOptions

export const diffOptions = (server: number | null = null, database = '') =>
  api.get<{ servers: DiffServer[]; databases: string[]; schemas: string[] | null; needs_login?: boolean }>(`/api/schema-diff/options?${new URLSearchParams({ server: server === null ? '' : String(server), database })}`)

export const connectServer = (server: number, username: string, password: string) => api.post<{ ok: true }>('/api/schema-diff/connect', { server, username, password })

export const compareSchemas = (request: Request) => api.post<{ results: DiffResult[] }>('/api/schema-diff/compare', request).then((r) => r.results)

export const objectDdl = (request: Request, item: Pick<DiffResult, 'schema' | 'type' | 'source_oid' | 'target_oid'>) => api.post<{ source_ddl: string; target_ddl: string; diff_ddl: string }>('/api/schema-diff/ddl', { ...request, ...item })

export const diffScript = (request: Request, items: Pick<DiffResult, 'schema' | 'type' | 'source_oid' | 'target_oid'>[]) => api.post<{ script: string }>('/api/schema-diff/script', { ...request, items }).then((r) => r.script)
