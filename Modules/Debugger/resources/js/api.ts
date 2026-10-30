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
  /** A trigger function: debugged only in-context, when a trigger fires it. */
  trigger: boolean
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
  /** waiting: in-context, until another session calls the routine */
  status: 'starting' | 'waiting' | 'paused' | 'running' | 'finished'
  mode?: 'direct' | 'indirect'
  /** In-context: the backend that reached the global breakpoint. */
  target_pid?: number | null
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

export const debuggerStatus = (database: string) => api.get<{ available: boolean; reason: string | null; superuser: boolean }>(`${db(database)}/status`)
export const debugTarget = (database: string, oid: number) => api.get<{ target: DebugTarget; reason: string | null; superuser: boolean }>(`${db(database)}/${oid}`)
/** mode indirect: pgAdmin's "Set breakpoint", a global breakpoint the next call of any session stops at. */
export const startDebugging = (database: string, oid: number, args: ArgumentValue[], mode: 'direct' | 'indirect' = 'direct') =>
  api.post<{ id: string; call: string | null; state: DebugState }>(`${db(database)}/${oid}/sessions`, { args, mode })
export const debugCommand = (id: string, command: string, extra: Record<string, unknown> = {}) => api.post<DebugState>(`/api/debugger/sessions/${id}`, { command, ...extra })
export const stopDebugging = (id: string) => api.delete<{ ok: true }>(`/api/debugger/sessions/${id}`)
export const debugHeartbeat = (id: string) => api.post<{ ok: true }>(`/api/debugger/sessions/${id}/heartbeat`)

/** Stops a session while the page goes away (its tab closed, a reload): a beacon outlives the page, a fetch may not. */
export function stopDebuggingOnLeave(id: string): void {
  const url = `/api/debugger/sessions/${id}/stop`
  if (!navigator.sendBeacon?.(url)) {
    void fetch(url, { method: 'POST', credentials: 'same-origin', keepalive: true }).catch(() => undefined)
  }
}
