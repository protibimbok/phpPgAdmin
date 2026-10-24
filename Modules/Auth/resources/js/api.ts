export interface User {
  username: string
  /** The PostgreSQL server the session is connected to. */
  server: {
    id: number | null
    name: string | null
    host: string
    port: number
    version: string | null
  }
}

/** A server as the login page offers it: the saved ones carry an id, the default none. */
export interface Server {
  id: number | null
  name: string | null
  host: string
  port: number
  sslmode: SslMode
  maintenance_db: string | null
}

export type SslMode = 'disable' | 'allow' | 'prefer' | 'require' | 'verify-ca' | 'verify-full'

export const SSL_MODES: readonly SslMode[] = ['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full']

export interface SavedServer extends Server {
  id: number
  last_username: string | null
}

/** What the login form sends about the server: a saved one by id, or one described in full. */
export type ServerChoice = { id: number } | Pick<Server, 'host' | 'port' | 'sslmode' | 'maintenance_db'>

/** The error body the API's JSON strategy sends: an HTTP exception, or a PostgreSQL error with its fields. */
interface ApiError {
  status_code?: number
  reason_phrase?: string
  message?: string
  sqlstate?: string
  detail?: string
  hint?: string
  position?: number
}

export async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiError
    throw new Error(body.message || body.reason_phrase || response.statusText || `Request failed (${response.status})`)
  }

  return (await response.json()) as T
}

/** The saved servers, most recently used first, and the configured default. */
export function getServers(): Promise<{ servers: SavedServer[]; default: Server }> {
  return request<{ servers: SavedServer[]; default: Server }>('/api/auth/servers')
}

/**
 * The user, and the locale the session runs in now: the role's saved one when it has one.
 * Without a server the login goes to the configured default.
 */
export function login(username: string, password: string, server?: ServerChoice): Promise<{ user: User; locale: string }> {
  return request<{ user: User; locale: string }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password, server }),
  })
}

export type Preferences = Record<string, unknown>

export function getPreferences(): Promise<Preferences> {
  return request<{ preferences: Preferences }>('/api/preferences').then(({ preferences }) => preferences)
}

/** Merge the given keys into the role's preferences; a null value removes its key. */
export function updatePreferences(changes: Preferences): Promise<Preferences> {
  return request<{ preferences: Preferences }>('/api/preferences', {
    method: 'PATCH',
    body: JSON.stringify(changes),
  }).then(({ preferences }) => preferences)
}

/** The signed-in user, or null when the session has none. */
export function me(): Promise<User | null> {
  return request<{ user: User }>('/api/auth/me')
    .then(({ user }) => user)
    .catch(() => null)
}

export function logout(): Promise<void> {
  return request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }).then(() => undefined)
}
