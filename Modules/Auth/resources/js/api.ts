import { request } from '@/api/request'

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

/** "Name (host:port)", or "host:port" for a server without a name. */
export function serverLabel(server: Server): string {
  return server.name ? `${server.name} (${server.host}:${server.port})` : `${server.host}:${server.port}`
}

/** What the login form sends about the server: a saved one by id, or one described in full. */
export type ServerChoice = { id: number } | Pick<Server, 'host' | 'port' | 'sslmode' | 'maintenance_db'>

export { ApiError, request } from '@/api/request'

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

/** The signed-in role and the server's password_encryption, for the "Change password" form. */
export function getAccount(): Promise<{ username: string; password_encryption: string }> {
  return request('/api/account')
}

/** ALTER ROLE CURRENT_USER PASSWORD: a new password hashed by the method, or null for none. */
export function changePassword(password: string | null, hashing: string): Promise<{ ok: true }> {
  return request('/api/account/password', { method: 'POST', body: JSON.stringify({ password, hashing }) })
}

/** Give a saved server a name; an empty one takes the name away. Needs a signed-in user. */
export function renameServer(id: number, name: string): Promise<void> {
  return request<{ ok: true }>(`/api/auth/servers/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }).then(() => undefined)
}

/** pgAdmin's connection options of a saved server: the server's, and the signed-in role's own role and post-connection SQL. */
export interface ServerOptions {
  service?: string
  application_name?: string
  sslcert?: string
  sslkey?: string
  sslrootcert?: string
  sslcrl?: string
  role?: string
  post_connection_sql?: string
}

/** A saved server's options, and the files of the server's SSL directory (null when none is configured). */
export function getServerOptions(id: number): Promise<{ options: ServerOptions; ssl_files: string[] | null }> {
  return request(`/api/auth/servers/${id}/options`)
}

export function setServerOptions(id: number, options: ServerOptions): Promise<void> {
  return request<{ ok: true }>(`/api/auth/servers/${id}/options`, { method: 'PUT', body: JSON.stringify(options) }).then(() => undefined)
}

/** Forget a saved server. Needs a signed-in user. */
export function removeServer(id: number): Promise<void> {
  return request<{ ok: true }>(`/api/auth/servers/${id}`, { method: 'DELETE' }).then(() => undefined)
}

/** pgAdmin's import_export_servers JSON: {"Servers": {"1": {"Name", "Group", "Host", "Port", "MaintenanceDB", "Username", "SSLMode"}}}. */
export interface ServerList {
  Servers: Record<string, Record<string, unknown>>
}

export function exportServers(): Promise<ServerList> {
  return request<ServerList>('/api/auth/servers/export')
}

/** Add the servers of a list, or update the ones saved at the same host and port. */
export function importServers(list: unknown): Promise<{ added: number; updated: number }> {
  return request<{ added: number; updated: number }>('/api/auth/servers/import', { method: 'POST', body: JSON.stringify(list) })
}

/** A table in the navigation panel's Recent or Favorites list. */
export interface QuickWarpTable {
  database: string
  schema: string
  table: string
  kind: 'table' | 'view' | 'mview'
}

/** The Recent and Favorites lists, newest first. */
export interface QuickWarpLists {
  recent: QuickWarpTable[]
  favorite: QuickWarpTable[]
}

type TableName = Pick<QuickWarpTable, 'database' | 'schema' | 'table'>

export function getQuickWarpLists(): Promise<QuickWarpLists> {
  return request<QuickWarpLists>('/api/navigation/tables')
}

/** Record a table as opened: first in Recent, the list cut to its length. */
export function recordRecentTable(table: TableName): Promise<QuickWarpLists> {
  return request<QuickWarpLists>('/api/navigation/tables/recent', { method: 'POST', body: JSON.stringify(table) })
}

export function addFavoriteTable(table: TableName): Promise<QuickWarpLists> {
  return request<QuickWarpLists>('/api/navigation/tables/favorite', { method: 'POST', body: JSON.stringify(table) })
}

export function removeFavoriteTable(table: TableName): Promise<QuickWarpLists> {
  return request<QuickWarpLists>(`/api/navigation/tables/favorite?${new URLSearchParams(table)}`, { method: 'DELETE' })
}
