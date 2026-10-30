import { api, ApiError } from '@/api/request'
import { collection, collectionUrl, resolve, type TreeNode } from '@/nodes/client'

/**
 * A database as pgAdmin's properties.sql describes it (plus the size), for the list page.
 * Catalog columns keep pgAdmin's names so the forms and templates read the same.
 */
export interface Database {
  did: number
  oid: number
  name: string
  datowner: string
  encoding: string
  datcollate: string
  datctype: string
  spcname: string | null
  datconnlimit: number
  datallowconn: boolean
  is_template: boolean
  comments: string | null
  /** Bytes, or null when the role may not connect to the database and so cannot measure it. */
  size: number | null
  /** Below pgAdmin's last system OID: a system database. */
  is_sys_obj: boolean
  /** False for the database the session is connected to. */
  can_drop: boolean
}

/** What the tree node of a database carries besides its name. */
export interface DatabaseMeta {
  did: number
  spcname: string | null
  datallowconn: boolean
  is_template: boolean
  cancreate: boolean
  owner: number
  description: string | null
  is_sys_obj: boolean
}

/** The database collection: server-level, so no database in the URL. */
export const databases = collection<Database, DatabaseMeta>(collectionUrl(null, 'databases'))

export function listDatabases(): Promise<Database[]> {
  return databases.list()
}

export function databaseNodes(): Promise<TreeNode<DatabaseMeta>[]> {
  return databases.nodes()
}

/** The privileges on a database as the properties carry them. */
export interface DatabaseAcl {
  grantor: string | null
  grantee: string
  privileges: { privilege_type: string; privilege: boolean; with_grant: boolean }[]
}

/** The properties pgAdmin's database dialog reads, on top of the list's columns. */
export interface DatabaseProperties extends Omit<Database, 'can_drop'> {
  datacl: DatabaseAcl[]
  deftblacl: DatabaseAcl[]
  defseqacl: DatabaseAcl[]
  deffuncacl: DatabaseAcl[]
  deftypeacl: DatabaseAcl[]
  variables: { name: string; value: unknown; role?: string | null; database?: string | null }[]
  seclabels: { provider: string; label: string }[]
}

export function resolveDatabase(name: string): Promise<number> {
  return resolve(null, 'database', { name }).then((ids) => ids.did)
}

export function databaseProperties(did: number): Promise<DatabaseProperties> {
  return collection<DatabaseProperties>(collectionUrl(null, 'databases')).properties(did)
}

export function databaseSql(did: number): Promise<string> {
  return databases.sql(did)
}

/** The lists the create and alter forms offer. */
export interface DatabaseOptions {
  roles: string[]
  tablespaces: string[]
  encodings: string[]
  templates: string[]
  /** libc locales (LC_COLLATE, LC_CTYPE) and ICU locales the server knows, as suggestions. */
  locales: string[]
  icu_locales: string[]
  /** The settings a database may set for its sessions (ALTER DATABASE … SET). */
  settings: string[]
  version: number
}

export function databaseOptions(): Promise<DatabaseOptions> {
  return api.get<DatabaseOptions>('/api/server/databases/options')
}

/** What CREATE DATABASE takes, by pgAdmin's field names (create.sql). */
export interface NewDatabase {
  name: string
  datowner?: string
  template?: string
  encoding?: string
  spcname?: string
  datconnlimit?: number | string
  datcollate?: string
  datctype?: string
  /** libc, icu (PostgreSQL 15+) or builtin (17+). */
  datlocaleprovider?: string
  daticulocale?: string
  datbuiltinlocale?: string
  is_template?: boolean
  comments?: string
  /** Run ALTER DATABASE ... REFRESH COLLATION VERSION on the template first (see CollationRemedy). */
  refresh_collation?: boolean
}

/**
 * Why a create was turned down since PostgreSQL 15: the template database records a collation
 * version (datcollversion) other than the one the operating system now provides, as after a
 * libc or ICU upgrade. The server asks for ALTER DATABASE ... REFRESH COLLATION VERSION on the
 * template; sending the create again with refresh_collation runs it first.
 */
export interface CollationRemedy {
  template: string
  recorded: string
  actual: string
  sql: string
  /** The server's own description of the mismatch. */
  detail?: string
}

/** The collation remedy a failed create carries, if that is what failed it. */
export function collationRemedy(error: unknown): CollationRemedy | null {
  if (!(error instanceof ApiError) || error.remedy?.action !== 'refresh_collation') return null
  const { template, recorded, actual, sql } = error.remedy

  return { template: String(template), recorded: String(recorded), actual: String(actual), sql, detail: error.detail }
}

/** What ALTER DATABASE may change; only the fields given are changed. */
export interface DatabaseChanges {
  name?: string
  datowner?: string
  comments?: string
  datconnlimit?: number | string
  spcname?: string
  is_template?: boolean
  datallowconn?: boolean
  /** ALTER DATABASE … SET / RESET, and ALTER ROLE … IN DATABASE for a role's own. */
  variables?: { added?: DatabaseVariable[]; changed?: DatabaseVariable[]; deleted?: DatabaseVariable[] }
}

/** A setting a database gives its sessions, for every role or for one. */
export interface DatabaseVariable {
  name: string
  value: string
  role: string | null
}

export function createDatabase(data: NewDatabase): Promise<TreeNode<DatabaseMeta>> {
  return databases.create(data)
}

export function updateDatabase(did: number, data: DatabaseChanges): Promise<TreeNode<DatabaseMeta>> {
  return databases.update(did, data)
}

/** DROP DATABASE; with force, the sessions connected to it are terminated first. */
export function dropDatabase(did: number, force = false): Promise<void> {
  return databases.remove(did, force).then(() => undefined)
}

/** The statements a create (did undefined) or an alter would run. */
export function databaseModifiedSql(data: NewDatabase | DatabaseChanges, did?: number): Promise<string> {
  return databases.modifiedSql(data, did)
}
