import { api } from '@/api/request'

export interface DebugArgument {
  name: string
  type: string
  /** i IN, o OUT, b INOUT, v VARIADIC, t TABLE */
  mode: string
  default: string | null
}

export interface DebugTarget {
  oid: number
  schema: string
  name: string
  kind: 'function' | 'procedure'
  language: string
  signature: string
  arguments: DebugArgument[]
}

export interface ArgumentValue {
  value: string
  null: boolean
  expression: boolean
  use_default: boolean
}

export interface Frame {
  func: number
  line: number
  name: string
}

export interface DebugState {
  status: 'starting' | 'paused' | 'running' | 'finished'
  frame: Frame | null
  source?: string
  stack?: { level: number; name: string; func: number; line: number; args: string }[]
  /** class: A an argument, L a local variable, T a trigger variable */
  variables?: { name: string; class: string; type: string; value: string | null; const: boolean; not_null: boolean }[]
  breakpoints?: { func: number; line: number }[]
  messages: string[]
  result: { columns: string[]; rows: (string | null)[][]; truncated: boolean } | null
  error: string | null
}

const db = (name: string) => `/api/databases/${encodeURIComponent(name)}/debugger`

export const debuggerStatus = (database: string) => api.get<{ available: boolean; reason: string | null }>(`${db(database)}/status`)
export const debugTarget = (database: string, oid: number) => api.get<{ target: DebugTarget; reason: string | null }>(`${db(database)}/${oid}`)
export const startDebugging = (database: string, oid: number, args: ArgumentValue[]) => api.post<{ id: string; call: string; state: DebugState }>(`${db(database)}/${oid}/sessions`, { args })
export const debugCommand = (id: string, command: string, extra: Record<string, unknown> = {}) => api.post<DebugState>(`/api/debugger/sessions/${id}`, { command, ...extra })
export const stopDebugging = (id: string) => api.delete<{ ok: true }>(`/api/debugger/sessions/${id}`)
